const { createHash } = require('node:crypto');
const { CookieJar, parse: parseCookie } = require('tough-cookie');
const { curlRequest, CurlHttpError } = require('./curlRequest');
const substores = require('./substores');

const SHOP_URL = 'https://shop.amul.com';
const STORE_ID = '62fa94df8c13af2e242eba16';
const DEFAULT_STORE_VERSION = 6;
const CATEGORIES = ['protein', 'chocolates', 'organic', 'ghee', 'milk'];
const PRODUCT_FIELDS = [
  'name', 'brand', 'categories', 'collections', 'alias', 'sku', 'price', 'compare_price',
  'original_price', 'images', 'metafields', 'discounts', 'catalog_only', 'is_catalog',
  'seller', 'available', 'inventory_quantity', 'net_quantity', 'num_reviews', 'avg_rating',
  'inventory_low_stock_quantity', 'inventory_allow_out_of_stock', 'default_variant', 'variants', 'lp_seller_ids'
];
const DEFAULT_HEADERS = {
  accept: 'application/json, text/plain, */*',
  'accept-language': 'en-US,en;q=0.9',
  base_url: `${SHOP_URL}/en/browse/protein`,
  'cache-control': 'no-cache',
  frontend: '1',
  pragma: 'no-cache',
  referer: `${SHOP_URL}/en/browse/protein`,
  'sec-ch-ua': '"Google Chrome";v="147", "Chromium";v="147", "Not.A/Brand";v="8"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Linux"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-origin',
  'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36'
};

function parseJson(body, name) {
  try { return JSON.parse(body); } catch { throw new Error(`${name} returned invalid JSON`); }
}

function normalizeAlias(value = '') {
  return decodeURIComponent(String(value)).trim().toLowerCase().replace(/\s+/g, '');
}

function extractProductAlias(productUrl) {
  const pathname = new URL(productUrl).pathname;
  const marker = '/product/';
  const index = pathname.toLowerCase().indexOf(marker);
  if (index === -1) throw new Error('Product URL must be an Amul /product/ URL');
  return normalizeAlias(pathname.slice(index + marker.length).replace(/\/$/, ''));
}

function getInventoryQuantity(product) {
  const quantity = Number(product.inventory_quantity || 0);
  const threshold = Number(product.inventory_low_stock_quantity || 0);
  if (threshold > quantity && String(product.inventory_allow_out_of_stock || '0') === '0') return 0;
  return Math.max(0, quantity - threshold);
}

function isAvailableToPurchase(product) {
  if (String(product.inventory_allow_out_of_stock || '0') !== '0') return true;
  return Number(product.available || 0) > 0 && getInventoryQuantity(product) > 0 &&
    Number(product.inventory_quantity || 0) >= Number(product.inventory_low_stock_quantity || 0);
}

function findProduct(catalog, { sku, url }) {
  if (sku) {
    const bySku = catalog.find((product) => product.sku === sku || product._id === sku);
    if (bySku) return bySku;
  }
  const alias = extractProductAlias(url);
  return catalog.find((product) => normalizeAlias(product.alias) === alias);
}

function getProductImageUrl(product, fileBaseUrl = '') {
  const image = product?.images?.[0]?.image;
  if (!image) return null;
  if (/^https?:\/\//i.test(image)) return image;
  if (fileBaseUrl) return `${fileBaseUrl.replace(/\/$/, '')}/${image.replace(/^\//, '')}`;
  return new URL(image, SHOP_URL).toString();
}

class AmulCatalogClient {
  constructor() {
    this.jar = new CookieJar();
    this.tid = null;
    this.pincodeRecord = null;
    this.storeVersion = 0;
  }

  async request(options) {
    const cookie = await this.jar.getCookieString(SHOP_URL);
    const response = await curlRequest({
      ...options,
      headers: { ...DEFAULT_HEADERS, ...options.headers, ...(cookie ? { cookie } : {}) }
    });
    const host = new URL(options.url).hostname;
    for (const cookieString of response.setCookies) {
      const parsed = parseCookie(cookieString, { loose: true });
      if (!parsed?.key) continue;
      parsed.domain = host;
      await this.jar.setCookie(parsed.toString(), options.url);
    }
    return response;
  }

  async init(pincode) {
    const cookieResponse = await this.request({ url: `${SHOP_URL}/en/browse/protein` });
    if (!cookieResponse.setCookies.length) throw new Error('No cookies received from Amul');

    const infoResponse = await this.request({ url: `${SHOP_URL}/user/info.js?_v=${Date.now()}` });
    const session = parseJson(infoResponse.body.replace(/^\s*session\s*=\s*/, ''), 'Amul session');
    if (!session.tid) throw new Error('No TID received from Amul session');
    this.tid = session.tid;

    const records = await this.searchPincode(pincode);
    if (!records.length) throw new Error(`No Amul delivery area found for pincode ${pincode}`);
    const record = records.find((item) => String(item.pincode) === String(pincode)) || records[0];
    if (!substores[record.substore]) throw new Error(`Unknown Amul substore alias: ${record.substore}`);
    await this.setPincode(record);
    return this;
  }

  tidHeader() {
    if (!this.tid) throw new Error('Amul session is not initialized');
    const timestamp = String(Date.now());
    const random = Math.floor(Math.random() * 1000);
    const hash = createHash('sha256').update(`${STORE_ID}:${timestamp}:${random}:${this.tid}`).digest('hex');
    return `${timestamp}:${random}:${hash}`;
  }

  async searchPincode(pincode) {
    const response = await this.request({
      url: `${SHOP_URL}/entity/pincode?limit=50&filters[0][field]=pincode&filters[0][value]=${encodeURIComponent(pincode)}&filters[0][operator]=regex&cf_cache=1h`,
      headers: { tid: this.tidHeader() }
    });
    return parseJson(response.body, 'Pincode search').records || [];
  }

  async setPincode(record) {
    await this.request({
      url: `${SHOP_URL}/entity/ms.settings/_/setPreferences`,
      method: 'PUT',
      headers: { 'content-type': 'application/json', tid: this.tidHeader() },
      body: { data: { store: record.substore } }
    });
    this.pincodeRecord = record;
  }

  async ensureStoreVersion() {
    if (this.storeVersion) return;
    try {
      const response = await this.request({ url: `${SHOP_URL}/ms/store/amul/auto/EN/storeinfo.js` });
      const match = response.body.match(/req\.query\.v\s*=\s*['"]?([^'";\s]+)['"]?/);
      const version = Number(match?.[1]);
      this.storeVersion = Number.isFinite(version) && version > 0 ? version : DEFAULT_STORE_VERSION;
    } catch {
      this.storeVersion = DEFAULT_STORE_VERSION;
    }
  }

  catalogUrl() {
    const params = new URLSearchParams();
    for (const field of PRODUCT_FIELDS) params.append(`fields[${field}]`, '1');
    params.append('filters[0][field]', 'categories');
    CATEGORIES.forEach((category, index) => params.append(`filters[0][value][${index}]`, category));
    params.append('filters[0][operator]', 'in');
    params.append('filters[0][original]', '1');
    params.append('facets', 'true');
    params.append('facetgroup', 'default_category_facet');
    params.append('limit', '100');
    params.append('total', '1');
    params.append('start', '0');
    params.append('v', String(this.storeVersion || DEFAULT_STORE_VERSION));
    params.append('device_type', 'other');
    params.append('substore', substores[this.pincodeRecord.substore]);
    const query = params.toString().replace(/%5B/g, '[').replace(/%5D/g, ']');
    return `${SHOP_URL}/api/1/entity/ms.products?${query}`;
  }

  async fetchCatalog() {
    await this.ensureStoreVersion();
    try {
      const response = await this.request({ url: this.catalogUrl(), headers: { tid: this.tidHeader() } });
      const payload = parseJson(response.body, 'Product catalog');
      if (!Array.isArray(payload.data)) throw new Error('Product catalog did not contain a data array');
      return payload;
    } catch (error) {
      if (error instanceof CurlHttpError && [401, 403].includes(error.status)) this.tid = null;
      throw error;
    }
  }
}

class AmulCatalogPool {
  constructor() {
    this.sessions = new Map();
    this.pincodeSubstores = new Map();
  }

  async getForPincode(pincode, knownSubstore) {
    const cachedSubstore = knownSubstore || this.pincodeSubstores.get(String(pincode));
    if (cachedSubstore && this.sessions.has(cachedSubstore)) return this.sessions.get(cachedSubstore);
    const client = await new AmulCatalogClient().init(pincode);
    const substore = client.pincodeRecord.substore;
    this.pincodeSubstores.set(String(pincode), substore);
    const existing = this.sessions.get(substore);
    if (existing) return existing;
    this.sessions.set(substore, client);
    return client;
  }

  invalidate(substore) {
    this.sessions.delete(substore);
    for (const [pincode, cachedSubstore] of this.pincodeSubstores) {
      if (cachedSubstore === substore) this.pincodeSubstores.delete(pincode);
    }
  }
}

module.exports = {
  AmulCatalogClient,
  AmulCatalogPool,
  extractProductAlias,
  findProduct,
  getInventoryQuantity,
  getProductImageUrl,
  isAvailableToPurchase,
  normalizeAlias
};
