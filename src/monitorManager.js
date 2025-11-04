const db = require('./db');
const { checkProductStock } = require('./stockChecker');
const { sendNotification } = require('./notification');
const { track, captureException } = require('./analytics');
const { monitor: monitorConfig } = require('./config');

const COLORS = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
};

const insertProductStmt = db.prepare(`
  INSERT INTO products (url, delivery_pincode, interval_minutes)
  VALUES (@url, @delivery_pincode, @interval_minutes)
  ON CONFLICT(url, delivery_pincode, interval_minutes) DO NOTHING
`);

const selectProductStmt = db.prepare(`
  SELECT * FROM products
  WHERE url = ? AND delivery_pincode = ? AND interval_minutes = ?
`);

const selectProductByIdStmt = db.prepare('SELECT * FROM products WHERE id = ?');

const insertSubscriptionStmt = db.prepare(`
  INSERT INTO subscriptions (product_id, email, phone_number, status, status_changed_at)
  VALUES (@product_id, @email, @phone_number, 'active', CURRENT_TIMESTAMP)
  ON CONFLICT(product_id, email)
  DO UPDATE SET
    phone_number = excluded.phone_number,
    status = 'active',
    status_changed_at = CURRENT_TIMESTAMP
`);

const selectSubscriptionStmt = db.prepare(`
  SELECT * FROM subscriptions WHERE product_id = ? AND email = ?
`);

const selectSubscriptionByIdStmt = db.prepare('SELECT * FROM subscriptions WHERE id = ?');

const updateSubscriptionStatusStmt = db.prepare(`
  UPDATE subscriptions
  SET status = @status,
      status_changed_at = CURRENT_TIMESTAMP
  WHERE id = @id
`);

const selectActiveSubscriptionsByProductStmt = db.prepare(`
  SELECT id, email, phone_number FROM subscriptions WHERE product_id = ? AND status = 'active'
`);

const countActiveSubscriptionsByProductStmt = db.prepare(`
  SELECT COUNT(*) as total FROM subscriptions WHERE product_id = ? AND status = 'active'
`);

const selectSubscriptionsByEmailStmt = db.prepare(`
  SELECT s.id,
         s.product_id,
         s.email,
         s.phone_number,
         s.created_at,
         s.status,
         s.status_changed_at,
         p.url,
         p.delivery_pincode,
         p.interval_minutes
  FROM subscriptions s
  JOIN products p ON s.product_id = p.id
  WHERE lower(s.email) = lower(?)
  ORDER BY s.created_at DESC
`);

const selectProductsWithActiveSubscriptionsStmt = db.prepare(`
  SELECT p.*
  FROM products p
  WHERE EXISTS (
    SELECT 1 FROM subscriptions s
    WHERE s.product_id = p.id AND s.status = 'active'
  )
`);

const monitors = new Map();

// Global concurrency control
const DEFAULT_MAX_CONCURRENT_CHECKS = 3;
const configuredMaxConcurrentChecks = monitorConfig?.maxConcurrentChecks;

const MAX_CONCURRENT_CHECKS = Number.isInteger(configuredMaxConcurrentChecks) && configuredMaxConcurrentChecks > 0
  ? configuredMaxConcurrentChecks
  : DEFAULT_MAX_CONCURRENT_CHECKS;

if (MAX_CONCURRENT_CHECKS !== configuredMaxConcurrentChecks) {
  console.warn(
    `⚠️ Monitor: Invalid max concurrent checks value "${configuredMaxConcurrentChecks}". Falling back to ${MAX_CONCURRENT_CHECKS}.`
  );
}

const checkQueue = [];
let activeChecks = 0;

console.log(`🔧 Monitor: Max concurrent checks set to ${MAX_CONCURRENT_CHECKS}`);

function log(color, message) {
  console.log(`${COLORS[color] || ''}${message}${COLORS.reset}`);
}

function getIntervalMs(intervalMinutes) {
  const minutes = Number.parseInt(intervalMinutes, 10);
  return Number.isNaN(minutes) || minutes <= 0 ? 5 * 60 * 1000 : minutes * 60 * 1000;
}

function processQueue() {
  while (activeChecks < MAX_CONCURRENT_CHECKS && checkQueue.length > 0) {
    const { productId, resolve, reject } = checkQueue.shift();
    activeChecks++;

    executeProductCheck(productId)
      .then(resolve)
      .catch(reject)
      .finally(() => {
        activeChecks--;
        processQueue(); // Process next item in queue
      });
  }
}

async function runProductCheck(productId) {
  // Add to queue and return a promise
  return new Promise((resolve, reject) => {
    const monitor = monitors.get(productId);
    if (!monitor) {
      resolve();
      return;
    }

    if (monitor.isChecking) {
      log('yellow', `Skipping check for product ${productId} because a previous check is still running.`);
      resolve();
      return;
    }

    // Mark as checking to prevent duplicate queue entries
    monitor.isChecking = true;

    checkQueue.push({ productId, resolve, reject });

    if (checkQueue.length > 1) {
      log('blue', `Product ${productId} added to queue. Position: ${checkQueue.length}, Active checks: ${activeChecks}/${MAX_CONCURRENT_CHECKS}`);
    }

    processQueue();
  });
}

async function executeProductCheck(productId) {
  const monitor = monitors.get(productId);
  if (!monitor) return;

  try {
    const product = selectProductByIdStmt.get(productId);
    if (!product) {
      log('yellow', `Product ${productId} no longer exists. Stopping monitor.`);
      stopMonitor(productId);
      return;
    }

    const result = await checkProductStock({
      productUrl: product.url,
      deliveryPincode: product.delivery_pincode
    });

    const previousStatus = monitor.lastStatus;
    monitor.lastStatus = result.stockStatus;

    // Track stock status changes
    if (previousStatus && previousStatus !== result.stockStatus) {
      track({
        distinctId: `product_${productId}`,
        event: 'stock_status_changed',
        properties: {
          productId,
          productUrl: product.url,
          deliveryPincode: product.delivery_pincode,
          previousStatus,
          newStatus: result.stockStatus,
          isAvailable: result.isAvailable
        }
      });
    }

    // Track stock check completed
    track({
      distinctId: `product_${productId}`,
      event: 'stock_check_completed',
      properties: {
        productId,
        stockStatus: result.stockStatus,
        isAvailable: result.isAvailable
      }
    });

    if (result.isAvailable) {
      const subscriptions = selectActiveSubscriptionsByProductStmt.all(productId);

      if (subscriptions.length === 0) {
        if (previousStatus !== 'IN STOCK') {
          log('yellow', `Product ${productId} is in stock, but there are no active subscriptions.`);
        }
      }

      let expiredCount = 0;

      for (const subscription of subscriptions) {
        const message = `🎉 Stock Available! 🎉\n\nProduct: ${product.url}\nPincode: ${product.delivery_pincode}\n\nStock status: ${result.stockStatus}\n\nPlace your order soon!`;
        try {
          await sendNotification({ phoneNumber: subscription.phone_number, message });
          updateSubscriptionStatusStmt.run({ id: subscription.id, status: 'expired' });
          expiredCount += 1;
          log('green', `Notification dispatched to ${subscription.email} (${subscription.phone_number}) - subscription expired.`);

          // Track successful stock notification in PostHog
          track({
            distinctId: subscription.email,
            event: 'stock_available_notification_sent',
            properties: {
              productId,
              subscriptionId: subscription.id,
              productUrl: product.url,
              deliveryPincode: product.delivery_pincode,
              stockStatus: result.stockStatus
            }
          });

          // Track subscription expired
          track({
            distinctId: subscription.email,
            event: 'subscription_expired',
            properties: {
              productId,
              subscriptionId: subscription.id,
              reason: 'stock_became_available'
            }
          });
        } catch (error) {
          log('red', `Failed to send notification to ${subscription.email} (${subscription.phone_number}): ${error.message}`);

          // Capture exception in PostHog
          captureException(error, subscription.email, {
            context: 'stock_notification',
            productId,
            subscriptionId: subscription.id
          });

          // Track failed notification in PostHog
          track({
            distinctId: subscription.email,
            event: 'stock_notification_failed',
            properties: {
              productId,
              subscriptionId: subscription.id,
              error: error.message
            }
          });
        }
      }

      if (expiredCount > 0) {
        const remaining = countActiveSubscriptionsByProductStmt.get(productId).total;
        if (remaining === 0) {
          log('blue', `All subscriptions fulfilled for product ${productId}. Stopping monitor.`);
          stopMonitor(productId);
        }
      }
    } else if (previousStatus === 'IN STOCK') {
      log('blue', `Product ${productId} back to OUT OF STOCK.`);
    }
  } catch (error) {
    log('red', `Error monitoring product ${productId}: ${error.message}`);

    // Capture exception in PostHog
    captureException(error, `product_${productId}`, {
      context: 'stock_check',
      productId,
      productUrl: product?.url
    });

    // Track stock check errors in PostHog
    track({
      distinctId: `product_${productId}`,
      event: 'stock_check_error',
      properties: {
        productId,
        error: error.message,
        productUrl: product?.url
      }
    });
  } finally {
    monitor.isChecking = false;
  }
}

function startMonitor(product) {
  if (monitors.has(product.id)) {
    // Track monitor reuse
    track({
      distinctId: `product_${product.id}`,
      event: 'monitor_reused',
      properties: {
        productId: product.id,
        productUrl: product.url,
        deliveryPincode: product.delivery_pincode,
        intervalMinutes: product.interval_minutes
      }
    });

    return monitors.get(product.id);
  }

  const intervalMs = getIntervalMs(product.interval_minutes);
  log('blue', `Starting monitor for product ${product.id} (${product.url}) every ${product.interval_minutes} minute(s).`);

  // Track monitor start
  track({
    distinctId: `product_${product.id}`,
    event: 'monitor_started',
    properties: {
      productId: product.id,
      productUrl: product.url,
      deliveryPincode: product.delivery_pincode,
      intervalMinutes: product.interval_minutes,
      intervalMs
    }
  });

  const monitor = {
    timer: setInterval(() => {
      runProductCheck(product.id);
    }, intervalMs),
    isChecking: false,
    lastStatus: null
  };

  monitors.set(product.id, monitor);

  runProductCheck(product.id).catch((error) => {
    log('red', `Initial check failed for product ${product.id}: ${error.message}`);

    // Capture exception in PostHog
    captureException(error, `product_${product.id}`, {
      context: 'initial_stock_check',
      productId: product.id,
      productUrl: product.url
    });

    // Track initial check failures in PostHog
    track({
      distinctId: `product_${product.id}`,
      event: 'initial_stock_check_failed',
      properties: {
        productId: product.id,
        productUrl: product.url,
        error: error.message
      }
    });
  });

  return monitor;
}

function stopMonitor(productId) {
  const monitor = monitors.get(productId);
  if (monitor) {
    clearInterval(monitor.timer);
    monitors.delete(productId);
    log('blue', `Stopped monitor for product ${productId}.`);

    // Track monitor stop
    track({
      distinctId: `product_${productId}`,
      event: 'monitor_stopped',
      properties: {
        productId,
        reason: 'no_active_subscriptions'
      }
    });
  }
}

function initExistingMonitors() {
  const products = selectProductsWithActiveSubscriptionsStmt.all();

  // Track monitor initialization
  track({
    distinctId: 'system',
    event: 'monitors_initialized',
    properties: {
      monitorCount: products.length,
      timestamp: new Date().toISOString()
    }
  });

  products.forEach((product) => startMonitor(product));
}

async function addSubscription({ productUrl, deliveryPincode, intervalMinutes = 5, phoneNumber, email }) {
  if (!productUrl || !deliveryPincode || !phoneNumber || !email) {
    throw new Error('productUrl, deliveryPincode, phoneNumber, and email are required');
  }

  const interval = Number.parseInt(intervalMinutes, 10) || 5;

  const productPayload = {
    url: productUrl,
    delivery_pincode: deliveryPincode,
    interval_minutes: interval
  };

  // Check if product already exists
  const existingProduct = selectProductStmt.get(productUrl, deliveryPincode, interval);
  const isNewProduct = !existingProduct;

  // Check if subscription already exists
  let existingSubscription = null;
  if (existingProduct) {
    existingSubscription = selectSubscriptionStmt.get(existingProduct.id, email);
  }
  const isReactivation = existingSubscription && existingSubscription.status !== 'active';

  const transaction = db.transaction(() => {
    insertProductStmt.run(productPayload);
    const product = selectProductStmt.get(productUrl, deliveryPincode, interval);
    if (!product) {
      throw new Error('Failed to create or retrieve product record');
    }

    insertSubscriptionStmt.run({
      product_id: product.id,
      email,
      phone_number: phoneNumber
    });

    const subscription = selectSubscriptionStmt.get(product.id, email);
    return { product, subscription };
  });

  const { product, subscription } = transaction();

  // Track product creation or reuse
  if (isNewProduct) {
    track({
      distinctId: email,
      event: 'product_created',
      properties: {
        productId: product.id,
        productUrl,
        deliveryPincode,
        intervalMinutes: interval
      }
    });
  } else {
    track({
      distinctId: email,
      event: 'product_reused',
      properties: {
        productId: product.id,
        productUrl,
        deliveryPincode,
        intervalMinutes: interval
      }
    });
  }

  // Track subscription reactivation
  if (isReactivation) {
    track({
      distinctId: email,
      event: 'subscription_reactivated',
      properties: {
        subscriptionId: subscription.id,
        productId: product.id,
        previousStatus: existingSubscription.status
      }
    });
  }

  startMonitor(product);

  const confirmationMessage = `✅ Subscription active!\n\nProduct: ${product.url}\nPincode: ${product.delivery_pincode}\nFrequency: every ${product.interval_minutes} minute(s)\n\nYou'll receive an alert as soon as stock is available.`;

  try {
    await sendNotification({ phoneNumber: subscription.phone_number, message: confirmationMessage });
    log('green', `Confirmation notification sent to ${subscription.email} (${subscription.phone_number}).`);

    // Track successful confirmation notification
    track({
      distinctId: email,
      event: 'confirmation_notification_sent',
      properties: {
        subscriptionId: subscription.id,
        productId: product.id
      }
    });
  } catch (error) {
    log('red', `Failed to send confirmation notification to ${subscription.email} (${subscription.phone_number}): ${error.message}`);

    // Capture exception in PostHog
    captureException(error, email, {
      context: 'confirmation_notification',
      subscriptionId: subscription.id,
      productId: product.id
    });

    // Track failed confirmation notification
    track({
      distinctId: email,
      event: 'confirmation_notification_failed',
      properties: {
        subscriptionId: subscription.id,
        productId: product.id,
        error: error.message
      }
    });
  }

  return {
    productId: product.id,
    subscriptionId: subscription.id,
    status: subscription.status,
    statusChangedAt: subscription.status_changed_at
  };
}

function deleteSubscription(subscriptionId) {
  const subscription = selectSubscriptionByIdStmt.get(subscriptionId);
  if (!subscription) {
    return { removed: false };
  }

  if (subscription.status === 'deleted') {
    return { removed: false };
  }

  updateSubscriptionStatusStmt.run({ id: subscriptionId, status: 'deleted' });

  const updated = selectSubscriptionByIdStmt.get(subscriptionId);

  const remaining = countActiveSubscriptionsByProductStmt.get(subscription.product_id).total;
  if (remaining === 0) {
    stopMonitor(subscription.product_id);
  }

  return { removed: true, email: subscription.email, status: updated.status, statusChangedAt: updated.status_changed_at };
}

function getSubscriptionsByEmail(email) {
  if (!email) {
    throw new Error('email is required');
  }

  return selectSubscriptionsByEmailStmt.all(email);
}

module.exports = {
  initExistingMonitors,
  addSubscription,
  deleteSubscription,
  getSubscriptionsByEmail
};

