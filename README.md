# Amul Stock Checker Service

A Node.js service that monitors Amul product stock availability for multiple users. It performs headless checks with Puppeteer, stores subscriptions in SQLite, and sends phone notifications through your Node-RED webhook when stock becomes available.

## Table of Contents

- [Information](#information)
  - [Features](#features)
  - [How It Works](#how-it-works)
  - [Deduplication & Scheduling](#deduplication--scheduling)
  - [Requirements](#requirements)
  - [Troubleshooting](#troubleshooting)
- [Setup](#setup)
  - [Local Setup](#local-setup)
  - [Docker Setup](#docker-setup)
  - [Using Docker Compose (Recommended)](#using-docker-compose-recommended)
  - [Using Docker Directly](#using-docker-directly)
  - [Multi-Platform Build (Optional)](#multi-platform-build-optional)
- [Endpoints](#endpoints)
  - [Authentication](#authentication)
  - [Subscription States](#subscription-states)
  - [POST /checks](#post-checks)
  - [GET /subscriptions](#get-subscriptions)
  - [DELETE /checks/:subscriptionId](#delete-checkssubscriptionid)
  - [GET /health](#get-health)

---

## Information

### Features

- ✅ Automatic delivery pincode handling before every check
- ✅ **Product image and name extraction** (cached in database)
- ✅ **Concurrent check queue system** (configurable rate limiting)
- ✅ Shared Puppeteer checks for duplicate product requests
- ✅ SQLite-backed persistence for products and subscribers
- ✅ REST API to add/remove monitoring jobs
- ✅ Phone notifications via Node-RED when stock returns
- ✅ Subscriptions auto-expire after successful notifications (history retained)
- ✅ Instant confirmation notification when a subscription is activated
- ✅ Optional PostHog analytics integration for tracking user behavior and service health

### How It Works

1. Launches a headless Chrome browser with Puppeteer
2. Navigates to the product page
3. **Extracts product name and image URL** (using Open Graph tags and fallback selectors)
4. Applies the provided delivery pincode (resilient to popups and suggestions)
5. Waits for the page to render fully
6. Analyzes DOM elements and text for stock indicators
7. **Caches product metadata in database** for reuse
8. Shares results with all subscribers attached to that product
9. Sends Node-RED notifications (with product image and name) when stock transitions to **IN STOCK**
10. Marks notified subscriptions as `expired` and pauses the monitor until someone reactivates it

### Deduplication & Scheduling

- Products are uniquely identified by `productUrl + deliveryPincode + intervalMinutes`
- Multiple users monitoring the same product share a single Puppeteer cycle
- SQLite stores products and subscriptions so state survives restarts
- Monitors stop only when the last subscriber is removed

### Requirements

- Node.js v16 or higher (for Puppeteer 24+)
- Internet connectivity
- Chromium/Chrome (downloaded automatically by Puppeteer, or use system Chromium with Docker)

### Troubleshooting

If the service reports "Could not determine stock status":

- The Amul page structure may have changed
- Additional authentication (e.g., login) might be required
- Verify the `productUrl` manually

If pincode setting fails:

- Double-check that the pincode is valid for the desired delivery region
- Review console logs (search for yellow warnings) to update selector logic if the site changes

---

## Setup

### Local Setup

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

# Optional: Concurrency Control
MAX_CONCURRENT_CHECKS=3

# Optional: PostHog Analytics
POSTHOG_API_KEY=your-posthog-api-key
POSTHOG_HOST=https://app.posthog.com
```

The `API_KEY` is required for authentication on all API endpoints (except `/health`). The notification configuration and `PORT` are also stored in environment variables. Product URLs, pincodes, intervals, phone numbers, and subscriber emails are provided per request by the frontend.

**Concurrency Control (Optional):**  
`MAX_CONCURRENT_CHECKS` limits how many Puppeteer browsers can run simultaneously (default: 3). This prevents resource exhaustion and rate limiting. If more checks are triggered, they're queued and processed sequentially. Increase this value if you have more server resources and need higher throughput.

**PostHog Analytics (Optional):**  
PostHog is completely optional and will not affect the service if not configured. When enabled, it tracks comprehensive events across the entire application lifecycle.

**Features:**
- ✨ **Immediate event delivery** - Events are sent immediately (no batching delay)
- 🔥 **Exception autocapture** - Automatically captures and reports uncaught exceptions
- 🛡️ **Express error integration** - Captures Express errors that would otherwise be missed
- 📊 **Manual exception tracking** - All caught errors are reported with context

**Server Lifecycle:**
- `server_started` - when the server starts up (includes port, Node version)
- `server_shutdown` - when the server shuts down gracefully (includes signal type)
- `monitors_initialized` - when existing monitors are loaded on startup

**User Actions:**
- `subscription_created` - when a user creates a subscription
- `subscriptions_queried` - when subscriptions are queried
- `subscription_deleted` - when a subscription is deleted
- `subscription_reactivated` - when an expired/deleted subscription is reactivated
- `subscription_expired` - when a subscription auto-expires after successful notification

**Product & Monitor Lifecycle:**
- `product_created` - when a new product is added to monitoring
- `product_reused` - when subscribing to an already monitored product
- `monitor_started` - when a new monitoring process begins
- `monitor_stopped` - when monitoring stops (no active subscriptions)
- `monitor_reused` - when an existing monitor is reused for a new subscription

**Stock Monitoring:**
- `stock_check_completed` - after each stock availability check
- `stock_status_changed` - when stock status changes (e.g., OUT OF STOCK → IN STOCK)
- `stock_available_notification_sent` - when a stock notification is successfully sent

**Notifications:**
- `confirmation_notification_sent` - when subscription confirmation is sent
- `confirmation_notification_failed` - when confirmation notification fails

**API & Security:**
- `health_check` - when the /health endpoint is accessed
- `auth_failed_missing_header` - when authorization header is missing
- `auth_failed_invalid_format` - when authorization format is incorrect
- `auth_failed_invalid_token` - when an invalid token is provided

**Errors:**
- `subscription_creation_failed` - when subscription creation fails
- `stock_notification_failed` - when a notification fails to send
- `stock_check_error` - when stock checking encounters an error (e.g., Puppeteer failures)
- `initial_stock_check_failed` - when the initial stock check for a new monitor fails

All events include relevant properties (IDs, URLs, error messages, etc.) for detailed analytics and debugging.

Simply omit the `POSTHOG_API_KEY` to run without analytics.

3. Ensure the `data/` directory exists (it is created automatically on install) and is writable; SQLite stores `data/stock-checker.db`.

4. Start the monitoring service:

```bash
npm start
```

The service listens on `PORT` (defaults to `3000`). Press `Ctrl+C` to stop.

### Docker Setup

The Docker setup is **platform-agnostic** and works seamlessly on both ARM64 (Apple Silicon) and x86_64 (Intel/AMD) architectures. The Dockerfile uses system Chromium and builds native bindings (like `better-sqlite3`) for the target architecture automatically.

### Using Docker Compose (Recommended)

1. Ensure you have a `.env` file in the project root (see the values in the [Local Setup](#local-setup) section).

2. Start the service:

   ```bash
   docker compose up
   ```

   Or run in detached mode:

   ```bash
   docker compose up -d
   ```

3. Stop the service:

   ```bash
   docker compose down
   ```

   The `data/` directory is automatically mounted for SQLite persistence. The service includes health checks and will restart automatically if it crashes.

### Using Docker Directly

Alternatively, you can build and run manually:

1. Build the image:

   ```bash
   docker build -t amul-check-stock .
   ```

2. Run the container:

   ```bash
   docker run \
     --name amul-check-stock \
     --rm \
     --env-file .env \
     -p 3000:3000 \
     -v "$(pwd)/data:/app/data" \
     amul-check-stock
   ```

   Replace `3000:3000` if you want to expose the API on a different host port. The container defaults `PUPPETEER_HEADLESS=true`; override this in `.env` if you need to debug browser runs.

### Multi-Platform Build (Optional)

To build images for multiple architectures simultaneously (useful for deploying to different server types):

```bash
# Set up buildx (one-time setup)
docker buildx create --use --name multiplatform

# Build for both AMD64 and ARM64
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t amul-check-stock:latest \
  --push .
```

**Note:** The `--push` flag is required for multi-platform builds as they must be pushed to a registry (Docker Hub, GitHub Container Registry, etc.).

---

## Endpoints

### Authentication

All endpoints (except `/health`) require a Bearer token. Include it in the request headers as `Authorization: Bearer <your-token>`.

### Subscription States

Every subscription record exposes a `status` field:

- `active` — monitoring is running and notifications will be sent.
- `expired` — we sent an in-stock notification and the subscription auto-paused (visible for history).
- `deleted` — you called the delete endpoint; the record remains for auditing but no further checks run.

Auto-expiration happens immediately after a notification succeeds. Once every subscriber for a product is expired or deleted, the monitor shuts down until someone reactivates it.

### POST /checks

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
  "statusChangedAt": "2024-11-03T10:00:00Z",
  "product": {
    "name": "Amul High Protein Milk 250ml",
    "imageUrl": "https://shop.amul.com/s/62fa94df8c13af2e242eba16/66741c9ab3f343317949fae8/01-hero-image_amul-high-protein-milk-250ml-8-480x480.png",
    "url": "https://shop.amul.com/en/product/amul-high-protein-milk-250-ml-or-pack-of-8",
    "deliveryPincode": "431136"
  }
}
```

**Product Metadata:**
- `product.name` - Extracted product name (from Open Graph tags or page title)
- `product.imageUrl` - Product thumbnail URL (typically 480×480 PNG, cached for reuse)
- `product.url` - The monitored product URL
- `product.deliveryPincode` - The delivery pincode for this subscription

These values are automatically extracted on the first stock check and cached in the database. If extraction fails, `name` and `imageUrl` may be `null`.

Immediately after a subscription is created (or re-activated), the service sends a confirmation notification to the provided phone number so the user knows monitoring has started.

### GET /subscriptions

List all subscriptions (with product metadata) for a specific email address.

**cURL example:**

```bash
curl "http://localhost:3000/subscriptions?email=user@example.com" \
  -H "Authorization: Bearer your-secure-api-key-here"
```

**Query Parameters:**

- `email` (required) — The email address to filter subscriptions by

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
      "url": "https://shop.amul.com/en/product/amul-high-protein-milk-250-ml-or-pack-of-8",
      "delivery_pincode": "431136",
      "interval_minutes": 5,
      "product_name": "Amul High Protein Milk 250ml",
      "image_url": "https://shop.amul.com/s/62fa94df8c13af2e242eba16/66741c9ab3f343317949fae8/01-hero-image_amul-high-protein-milk-250ml-8-480x480.png"
    }
  ]
}
```

**New Fields:**
- `product_name` - The extracted product name (null if not yet fetched)
- `image_url` - The product thumbnail URL (null if not available)

These fields are automatically populated when a product is monitored and are shared across all subscriptions for the same product.

### DELETE /checks/:subscriptionId

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

### GET /health

Basic health check returning `{ "status": "ok" }`.

**cURL example:**

```bash
curl http://localhost:3000/health
```

**Response:**

```json
{
  "status": "ok"
}
```

---

## License

ISC
