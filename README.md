# Amul Stock Checker Service

A Node.js service that monitors Amul product stock availability for multiple users. It performs headless checks with Puppeteer, stores subscriptions in SQLite, and sends phone notifications through your Node-RED webhook when stock becomes available.

## Features

- ✅ Automatic delivery pincode handling before every check
- ✅ Shared Puppeteer checks for duplicate product requests
- ✅ SQLite-backed persistence for products and subscribers
- ✅ REST API to add/remove monitoring jobs
- ✅ Phone notifications via Node-RED when stock returns
- ✅ Subscriptions auto-expire after successful notifications (history retained)
- ✅ Instant confirmation notification when a subscription is activated

## Setup

1. Install dependencies:

```bash
npm install
```

This will install the service dependencies (Puppeteer, Express, SQLite, etc.).

2. Create a `.env` file in the project root with the required variables:

```env
NOTIFICATION_API_URL=https://nodered.omshejul.com/message/sendText/bot
NOTIFICATION_API_KEY=1234
API_KEY=your-secure-api-key-here
PORT=3000
```

The `API_KEY` is required for authentication on all API endpoints (except `/health`). The notification configuration and `PORT` are also stored in environment variables. Product URLs, pincodes, intervals, phone numbers, and subscriber emails are provided per request by the frontend.

3. Ensure the `data/` directory exists (it is created automatically on install) and is writable; SQLite stores `data/stock-checker.db`.

## Usage

### Start the monitoring service

```bash
npm start
```

The service listens on `PORT` (defaults to `3000`). Press `Ctrl+C` to stop.

## REST API

**Authentication:** All endpoints (except `/health`) require a Bearer token. Include it in the request headers as `Authorization: Bearer <your-token>`.

**Subscription states:** Every subscription record exposes a `status` field:

- `active` — monitoring is running and notifications will be sent.
- `expired` — we sent an in-stock notification and the subscription auto-paused (visible for history).
- `deleted` — you called the delete endpoint; the record remains for auditing but no further checks run.

Auto-expiration happens immediately after a notification succeeds. Once every subscriber for a product is expired or deleted, the monitor shuts down until someone reactivates it.

### `POST /checks`

Create (or join) a monitoring process for a product.

**cURL example:**

```bash
curl -X POST http://localhost:3000/checks \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-secure-api-key-here" \
  -d '{
    "productUrl": "https://shop.amul.com/en/product/amul-high-protein-blueberry-shake-200-ml-or-pack-of-30",
    "deliveryPincode": "431136",
    "phoneNumber": "917775977750",
    "email": "user@example.com",
    "intervalMinutes": 5
  }'
```

**Request body:**

```json
{
  "productUrl": "https://shop.amul.com/en/product/...",
  "deliveryPincode": "431136",
  "phoneNumber": "917775977750",
  "email": "user@example.com",
  "intervalMinutes": 5
}
```

- `intervalMinutes` is optional (defaults to `5`).
- If the same product/pincode/interval is already being monitored, the subscription is attached to the existing process.
- `email` is required and used to deduplicate subscriptions per product.

**Response:**

```json
{
  "message": "Subscription created",
  "productId": 1,
  "subscriptionId": 42,
  "email": "user@example.com",
  "status": "active",
  "statusChangedAt": "2024-11-03T10:00:00Z"
}
```

Immediately after a subscription is created (or re-activated), the service sends a confirmation notification to the provided phone number so the user knows monitoring has started.

### `GET /subscriptions?email=user@example.com`

List all subscriptions (with product metadata) for a specific email address.

**cURL example:**

```bash
curl "http://localhost:3000/subscriptions?email=user@example.com" \
  -H "Authorization: Bearer your-secure-api-key-here"
```

**Response:**

```json
{
  "email": "user@example.com",
  "subscriptions": [
    {
      "id": 42,
      "product_id": 1,
      "email": "user@example.com",
      "phone_number": "917775977750",
      "created_at": "2024-11-03T10:00:00Z",
      "status": "expired",
      "status_changed_at": "2024-11-03T10:30:12Z",
      "url": "https://shop.amul.com/en/product/...",
      "delivery_pincode": "431136",
      "interval_minutes": 5
    }
  ]
}
```

### `DELETE /checks/:subscriptionId`

Removes a subscriber. The record is marked as `deleted` (retained for history). If it was the last active subscriber for a product, the monitor stops automatically.

**cURL example:**

```bash
curl -X DELETE http://localhost:3000/checks/42 \
  -H "Authorization: Bearer your-secure-api-key-here"
```

**Response:**

```json
{
  "message": "Subscription removed",
  "status": "deleted",
  "statusChangedAt": "2024-11-03T10:05:00Z"
}
```

### `GET /health`

Basic health check returning `{ "status": "ok" }`.

**cURL example:**

```bash
curl http://localhost:3000/health
```

## How It Works

1. Launches a headless Chrome browser with Puppeteer
2. Navigates to the product page
3. Applies the provided delivery pincode (resilient to popups and suggestions)
4. Waits for the page to render fully
5. Analyzes DOM elements and text for stock indicators
6. Shares results with all subscribers attached to that product
7. Sends Node-RED notifications when stock transitions to **IN STOCK**
8. Marks notified subscriptions as `expired` and pauses the monitor until someone reactivates it

### Deduplication & Scheduling

- Products are uniquely identified by `productUrl + deliveryPincode + intervalMinutes`
- Multiple users monitoring the same product share a single Puppeteer cycle
- SQLite stores products and subscriptions so state survives restarts
- Monitors stop only when the last subscriber is removed

## Troubleshooting

If the service reports "Could not determine stock status":

- The Amul page structure may have changed
- Additional authentication (e.g., login) might be required
- Verify the `productUrl` manually

If pincode setting fails:

- Double-check that the pincode is valid for the desired delivery region
- Review console logs (search for yellow warnings) to update selector logic if the site changes

## Requirements

- Node.js v16 or higher (for Puppeteer 24+)
- Internet connectivity
- Chromium/Chrome (downloaded automatically by Puppeteer)

## License

ISC
