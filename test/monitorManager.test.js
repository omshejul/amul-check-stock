const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'amul-check-'));
process.env.STOCK_CHECKER_DB_PATH = path.join(testDirectory, 'test.db');
process.env.NOTIFICATION_API_URL = 'http://127.0.0.1:1';
process.env.NOTIFICATION_API_KEY = 'test';
process.env.API_KEY = 'test';

const db = require('../src/db');
const { runCatalogCheck } = require('../src/monitorManager');

test.after(() => {
  db.close();
  fs.rmSync(testDirectory, { recursive: true, force: true });
});

test('fetches one catalog per substore and evaluates every tracked product', async () => {
  const insertProduct = db.prepare(`
    INSERT INTO products (url, delivery_pincode, interval_minutes)
    VALUES (?, '560034', 1)
  `);
  const first = insertProduct.run('https://shop.amul.com/en/product/first-product').lastInsertRowid;
  const second = insertProduct.run('https://shop.amul.com/en/product/second-product').lastInsertRowid;
  const insertSubscription = db.prepare(`
    INSERT INTO subscriptions (product_id, email, phone_number) VALUES (?, ?, ?)
  `);
  insertSubscription.run(first, 'first@example.com', '+911111111111');
  insertSubscription.run(second, 'second@example.com', '+912222222222');

  let fetchCount = 0;
  const client = {
    pincodeRecord: { pincode: '560034', substore: 'karnataka' },
    async fetchCatalog() {
      fetchCount += 1;
      return {
        data: [
          { _id: '1', sku: '1', alias: 'first-product', name: 'First', available: 0, inventory_quantity: 0, inventory_low_stock_quantity: 0, images: [] },
          { _id: '2', sku: '2', alias: 'second-product', name: 'Second', available: 0, inventory_quantity: 0, inventory_low_stock_quantity: 0, images: [] }
        ]
      };
    }
  };
  const pool = {
    async getForPincode() { return client; },
    invalidate() {}
  };

  const result = await runCatalogCheck({ pool, notificationSender: async () => {} });
  assert.equal(fetchCount, 1);
  assert.deepEqual(result, { skipped: false, substores: 1, products: 2 });

  const checked = db.prepare('SELECT substore, last_stock_status, last_checked_at FROM products ORDER BY id').all();
  assert.equal(checked.length, 2);
  assert.ok(checked.every((product) => product.substore === 'karnataka'));
  assert.ok(checked.every((product) => product.last_stock_status === 'OUT OF STOCK'));
  assert.ok(checked.every((product) => product.last_checked_at));
});

test('expires a subscription only after its stock notification succeeds', async () => {
  const product = db.prepare('SELECT * FROM products ORDER BY id LIMIT 1').get();
  let notifications = 0;
  let notificationMessage = '';
  const client = {
    pincodeRecord: { pincode: '560034', substore: 'karnataka' },
    async fetchCatalog() {
      return {
        data: [{
          _id: '1', sku: '1', alias: 'first-product', name: 'First', available: 1,
          inventory_quantity: 10, inventory_low_stock_quantity: 1, inventory_allow_out_of_stock: '0', images: []
        }]
      };
    }
  };
  const pool = {
    async getForPincode() { return client; },
    invalidate() {}
  };

  await runCatalogCheck({
    pool,
    notificationSender: async ({ message }) => {
      notifications += 1;
      notificationMessage = message;
    }
  });

  assert.equal(notifications, 1);
  assert.doesNotMatch(notificationMessage, /star|github/i);
  assert.equal(
    db.prepare('SELECT status FROM subscriptions WHERE product_id = ?').get(product.id).status,
    'expired'
  );
});
