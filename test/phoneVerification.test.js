const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'amul-phone-'));
process.env.STOCK_CHECKER_DB_PATH = path.join(directory, 'test.db');
process.env.NOTIFICATION_API_URL = 'https://notification.invalid/send';
process.env.WHATSAPP_VERIFICATION_URL = 'https://verification.invalid/check';
process.env.NOTIFICATION_API_KEY = 'test';
process.env.API_KEY = 'test';
const axios = require('axios');
const db = require('../src/db');
const { addSubscription, deleteSubscription, runCatalogCheck } = require('../src/monitorManager');
const { notification } = require('../src/config');

test.after(() => { db.close(); fs.rmSync(directory, { recursive: true }); });
test.beforeEach(() => { db.exec('DELETE FROM subscriptions; DELETE FROM products;'); });

const input = {
  productUrl: 'https://shop.amul.com/en/product/test-product', deliveryPincode: '560084',
  phoneNumber: '+91 (99999) 99999', email: 'test@example.com'
};
const snapshot = () => ({
  products: db.prepare('SELECT * FROM products').all(),
  subscriptions: db.prepare('SELECT * FROM subscriptions').all()
});

test('verifies, normalizes, creates and reactivates registered subscriptions', async (t) => {
  const calls = [];
  t.mock.method(axios, 'post', async (url, body, options) => {
    calls.push(url);
    if (url === notification.verificationUrl) {
      assert.deepEqual(body, { numbers: ['919999999999'] });
      assert.equal(options.timeout, 8000);
      assert.equal(options.maxRedirects, 0);
      assert.equal(options.headers.apikey, 'test');
      return { data: [{ number: '919999999999', exists: true }] };
    }
    assert.equal(body.number, '+919999999999');
    return { data: {} };
  });
  const first = await addSubscription(input);
  assert.equal(snapshot().subscriptions[0].phone_number, '+919999999999');
  deleteSubscription(first.subscriptionId);
  const second = await addSubscription({ ...input, phoneNumber: '919999999999' });
  assert.equal(second.subscriptionId, first.subscriptionId);
  assert.equal(second.status, 'active');
  assert.equal(snapshot().subscriptions.length, 1);
  assert.deepEqual(calls, [notification.verificationUrl, notification.apiUrl, notification.verificationUrl, notification.apiUrl]);
});

for (const failure of ['unregistered', 'timeout', 'provider failure', 'malformed response', 'mismatched number', 'invalid format']) {
  for (const existing of [false, true]) {
    test(`${failure} does not persist or confirm a ${existing ? 'reactivated' : 'new'} subscription`, async (t) => {
      if (existing) {
        const id = db.prepare('INSERT INTO products (url, delivery_pincode, interval_minutes) VALUES (?, ?, 1)')
          .run(input.productUrl, input.deliveryPincode).lastInsertRowid;
        db.prepare("INSERT INTO subscriptions (product_id,email,phone_number,status) VALUES (?,?,?,'deleted')")
          .run(id, input.email, '+918888888888');
      }
      const before = snapshot();
      let confirmations = 0;
      t.mock.method(axios, 'post', async (url) => {
        if (url !== notification.verificationUrl) { confirmations++; return {}; }
        if (failure === 'timeout' || failure === 'provider failure') {
          throw Object.assign(new Error('secret provider details'), { code: failure === 'timeout' ? 'ECONNABORTED' : 'ERR_BAD_RESPONSE' });
        }
        if (failure === 'malformed response') return { data: '<html>gateway</html>' };
        return { data: [{ number: failure === 'mismatched number' ? '918888888888' : '919999999999', exists: false }] };
      });
      const invalid = failure === 'unregistered' || failure === 'invalid format';
      await assert.rejects(addSubscription({ ...input, ...(failure === 'invalid format' ? { phoneNumber: '+91abc9999999999' } : {}) }), (error) => {
        assert.equal(error.statusCode, invalid ? 400 : 503);
        assert.doesNotMatch(error.message, /secret|919999999999/);
        return true;
      });
      assert.deepEqual(snapshot(), before);
      assert.equal(confirmations, 0);
    });
  }
}

test('existing active subscriptions still alert without registration revalidation', async (t) => {
  const id = db.prepare('INSERT INTO products (url, delivery_pincode, interval_minutes) VALUES (?, ?, 1)')
    .run(input.productUrl, input.deliveryPincode).lastInsertRowid;
  db.prepare('INSERT INTO subscriptions (product_id,email,phone_number) VALUES (?,?,?)').run(id, input.email, '+919999999999');
  t.mock.method(axios, 'post', () => { throw new Error('Unexpected provider call'); });
  let sent = 0;
  await runCatalogCheck({
    pool: {
      async getForPincode() { return {
        pincodeRecord: { substore: 'karnataka' },
        async fetchCatalog() { return { data: [{ alias: 'test-product', available: 1, inventory_quantity: 10 }] }; }
      }; },
      invalidate() { assert.fail('Unexpected invalidation'); }
    },
    notificationSender: async () => { sent++; }
  });
  assert.equal(sent, 1);
  assert.equal(snapshot().subscriptions[0].status, 'expired');
});
