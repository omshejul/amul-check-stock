const express = require('express');
const { server: serverConfig } = require('./config');
const {
  initExistingMonitors,
  addSubscription,
  deleteSubscription,
  getSubscriptionsByEmail
} = require('./monitorManager');

const app = express();

app.use(express.json());

// Bearer token authentication middleware
function authenticateApiKey(req, res, next) {
  const authHeader = req.headers['authorization'];
  
  if (!authHeader) {
    return res.status(401).json({ 
      error: 'Authorization header required. Provide it as "Authorization: Bearer <token>".' 
    });
  }
  
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ 
      error: 'Invalid authorization format. Use "Authorization: Bearer <token>".' 
    });
  }
  
  const token = authHeader.substring(7); // Remove 'Bearer ' prefix
  
  if (token !== serverConfig.apiKey) {
    return res.status(403).json({ 
      error: 'Invalid token' 
    });
  }
  
  next();
}

app.get('/health', (req, res) => {
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
  initExistingMonitors();

  app.listen(serverConfig.port, () => {
    console.log(`🚀 Stock checker service listening on port ${serverConfig.port}`);
  });
}

module.exports = {
  startServer
};

