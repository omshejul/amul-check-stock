const cron = require('node-cron');
const db = require('./db');
const { AmulCatalogPool, findProduct, getInventoryQuantity, getProductImageUrl, isAvailableToPurchase } = require('./amulCatalog');
const { sendNotification } = require('./notification');
const { track, captureException } = require('./analytics');

const catalogPool = new AmulCatalogPool();
let catalogTask = null;
let checkRunning = false;

const insertProductStmt = db.prepare(`
  INSERT INTO products (url, delivery_pincode, interval_minutes)
  VALUES (@url, @delivery_pincode, 1)
  ON CONFLICT(url, delivery_pincode, interval_minutes) DO NOTHING
`);
const selectProductStmt = db.prepare(`
  SELECT * FROM products WHERE url = ? AND delivery_pincode = ? AND interval_minutes = 1
`);
const selectProductByIdStmt = db.prepare('SELECT * FROM products WHERE id = ?');
const insertSubscriptionStmt = db.prepare(`
  INSERT INTO subscriptions (product_id, email, phone_number, status, status_changed_at)
  VALUES (@product_id, @email, @phone_number, 'active', CURRENT_TIMESTAMP)
  ON CONFLICT(product_id, email) DO UPDATE SET
    phone_number = excluded.phone_number,
    status = 'active',
    status_changed_at = CURRENT_TIMESTAMP
`);
const selectSubscriptionStmt = db.prepare('SELECT * FROM subscriptions WHERE product_id = ? AND email = ?');
const selectSubscriptionByIdStmt = db.prepare('SELECT * FROM subscriptions WHERE id = ?');
const updateSubscriptionStatusStmt = db.prepare(`
  UPDATE subscriptions SET status = @status, status_changed_at = CURRENT_TIMESTAMP WHERE id = @id
`);
const selectActiveSubscriptionsByProductStmt = db.prepare(`
  SELECT id, email, phone_number FROM subscriptions WHERE product_id = ? AND status = 'active'
`);
const selectSubscriptionsByEmailStmt = db.prepare(`
  SELECT s.id, s.product_id, s.email, s.phone_number, s.created_at, s.status, s.status_changed_at,
         p.url, p.delivery_pincode, p.interval_minutes, p.product_name, p.image_url
  FROM subscriptions s
  JOIN products p ON s.product_id = p.id
  WHERE lower(s.email) = lower(?)
  ORDER BY s.created_at DESC
`);
const selectProductsWithActiveSubscriptionsStmt = db.prepare(`
  SELECT p.* FROM products p
  WHERE EXISTS (
    SELECT 1 FROM subscriptions s WHERE s.product_id = p.id AND s.status = 'active'
  )
`);
const updateProductCatalogStmt = db.prepare(`
  UPDATE products SET
    substore = @substore,
    amul_product_id = COALESCE(@amul_product_id, amul_product_id),
    product_name = COALESCE(@product_name, product_name),
    image_url = COALESCE(@image_url, image_url),
    last_stock_status = @last_stock_status,
    last_inventory_quantity = @last_inventory_quantity,
    last_checked_at = CURRENT_TIMESTAMP
  WHERE id = @id
`);
const updateProductSubstoreStmt = db.prepare('UPDATE products SET substore = ? WHERE id = ?');

function log(level, message) {
  const colors = { green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', blue: '\x1b[34m' };
  console.log(`${colors[level] || ''}${message}\x1b[0m`);
}

async function notifyAvailableSubscriptions(product, catalogProduct, notificationSender) {
  const subscriptions = selectActiveSubscriptionsByProductStmt.all(product.id);
  const productName = catalogProduct.name || product.product_name || 'Product';
  const imageUrl = product.image_url || getProductImageUrl(catalogProduct) || null;

  for (const subscription of subscriptions) {
    const message = `🎉 Stock Available! 🎉\n\nProduct: ${productName}\nPincode: ${product.delivery_pincode}\n\nStock status: IN STOCK\n\n${product.url}\n\nPlace your order soon!\n\nLiked this service? Please give us a star on GitHub ⭐\nhttps://github.com/omshejul/check-amul-stock-frontend`;
    try {
      await notificationSender({
        phoneNumber: subscription.phone_number,
        message,
        imageUrl,
        productName,
        productUrl: product.url
      });
      updateSubscriptionStatusStmt.run({ id: subscription.id, status: 'expired' });
      log('green', `Stock alert sent to ${subscription.email}; subscription expired.`);
      track({
        distinctId: subscription.email,
        event: 'stock_available_notification_sent',
        properties: { productId: product.id, subscriptionId: subscription.id, substore: product.substore }
      });
      track({
        distinctId: subscription.email,
        event: 'subscription_expired',
        properties: { productId: product.id, subscriptionId: subscription.id, reason: 'stock_became_available' }
      });
    } catch (error) {
      log('red', `Failed stock alert for ${subscription.email}: ${error.message}`);
      captureException(error, subscription.email, {
        context: 'stock_notification', productId: product.id, subscriptionId: subscription.id
      });
      track({
        distinctId: subscription.email,
        event: 'stock_notification_failed',
        properties: { productId: product.id, subscriptionId: subscription.id, error: error.message }
      });
    }
  }
}

async function runCatalogCheck({ pool = catalogPool, notificationSender = sendNotification } = {}) {
  if (checkRunning) {
    log('yellow', 'Skipping minute check because the previous run is still active.');
    return { skipped: true, substores: 0, products: 0 };
  }

  checkRunning = true;
  const products = selectProductsWithActiveSubscriptionsStmt.all();
  const groups = new Map();

  try {
    for (const product of products) {
      try {
        const client = await pool.getForPincode(product.delivery_pincode, product.substore);
        const substore = client.pincodeRecord.substore;
        if (product.substore !== substore) updateProductSubstoreStmt.run(substore, product.id);
        if (!groups.has(substore)) groups.set(substore, { client, products: [] });
        groups.get(substore).products.push(product);
      } catch (error) {
        log('red', `Could not resolve pincode ${product.delivery_pincode}: ${error.message}`);
        captureException(error, `product_${product.id}`, { context: 'substore_resolution', productId: product.id });
      }
    }

    for (const [substore, group] of groups) {
      try {
        const payload = await group.client.fetchCatalog();
        const catalog = payload.data;
        log('blue', `Fetched ${catalog.length} products for ${substore}; checking ${group.products.length} tracked product(s).`);

        for (const product of group.products) {
          const catalogProduct = findProduct(catalog, { sku: product.amul_product_id, url: product.url });
          if (!catalogProduct) {
            log('yellow', `Tracked product ${product.id} was not present in the ${substore} catalog.`);
            continue;
          }

          const available = isAvailableToPurchase(catalogProduct);
          const status = available ? 'IN STOCK' : 'OUT OF STOCK';
          const previousStatus = product.last_stock_status;
          const imageUrl = getProductImageUrl(catalogProduct, payload.fileBaseUrl);

          updateProductCatalogStmt.run({
            id: product.id,
            substore,
            amul_product_id: catalogProduct.sku || catalogProduct._id || null,
            product_name: catalogProduct.name || null,
            image_url: imageUrl,
            last_stock_status: status,
            last_inventory_quantity: getInventoryQuantity(catalogProduct)
          });

          if (previousStatus && previousStatus !== status) {
            track({
              distinctId: `product_${product.id}`,
              event: 'stock_status_changed',
              properties: { productId: product.id, previousStatus, newStatus: status, substore }
            });
          }
          track({
            distinctId: `product_${product.id}`,
            event: 'stock_check_completed',
            properties: { productId: product.id, stockStatus: status, isAvailable: available, substore }
          });

          if (available) {
            await notifyAvailableSubscriptions({ ...product, substore, image_url: imageUrl }, catalogProduct, notificationSender);
          }
        }
      } catch (error) {
        pool.invalidate(substore);
        log('red', `Catalog check failed for ${substore}: ${error.message}`);
        captureException(error, `substore_${substore}`, { context: 'catalog_check', substore });
      }
    }

    track({
      distinctId: 'system',
      event: 'catalog_check_completed',
      properties: { substoreCount: groups.size, productCount: products.length }
    });
    return { skipped: false, substores: groups.size, products: products.length };
  } finally {
    checkRunning = false;
  }
}

function initExistingMonitors() {
  if (catalogTask) return catalogTask;
  catalogTask = cron.schedule('* * * * *', () => runCatalogCheck(), {
    name: 'amul-catalog-check',
    timezone: 'Asia/Kolkata',
    noOverlap: true
  });
  const count = selectProductsWithActiveSubscriptionsStmt.all().length;
  log('blue', `Catalog monitor started: ${count} active product(s), one request per substore per minute.`);
  track({ distinctId: 'system', event: 'monitors_initialized', properties: { monitorCount: count } });
  runCatalogCheck().catch((error) => log('red', `Initial catalog check failed: ${error.message}`));
  return catalogTask;
}

async function addSubscription({ productUrl, deliveryPincode, phoneNumber, email }) {
  if (!productUrl || !deliveryPincode || !phoneNumber || !email) {
    throw new Error('productUrl, deliveryPincode, phoneNumber, and email are required');
  }
  const url = new URL(productUrl);
  if (url.hostname !== 'shop.amul.com' || !url.pathname.toLowerCase().includes('/product/')) {
    throw new Error('productUrl must be an Amul product URL');
  }

  const existingProduct = selectProductStmt.get(productUrl, deliveryPincode);
  const existingSubscription = existingProduct ? selectSubscriptionStmt.get(existingProduct.id, email) : null;
  const transaction = db.transaction(() => {
    insertProductStmt.run({ url: productUrl, delivery_pincode: deliveryPincode });
    const product = selectProductStmt.get(productUrl, deliveryPincode);
    insertSubscriptionStmt.run({ product_id: product.id, email, phone_number: phoneNumber });
    return { product, subscription: selectSubscriptionStmt.get(product.id, email) };
  });
  const { product, subscription } = transaction();

  track({
    distinctId: email,
    event: existingProduct ? 'product_reused' : 'product_created',
    properties: { productId: product.id, productUrl, deliveryPincode, intervalMinutes: 1 }
  });
  if (existingSubscription && existingSubscription.status !== 'active') {
    track({
      distinctId: email,
      event: 'subscription_reactivated',
      properties: { subscriptionId: subscription.id, productId: product.id, previousStatus: existingSubscription.status }
    });
  }

  const productName = product.product_name || 'Product';
  try {
    await sendNotification({
      phoneNumber: subscription.phone_number,
      message: `✅ Subscription active!\n\nProduct: ${productName}\nPincode: ${product.delivery_pincode}\nFrequency: every minute\n\n${product.url}\n\nYou'll receive an alert as soon as stock is available.`,
      imageUrl: product.image_url || null,
      productName,
      productUrl: product.url
    });
    track({ distinctId: email, event: 'confirmation_notification_sent', properties: { subscriptionId: subscription.id, productId: product.id } });
  } catch (error) {
    log('red', `Failed confirmation notification for ${email}: ${error.message}`);
    captureException(error, email, { context: 'confirmation_notification', subscriptionId: subscription.id, productId: product.id });
  }

  return {
    productId: product.id,
    subscriptionId: subscription.id,
    status: subscription.status,
    statusChangedAt: subscription.status_changed_at,
    productName: product.product_name,
    imageUrl: product.image_url,
    productUrl: product.url,
    deliveryPincode: product.delivery_pincode
  };
}

function deleteSubscription(subscriptionId) {
  const subscription = selectSubscriptionByIdStmt.get(subscriptionId);
  if (!subscription || subscription.status === 'deleted') return { removed: false };
  updateSubscriptionStatusStmt.run({ id: subscriptionId, status: 'deleted' });
  const updated = selectSubscriptionByIdStmt.get(subscriptionId);
  return { removed: true, email: subscription.email, status: updated.status, statusChangedAt: updated.status_changed_at };
}

function getSubscriptionsByEmail(email) {
  if (!email) throw new Error('email is required');
  return selectSubscriptionsByEmailStmt.all(email);
}

module.exports = { initExistingMonitors, runCatalogCheck, addSubscription, deleteSubscription, getSubscriptionsByEmail };
