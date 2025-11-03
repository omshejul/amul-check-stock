const db = require('./db');
const { checkProductStock } = require('./stockChecker');
const { sendNotification } = require('./notification');

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

function log(color, message) {
  console.log(`${COLORS[color] || ''}${message}${COLORS.reset}`);
}

function getIntervalMs(intervalMinutes) {
  const minutes = Number.parseInt(intervalMinutes, 10);
  return Number.isNaN(minutes) || minutes <= 0 ? 5 * 60 * 1000 : minutes * 60 * 1000;
}

async function runProductCheck(productId) {
  const monitor = monitors.get(productId);
  if (!monitor) return;
  if (monitor.isChecking) {
    log('yellow', `Skipping check for product ${productId} because a previous check is still running.`);
    return;
  }

  monitor.isChecking = true;

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
        } catch (error) {
          log('red', `Failed to send notification to ${subscription.email} (${subscription.phone_number}): ${error.message}`);
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
  } finally {
    monitor.isChecking = false;
  }
}

function startMonitor(product) {
  if (monitors.has(product.id)) {
    return monitors.get(product.id);
  }

  const intervalMs = getIntervalMs(product.interval_minutes);
  log('blue', `Starting monitor for product ${product.id} (${product.url}) every ${product.interval_minutes} minute(s).`);

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
  });

  return monitor;
}

function stopMonitor(productId) {
  const monitor = monitors.get(productId);
  if (monitor) {
    clearInterval(monitor.timer);
    monitors.delete(productId);
    log('blue', `Stopped monitor for product ${productId}.`);
  }
}

function initExistingMonitors() {
  const products = selectProductsWithActiveSubscriptionsStmt.all();
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

  startMonitor(product);

  const confirmationMessage = `✅ Subscription active!\n\nProduct: ${product.url}\nPincode: ${product.delivery_pincode}\nFrequency: every ${product.interval_minutes} minute(s)\n\nYou'll receive an alert as soon as stock is available.`;

  try {
    await sendNotification({ phoneNumber: subscription.phone_number, message: confirmationMessage });
    log('green', `Confirmation notification sent to ${subscription.email} (${subscription.phone_number}).`);
  } catch (error) {
    log('red', `Failed to send confirmation notification to ${subscription.email} (${subscription.phone_number}): ${error.message}`);
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

  return { removed: true, status: updated.status, statusChangedAt: updated.status_changed_at };
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

