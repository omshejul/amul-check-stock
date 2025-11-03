# Amul Stock Checker

A Node.js script to automatically check stock availability for Amul products using Puppeteer. The script automatically sets your delivery pincode and detects stock status through multiple detection methods.

## Features

- ✅ Automatically sets delivery pincode before checking stock
- ✅ Multiple stock detection methods (button states, text analysis, badges)
- ✅ Runs once or continuously at configurable intervals
- ✅ Environment variable support for easy configuration
- ✅ Color-coded terminal output for easy reading
- ✅ Sends notifications via API when stock becomes available

## Setup

1. Install dependencies:

```bash
npm install
```

This will install:

- `puppeteer` - Headless browser for JavaScript-rendered pages
- `dotenv` - Environment variable support
- `axios` - HTTP client for API notifications

2. Create a `.env` file in the project root with all required variables:

```env
PRODUCT_URL=https://shop.amul.com/en/product/amul-high-protein-blueberry-shake-200-ml-or-pack-of-30
DELIVERY_PINCODE=431136
CHECK_INTERVAL_MINUTES=5
NOTIFICATION_API_URL=https://nodered.omshejul.com/message/sendText/bot
NOTIFICATION_API_KEY=1234
NOTIFICATION_PHONE_NUMBER=917775977750
```

## Usage

### Run once (check stock immediately):

```bash
npm run check
# or
node check-stock.js --once
```

### Run continuously (check every 5 minutes by default):

```bash
npm start
# or
node check-stock.js
```

Press `Ctrl+C` to stop the continuous checking.

## Configuration

The script requires all configuration via environment variables (using a `.env` file). All variables are **required**:

| Variable                    | Description                                | Required                 |
| --------------------------- | ------------------------------------------ | ------------------------ |
| `PRODUCT_URL`               | Product page URL to monitor                | ✅ Yes                   |
| `DELIVERY_PINCODE`          | Delivery pincode to set before checking    | ✅ Yes                   |
| `CHECK_INTERVAL_MINUTES`    | Minutes between checks (continuous mode)   | Optional (defaults to 5) |
| `NOTIFICATION_API_URL`      | API endpoint URL for sending notifications | ✅ Yes                   |
| `NOTIFICATION_API_KEY`      | API key for authentication                 | ✅ Yes                   |
| `NOTIFICATION_PHONE_NUMBER` | Phone number to send notifications to      | ✅ Yes                   |

**Note:** The script will exit with an error if any required environment variable is missing.

## How It Works

1. Launches a headless Chrome browser using Puppeteer
2. Navigates to the product page
3. Automatically sets the delivery pincode if needed
4. Waits for the page to fully load
5. Analyzes the page for stock indicators:
   - Add to Cart button state (enabled = in stock)
   - Stock status badges/text
   - "Notify Me" buttons (indicates out of stock)
   - Page text analysis
6. Displays results with color-coded output
7. Sends notification via API when stock becomes available

## Output

- ✅ **Green** - Product is in stock
- ❌ **Red** - Product is out of stock
- ⚠️ **Yellow** - Could not determine stock status

## Troubleshooting

If the script reports "Could not determine stock status":

- The page structure may have changed
- The product page might require additional authentication
- Check the URL manually to verify it's correct

If pincode setting fails:

- Verify the pincode is correct for your delivery area
- Check if the Amul website structure has changed
- The script will still attempt to check stock even if pincode setting fails

## Requirements

- Node.js (v14 or higher recommended)
- Internet connection
- Chrome/Chromium (automatically downloaded by Puppeteer)

## License

ISC
