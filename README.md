# Amul Stock Checker Service

A Node.js service that checks Amul catalog availability once per minute, stores products and subscriptions in SQLite, and sends WhatsApp alerts through a Node-RED webhook.

## How it works

1. A user submits an Amul product URL, delivery pincode, phone number, and email.
2. The service stores the product and subscription in SQLite.
3. The pincode is resolved to its Amul substore and persisted with the product.
4. Every minute, active products are grouped by substore.
5. The service downloads the Amul catalog once for each active substore.
6. Every tracked product in that substore is matched by Amul product ID or URL alias.
7. Availability is calculated from Amul's `available`, inventory quantity, low-stock threshold, and allow-out-of-stock fields.
8. When a product is purchasable, all active subscribers receive a WhatsApp alert and their subscriptions become `expired`.

This means 100 tracked products in one substore use one catalog request per minute, not 100 product-page requests. Sessions are reused in memory. Product IDs, substore aliases, metadata, last stock state, inventory, and subscriptions remain in SQLite across restarts.

## Requirements

- Node.js 22 or newer
- pnpm
- `curl`
- SQLite build requirements for `better-sqlite3`

Chrome and Puppeteer are not required.

## Setup

```bash
pnpm install
cp .env.example .env
pnpm start
```

Required environment variables:

```env
NOTIFICATION_API_URL=https://example.com/message/sendText/bot
NOTIFICATION_API_KEY=your-notification-key
API_KEY=your-api-bearer-token
PORT=3000
```

Optional PostHog variables:

```env
POSTHOG_API_KEY=
POSTHOG_HOST=https://app.posthog.com
```

SQLite is stored at `data/stock-checker.db`. Docker Compose mounts that directory so data survives container replacement.

## API

All endpoints except `/health` require `Authorization: Bearer <API_KEY>`.

### Create or reactivate an alert

```bash
curl -X POST http://localhost:3000/checks \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "productUrl": "https://shop.amul.com/en/product/example-product",
    "deliveryPincode": "560034",
    "phoneNumber": "+919999999999",
    "email": "user@example.com"
  }'
```

All alerts are checked every minute. `intervalMinutes` from older clients is accepted but ignored.

### List alerts

```bash
curl "http://localhost:3000/subscriptions?email=user@example.com" \
  -H "Authorization: Bearer $API_KEY"
```

### Remove an alert

```bash
curl -X DELETE http://localhost:3000/checks/42 \
  -H "Authorization: Bearer $API_KEY"
```

### Health

```bash
curl http://localhost:3000/health
```

## Tests

```bash
pnpm test
pnpm test:live 560034
```

The unit and integration suite verifies availability rules, product matching, SQLite state, and one catalog fetch per substore. The live smoke test opens a real Amul session, resolves the pincode, and downloads that substore's catalog.

## Docker

```bash
docker compose up --build -d
```

The image contains `curl` and builds the native SQLite binding. It does not install Chromium.
