const test = require('node:test');
const assert = require('node:assert/strict');
const {
  AmulCatalogPool,
  PincodeUnavailableError,
  extractProductAlias,
  findProduct,
  getInventoryQuantity,
  isAvailableToPurchase
} = require('../src/amulCatalog');

test('caches unsupported pincodes until the retry interval expires', async () => {
  let attempts = 0;
  let now = 1_000;
  const pool = new AmulCatalogPool({
    now: () => now,
    unavailableRetryMs: 60_000,
    clientFactory: () => ({
      async init(pincode) {
        attempts += 1;
        throw new PincodeUnavailableError(pincode);
      }
    })
  });

  await assert.rejects(pool.getForPincode('132013'), PincodeUnavailableError);
  await assert.rejects(pool.getForPincode('132013'), (error) => {
    assert.equal(error.cached, true);
    return true;
  });
  assert.equal(attempts, 1);

  now += 60_000;
  await assert.rejects(pool.getForPincode('132013'), PincodeUnavailableError);
  assert.equal(attempts, 2);
});

test('extracts and normalizes the product alias', () => {
  assert.equal(
    extractProductAlias('https://shop.amul.com/en/product/Amul%20Protein%20Shake/'),
    'amulproteinshake'
  );
});

test('finds a catalog product by SKU before URL alias', () => {
  const catalog = [
    { _id: 'one', sku: 'SKU-1', alias: 'first-product' },
    { _id: 'two', sku: 'SKU-2', alias: 'second-product' }
  ];
  assert.equal(findProduct(catalog, {
    sku: 'SKU-2',
    url: 'https://shop.amul.com/en/product/first-product'
  })._id, 'two');
});

test('applies Amul low-stock threshold to purchasable inventory', () => {
  const product = {
    available: 1,
    inventory_quantity: 6,
    inventory_low_stock_quantity: 2,
    inventory_allow_out_of_stock: '0'
  };
  assert.equal(getInventoryQuantity(product), 4);
  assert.equal(isAvailableToPurchase(product), true);

  product.inventory_quantity = 2;
  assert.equal(getInventoryQuantity(product), 0);
  assert.equal(isAvailableToPurchase(product), false);
});

test('honors products that allow out-of-stock purchases', () => {
  assert.equal(isAvailableToPurchase({
    available: 0,
    inventory_quantity: 0,
    inventory_low_stock_quantity: 0,
    inventory_allow_out_of_stock: '1'
  }), true);
});
