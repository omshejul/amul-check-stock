const express = require('express');
const { setupExpressErrorHandler } = require('posthog-node');
const { server: serverConfig, posthog: posthogConfig } = require('./config');
const {
  initExistingMonitors,
  addSubscription,
  deleteSubscription,
  getSubscriptionsByEmail
} = require('./monitorManager');
const { initPostHog, track, captureException, shutdown: shutdownPostHog, getClient } = require('./analytics');

const app = express();

app.use(express.json());

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

app.post('/checks', authenticateApiKey, async (req, res) => {
  const { productUrl, deliveryPincode, phoneNumber, email, intervalMinutes } = req.body || {};

  if (!productUrl || !deliveryPincode || !phoneNumber || !email) {
    return res.status(400).json({
      error: 'productUrl, deliveryPincode, phoneNumber, and email are required'
    });
  }

  try {
    const { productId, subscriptionId, status, statusChangedAt } = await addSubscription({
      productUrl,
      deliveryPincode,
      phoneNumber,
      email,
      intervalMinutes
    });

    // Track subscription creation in PostHog
    track({
      distinctId: email,
      event: 'subscription_created',
      properties: {
        subscriptionId,
        productId,
        deliveryPincode,
        intervalMinutes: intervalMinutes || 30,
        status
      }
    });

    return res.status(201).json({
      message: 'Subscription created',
      productId,
      subscriptionId,
      email,
      status,
      statusChangedAt
    });
  } catch (error) {
    console.error('Failed to create subscription:', error);
    
    // Capture exception in PostHog
    captureException(error, email || 'unknown', {
      context: 'subscription_creation',
      productUrl,
      deliveryPincode
    });
    
    // Track error event in PostHog
    track({
      distinctId: email || 'unknown',
      event: 'subscription_creation_failed',
      properties: {
        error: error.message,
        productUrl
      }
    });

    return res.status(500).json({
      error: 'Failed to create subscription',
      details: error.message
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
    console.error('Failed to fetch subscriptions:', error);
    return res.status(500).json({ error: 'Failed to fetch subscriptions', details: error.message });
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
    console.error('Failed to delete subscription:', error);
    return res.status(500).json({
      error: 'Failed to delete subscription',
      details: error.message
    });
  }
});

function startServer() {
  // Initialize PostHog (optional)
  initPostHog(posthogConfig);

  // Setup Express error handler for PostHog exception autocapture
  const posthogClient = getClient();
  if (posthogClient) {
    setupExpressErrorHandler(posthogClient, app);
    console.log('📊 PostHog: Express error handler configured');
  }

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

  app.listen(serverConfig.port, () => {
    console.log(`🚀 Stock checker service listening on port ${serverConfig.port}`);
  });

  // Handle graceful shutdown
  const gracefulShutdown = async (signal) => {
    console.log(`\n${signal} received. Shutting down gracefully...`);

    // Track server shutdown
    track({
      distinctId: 'system',
      event: 'server_shutdown',
      properties: {
        signal,
        timestamp: new Date().toISOString()
      }
    });

    // Give PostHog time to flush events
    await shutdownPostHog();

    process.exit(0);
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

module.exports = {
  startServer
};

