const { AmulCatalogClient, isAvailableToPurchase } = require('../src/amulCatalog');

async function main() {
  const pincode = process.argv[2] || '560034';
  const client = await new AmulCatalogClient().init(pincode);
  const payload = await client.fetchCatalog();
  const available = payload.data.filter(isAvailableToPurchase).length;
  console.log(JSON.stringify({
    pincode,
    substore: client.pincodeRecord.substore,
    catalogProducts: payload.data.length,
    availableProducts: available
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
