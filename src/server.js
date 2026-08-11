const express = require('express');
const { server: serverConfig, posthog: posthogConfig } = require('./config');
const {
  initExistingMonitors,
  addSubscription,
  deleteSubscription,
  getSubscriptionsByEmail
} = require('./monitorManager');
const { initPostHog, track, captureException, shutdown: shutdownPostHog } = require('./analytics');
const { shutdownTelemetry } = require('./telemetry');
const { log, recordError, safeError } = require('./observability');
const { register, requestMetrics, errors } = require('./metrics');

const app = express();

app.use(express.json());
app.use(requestMetrics);

// Bearer token authentication middleware
function authenticateApiKey(req, res, next) {
  const authHeader = req.headers['authorization'];

  if (!authHeader) {
    // Track missing auth header
    track({
      distinctId: 'system',
      event: 'auth_failed_missing_header',
      properties: {
        path: req.path,
        method: req.method
      }
    });

    return res.status(401).json({
      error: 'Authorization header required. Provide it as "Authorization: Bearer <token>".'
    });
  }

  if (!authHeader.startsWith('Bearer ')) {
    // Track invalid auth format
    track({
      distinctId: 'system',
      event: 'auth_failed_invalid_format',
      properties: {
        path: req.path,
        method: req.method
      }
    });

    return res.status(401).json({
      error: 'Invalid authorization format. Use "Authorization: Bearer <token>".'
    });
  }

  const token = authHeader.substring(7); // Remove 'Bearer ' prefix

  if (token !== serverConfig.apiKey) {
    // Track invalid token
    track({
      distinctId: 'system',
      event: 'auth_failed_invalid_token',
      properties: {
        path: req.path,
        method: req.method
      }
    });

    return res.status(403).json({
      error: 'Invalid token'
    });
  }

  next();
}

app.get('/health', (req, res) => {
  // Track health check requests
  track({
    distinctId: 'system',
    event: 'health_check',
    properties: {
      timestamp: new Date().toISOString()
    }
  });

  res.json({ status: 'ok' });
});

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.send(await register.metrics());
});

app.post('/checks', authenticateApiKey, async (req, res) => {
  const { productUrl, deliveryPincode, phoneNumber, email } = req.body || {};

  if (!productUrl || !deliveryPincode || !phoneNumber || !email) {
    return res.status(400).json({
      error: 'productUrl, deliveryPincode, phoneNumber, and email are required'
    });
  }

  try {
    const { productId, subscriptionId, status, statusChangedAt, productName, imageUrl, productUrl: url, deliveryPincode: pincode } = await addSubscription({
      productUrl,
      deliveryPincode,
      phoneNumber,
      email
    });

    // Track subscription creation in PostHog
    track({
      distinctId: email,
      event: 'subscription_created',
      properties: {
        subscriptionId,
        productId,
        deliveryPincode,
        intervalMinutes: 1,
        status,
        productName,
        imageUrl
      }
    });

    return res.status(201).json({
      message: 'Subscription created',
      productId,
      subscriptionId,
      email,
      status,
      statusChangedAt,
      product: {
        name: productName,
        imageUrl,
        url,
        deliveryPincode: pincode
      }
    });
  } catch (error) {
    errors.inc({ operation: 'subscription_create' });
    recordError(error, 'subscription_create');

    // Capture exception in PostHog
    captureException(error, email || 'unknown', {
      context: 'subscription_creation'
    });

    // Track error event in PostHog
    track({
      distinctId: email || 'unknown',
      event: 'subscription_creation_failed',
      properties: {
        errorType: safeError(error).type
      }
    });

    return res.status(500).json({
      error: 'Failed to create subscription',
      details: 'Please try again later'
    });
  }
});

app.get('/subscriptions', authenticateApiKey, (req, res) => {
  const { email } = req.query;

  if (!email) {
    return res.status(400).json({ error: 'email query parameter is required' });
  }

  try {
    const subscriptions = getSubscriptionsByEmail(email);

    // Track subscription query in PostHog
    track({
      distinctId: email,
      event: 'subscriptions_queried',
      properties: {
        subscriptionCount: subscriptions.length
      }
    });

    return res.json({ email, subscriptions });
  } catch (error) {
    errors.inc({ operation: 'subscriptions_fetch' });
    recordError(error, 'subscriptions_fetch');
    return res.status(500).json({ error: 'Failed to fetch subscriptions' });
  }
});

app.delete('/checks/:subscriptionId', authenticateApiKey, (req, res) => {
  const { subscriptionId } = req.params;

  if (!subscriptionId) {
    return res.status(400).json({ error: 'subscriptionId is required' });
  }

  try {
    const result = deleteSubscription(Number(subscriptionId));
    if (!result.removed) {
      return res.status(404).json({ error: 'Subscription not found' });
    }

    // Track subscription deletion in PostHog
    track({
      distinctId: result.email || 'unknown',
      event: 'subscription_deleted',
      properties: {
        subscriptionId: Number(subscriptionId),
        previousStatus: result.status
      }
    });

    return res.json({ message: 'Subscription removed', status: result.status, statusChangedAt: result.statusChangedAt });
  } catch (error) {
    errors.inc({ operation: 'subscription_delete' });
    recordError(error, 'subscription_delete');
    return res.status(500).json({
      error: 'Failed to delete subscription',
      details: 'Please try again later'
    });
  }
});

function startServer() {
  // Initialize PostHog (optional)
  initPostHog(posthogConfig);

  // Track server startup
  track({
    distinctId: 'system',
    event: 'server_started',
    properties: {
      port: serverConfig.port,
      timestamp: new Date().toISOString(),
      nodeVersion: process.version
    }
  });

  initExistingMonitors();

  const httpServer = app.listen(serverConfig.port, () => {
    log('info', 'server_started', { port: serverConfig.port, node_version: process.version });
  });

  // Handle graceful shutdown
  const gracefulShutdown = async (signal) => {
    log('info', 'server_shutdown_started', { signal });

    // Track server shutdown
    track({
      distinctId: 'system',
      event: 'server_shutdown',
      properties: {
        signal,
        timestamp: new Date().toISOString()
      }
    });

    await new Promise((resolve) => httpServer.close(resolve));
    await Promise.allSettled([shutdownPostHog(), shutdownTelemetry()]);

    process.exit(0);
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  const fatal = async (kind, error) => {
    errors.inc({ operation: kind });
    recordError(error, kind);
    await Promise.allSettled([shutdownPostHog(), shutdownTelemetry()]);
    process.exit(1);
  };
  process.on('uncaughtException', (error) => fatal('uncaught_exception', error));
  process.on('unhandledRejection', (error) => fatal('unhandled_rejection', error));
}

module.exports = {
  startServer
};
