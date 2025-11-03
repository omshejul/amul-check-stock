# Amul Stock Checker – Setup Playbook

This guide documents a repeatable, platform-agnostic setup for developing and running the Amul stock checker service. It embeds every prerequisite, the exact `pnpm` commands to avoid skipped install scripts, and the recovery steps for all issues we encountered while hardening the project.

---

## 1. Prerequisites

### 1.1 Node.js & pnpm

- Node.js **v20.12.0 or newer** (the service is tested on Node 20.19.3). If you use `nvm`, run `nvm install 20 && nvm use 20`.
- `pnpm` **v8.15+** (we used v10.16). Install globally once:

  ```bash
  npm install -g pnpm@latest
  ```

### 1.2 Native toolchain for SQLite bindings

`better-sqlite3` compiles a native addon during install. Install the required toolchain before running `pnpm install`.

| OS                  | Command / Notes                                                                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Ubuntu / Debian** | `sudo apt-get update && sudo apt-get install -y build-essential python3 pkg-config`                                                                                            |
| **Fedora / RHEL**   | `sudo dnf groupinstall "Development Tools"` (or install `gcc gcc-c++ make python3 pkgconf-pkg-config`)                                                                         |
| **macOS**           | `xcode-select --install` (Command Line Tools)                                                                                                                                  |
| **Windows**         | Install **Visual Studio Build Tools 2022** with the “Desktop development with C++” workload and Python 3. After installation, run from an **x64 Native Tools Command Prompt**. |

> 💡 If you plan to containerise the app later, add these packages to your base image so the build succeeds inside CI as well.

### 1.3 Chromium dependencies (for Puppeteer)

The first `pnpm install` downloads a compatible Chromium build automatically. On minimal Linux images add:

```bash
sudo apt-get install -y libasound2 libx11-xcb1 libxcomposite1 libxcursor1 libxdamage1 libxi6 libxtst6 libnss3 libxrandr2 libatk1.0-0 libpangocairo-1.0-0 libcups2 libxss1 libgbm1 libatk-bridge2.0-0 libgtk-3-0
```

---

## 2. One-time Repository Setup

```bash
git clone https://github.com/<your-org>/amul-check-stock.git
cd amul-check-stock

# Ensure pnpm is willing to run install scripts (previous runs may have disabled them)
pnpm config set ignore-scripts false
pnpm config delete ignored-built-dependencies 2>/dev/null || true

# Whitelist better-sqlite3\'s post-install step and install all dependencies
PNPM_ALLOW_SCRIPTS=better-sqlite3 pnpm install --force

# Force a native rebuild (covers Node upgrades or fresh hosts)
npm_config_build_from_source=true PNPM_ALLOW_SCRIPTS=better-sqlite3 pnpm rebuild better-sqlite3

# Confirm the native binary exists
ls -lh node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3/build/Release/
```

Expected output (truncated):

```
-rwxr-xr-x 1 user user 2.2M Nov 03 12:34 better_sqlite3.node
```

If the directory is empty or missing, jump to [§4 Troubleshooting](#4-troubleshooting-checklist).

---

## 3. Runtime Configuration

1. Copy the example environment file and fill in your secrets:

   ```bash
   cp .env.example .env
   ```

   Required entries:

   ```env
   NOTIFICATION_API_URL=https://your-node-red-host/message/sendText/bot
   NOTIFICATION_API_KEY=<your-notification-api-key>
   API_KEY=<bearer-token-for-rest-api>
   PORT=3000
   ```

2. (Optional) change `PUPPETEER_HEADLESS` in `.env` to `true` (Chromium headless) or `false` (debug).

3. Start the service:

   ```bash
   pnpm start
   ```

4. The server prints:

   ```
   🚀 Stock checker service listening on port 3000
   ✅ Notification sent to <phone> (startup self-test)
   ```

5. Use the Bearer token from `API_KEY` for all API calls, e.g.:

   ```bash
   curl -X POST http://localhost:3000/checks \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer $API_KEY" \
     -d '{
       "productUrl": "https://shop.amul.com/en/product/...",
       "deliveryPincode": "431136",
       "phoneNumber": "919999999999",
       "email": "user@example.com",
       "intervalMinutes": 5
     }'
   ```

---

## 4. Troubleshooting Checklist

### 4.1 “Could not locate the bindings file” (better-sqlite3)

Symptoms:

```
Error: Could not locate the bindings file. Tried: ... better_sqlite3.node
```

Resolution (in order):

1. Verify the toolchain is installed (§1.2). On Linux, ensure `gcc --version` and `python3 --version` succeed.
2. Ensure pnpm is running install scripts:

   ```bash
   pnpm config set ignore-scripts false
   pnpm config delete ignored-built-dependencies 2>/dev/null || true
   ```

3. Reinstall and rebuild with the script whitelist:

   ```bash
   PNPM_ALLOW_SCRIPTS=better-sqlite3 pnpm install --force
   npm_config_build_from_source=true PNPM_ALLOW_SCRIPTS=better-sqlite3 pnpm rebuild better-sqlite3
   ```

4. Confirm `better_sqlite3.node` exists (see §2). If it is still missing, inspect the rebuild output—any compiler error will be shown there.
5. If you previously added `pnpm.neverBuiltDependencies` or `onlyBuiltDependencies` in `package.json`/`.npmrc`, remove those entries or add `"better-sqlite3"` to the allow list.

### 4.2 Puppeteer / Chromium startup issues

- Ensure the runtime libraries from §1.3 are installed.
- On Linux servers without a display, run with `PUPPETEER_HEADLESS=true`.
- If Chromium downloads are blocked, set `PUPPETEER_SKIP_DOWNLOAD=true` before `pnpm install` and supply the `PUPPETEER_EXECUTABLE_PATH` env var pointing to a system Chrome build.

### 4.3 “npm_config_build_from_source=true pnpm rebuild better-sqlite3 --filter ...” does nothing

The `--filter` flag matches **workspace** packages only. Remove `--filter better-sqlite3` when rebuilding dependencies.

### 4.4 “Ignored build scripts: better-sqlite3, puppeteer” warning

Means `ignore-scripts` was enabled previously. Reset with:

```bash
pnpm config set ignore-scripts false
PNPM_ALLOW_SCRIPTS=better-sqlite3,puppeteer pnpm install --force
```

---

## 5. Optional: Clean Reinstall

If you want a guaranteed clean slate:

```bash
rm -rf node_modules pnpm-lock.yaml
pnpm store prune

PNPM_ALLOW_SCRIPTS=better-sqlite3 pnpm install
npm_config_build_from_source=true PNPM_ALLOW_SCRIPTS=better-sqlite3 pnpm rebuild better-sqlite3
```

---

## 6. Verifying the Setup

1. Start the service: `pnpm start`
2. Add a subscription via `curl` (see §3).
3. Check the logs for the confirmation SMS notification.
4. Inspect `data/stock-checker.db` to confirm the tables were created:

   ```bash
   sqlite3 data/stock-checker.db '.tables'
   ```

5. Restart the service—monitors for active subscriptions resume automatically.

---

With these steps the repository installs and runs on macOS, Windows, and Linux without surprises. If you encounter a new failure case, append it to the troubleshooting section so future setups remain airtight.
