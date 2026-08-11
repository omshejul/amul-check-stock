# Setup

## Local

```bash
pnpm install
cp .env.example .env
pnpm start
```

The service needs Node.js 22+, `curl`, and native build support for `better-sqlite3`.

Configure:

```env
NOTIFICATION_API_URL=https://example.com/message/sendText/bot
NOTIFICATION_API_KEY=your-notification-key
API_KEY=your-api-bearer-token
PORT=3000
```

Optional analytics:

```env
POSTHOG_API_KEY=
POSTHOG_HOST=https://app.posthog.com
```

## Verify

```bash
pnpm test
pnpm test:live 560034
```

## Docker

```bash
docker compose up --build -d
docker compose logs -f
```

SQLite data is mounted from `./data`. Back up `data/stock-checker.db` before moving hosts or making infrastructure changes.
