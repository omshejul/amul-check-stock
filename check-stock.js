const puppeteer = require('puppeteer');
const axios = require('axios');
require('dotenv').config();

if (!process.env.PRODUCT_URL) {
  console.error('❌ ERROR: PRODUCT_URL environment variable is required!');
  console.error('Please set PRODUCT_URL in your .env file or environment variables.');
  process.exit(1);
}

if (!process.env.DELIVERY_PINCODE) {
  console.error('❌ ERROR: DELIVERY_PINCODE environment variable is required!');
  console.error('Please set DELIVERY_PINCODE in your .env file or environment variables.');
  process.exit(1);
}

if (!process.env.NOTIFICATION_API_URL) {
  console.error('❌ ERROR: NOTIFICATION_API_URL environment variable is required!');
  console.error('Please set NOTIFICATION_API_URL in your .env file or environment variables.');
  process.exit(1);
}

if (!process.env.NOTIFICATION_API_KEY) {
  console.error('❌ ERROR: NOTIFICATION_API_KEY environment variable is required!');
  console.error('Please set NOTIFICATION_API_KEY in your .env file or environment variables.');
  process.exit(1);
}

if (!process.env.NOTIFICATION_PHONE_NUMBER) {
  console.error('❌ ERROR: NOTIFICATION_PHONE_NUMBER environment variable is required!');
  console.error('Please set NOTIFICATION_PHONE_NUMBER in your .env file or environment variables.');
  process.exit(1);
}

const PRODUCT_URL = process.env.PRODUCT_URL;
const DELIVERY_PINCODE = process.env.DELIVERY_PINCODE;
const CHECK_INTERVAL_MINUTES = Number.parseInt(process.env.CHECK_INTERVAL_MINUTES, 10) || 5;
const CHECK_INTERVAL_MS = CHECK_INTERVAL_MINUTES * 60 * 1000;

// Notification API configuration
const NOTIFICATION_API_URL = process.env.NOTIFICATION_API_URL;
const NOTIFICATION_API_KEY = process.env.NOTIFICATION_API_KEY;
const NOTIFICATION_PHONE_NUMBER = process.env.NOTIFICATION_PHONE_NUMBER;

// Track if we've already sent a notification for this stock check session
let hasSentNotification = false;

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Function to send notification
async function sendStockNotification(productUrl, customMessage = null) {
  try {
    const delayValue = Math.floor(Math.random() * 101) + 100;
    const message = customMessage || `🎉 Stock Available! 🎉\n\nProduct is now in stock!\n\n${productUrl}\n\nHurry and place your order!`;

    const response = await axios.post(
      NOTIFICATION_API_URL,
      {
        number: NOTIFICATION_PHONE_NUMBER,
        text: message,
        delay: delayValue
      },
      {
        headers: {
          'apikey': NOTIFICATION_API_KEY,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log(`${colors.green}✓ Notification sent successfully${colors.reset}`);
    return true;
  } catch (error) {
    console.error(`${colors.red}Error sending notification:${colors.reset}`, error.message);
    if (error.response) {
      console.error(`Status: ${error.response.status}`);
      console.error(`Response: ${JSON.stringify(error.response.data)}`);
    }
    return false;
  }
}

// ANSI color codes for terminal output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m',
  bold: '\x1b[1m'
};

async function setDeliveryPincode(page) {
  if (!DELIVERY_PINCODE) {
    return false;
  }

  try {
    const bodyText = await page.evaluate(() => document.body.innerText.toLowerCase());
    if (!bodyText.includes('pincode')) {
      return false;
    }

    console.log(`${colors.blue}Setting delivery pincode: ${DELIVERY_PINCODE}...${colors.reset}`);

    // Try to open location modal if needed
    const openButtons = await page.$$('button, [role="button"], a');
    for (const button of openButtons) {
      const buttonInfo = await page.evaluate((el) => {
        return {
          text: (el.textContent || '').toLowerCase(),
          ariaLabel: (el.getAttribute('aria-label') || '').toLowerCase(),
          dataTarget: el.getAttribute('data-target') || el.getAttribute('data-bs-target') || ''
        };
      }, button);

      if (
        buttonInfo.text.includes('change pincode') ||
        buttonInfo.text.includes('select pincode') ||
        buttonInfo.text.includes('set pincode') ||
        buttonInfo.text.includes('deliver to') ||
        buttonInfo.text.includes('change location') ||
        buttonInfo.ariaLabel.includes('pincode') ||
        buttonInfo.dataTarget.includes('location')
      ) {
        try {
          await button.click();
          await delay(800);
          break;
        } catch (err) {
          // Ignore and continue
        }
      }
    }

    // Look for pincode input field using multiple selectors
    const selectors = [
      'input[placeholder*="pincode"]',
      'input[placeholder*="pin"]',
      'input[name*="pincode"]',
      'input[name*="pin"]',
      'input[id*="pincode"]',
      'input[id*="pin"]',
      'input[type="search"]',
      'input[type="text"]',
      'input[type="number"]'
    ];

    let inputHandle = null;

    for (const selector of selectors) {
      const elements = await page.$$(selector);
      for (const element of elements) {
        const info = await page.evaluate((el) => {
          return {
            placeholder: (el.placeholder || '').toLowerCase(),
            name: (el.name || '').toLowerCase(),
            id: (el.id || '').toLowerCase(),
            visible: el.offsetParent !== null
          };
        }, element);

        if (
          info.visible &&
          (info.placeholder.includes('pin') || info.name.includes('pin') || info.id.includes('pin') || selector.includes('pin'))
        ) {
          inputHandle = element;
          break;
        }
      }
      if (inputHandle) break;
    }

    if (!inputHandle) {
      console.log(`${colors.yellow}Could not find pincode input field${colors.reset}`);
      return false;
    }

    await inputHandle.click({ clickCount: 3 });
    await delay(200);
    await page.evaluate((el) => {
      el.value = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, inputHandle);
    await inputHandle.type(DELIVERY_PINCODE, { delay: 120 });
    await delay(600);

    // Try to select autocomplete suggestion (Google Places, etc.)
    let suggestionSelected = false;
    try {
      await page.waitForSelector('.pac-item', { timeout: 4000 });
      const suggestions = await page.$$('.pac-item');
      for (const suggestion of suggestions) {
        const suggestionText = await page.evaluate((el) => (el.textContent || '').toLowerCase(), suggestion);
        if (suggestionText.includes(DELIVERY_PINCODE)) {
          await suggestion.click();
          suggestionSelected = true;
          break;
        }
      }

      if (!suggestionSelected && suggestions.length > 0) {
        await suggestions[0].click();
        suggestionSelected = true;
      }

      if (suggestionSelected) {
        console.log(`${colors.green}✓ Selected pincode suggestion${colors.reset}`);
        await delay(1000);
      }
    } catch (err) {
      // No suggestions, fall back to pressing Enter
    }

    if (!suggestionSelected) {
      await inputHandle.press('Enter');
      console.log(`${colors.green}✓ Pincode entered (pressed Enter)${colors.reset}`);
      await delay(1000);
    }

    // Click any confirmation/apply button if present
    const buttons = await page.$$('button, [role="button"], input[type="submit"]');
    for (const button of buttons) {
      const info = await page.evaluate((btn) => {
        return {
          text: (btn.textContent || '').toLowerCase(),
          ariaLabel: (btn.getAttribute('aria-label') || '').toLowerCase(),
          visible: btn.offsetParent !== null
        };
      }, button);

      if (
        info.visible &&
        (info.text.includes('apply') ||
          info.text.includes('submit') ||
          info.text.includes('confirm') ||
          info.text.includes('deliver') ||
          info.text.includes('set') ||
          info.text.includes('continue') ||
          info.ariaLabel.includes('apply') ||
          info.ariaLabel.includes('submit'))
      ) {
        try {
          await button.click();
          console.log(`${colors.green}✓ Pincode confirmed${colors.reset}`);
          await delay(1500);
          break;
        } catch (err) {
          // Ignore click errors
        }
      }
    }

    // Wait for any navigation or content update
    try {
      await Promise.race([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 4000 }),
        delay(2000)
      ]);
    } catch (err) {
      // Ignore timeouts
    }

    const success = await page.evaluate((pin) => {
      const body = document.body.innerText || '';
      return body.includes(pin);
    }, DELIVERY_PINCODE);

    if (success) {
      console.log(`${colors.green}✓ Delivery pincode applied${colors.reset}`);
    } else {
      console.log(`${colors.yellow}Could not confirm delivery pincode on the page${colors.reset}`);
    }

    return success;
  } catch (error) {
    console.log(`${colors.yellow}Could not set pincode automatically: ${error.message}${colors.reset}`);
    return false;
  }
}

async function checkStock() {
  const timestamp = new Date().toLocaleString();
  let browser = null;
  
  try {
    console.log(`${colors.blue}[${timestamp}]${colors.reset} Checking stock status...`);
    
    // Launch browser
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    
    // Set user agent to avoid detection
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // Navigate to the product page
    await page.goto(PRODUCT_URL, { 
      waitUntil: 'domcontentloaded',
      timeout: 30000 
    });
    
    // Wait for page to fully load (give it a moment for JS to render)
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Set delivery pincode if possible and ensure we are on the product page
    await setDeliveryPincode(page);

    if (page.url() !== PRODUCT_URL) {
      await page.goto(PRODUCT_URL, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });
      await delay(4000);
    }

    // Try to close any modals or popups (like cookie consent, location selector)
    try {
      // Look for and click common close buttons
      const closeButtons = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button, [role="button"], .close, [aria-label*="close" i], [aria-label*="dismiss" i]'));
        return buttons.filter(btn => {
          const text = btn.textContent.toLowerCase();
          const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
          return text.includes('close') || text.includes('dismiss') || 
                 text.includes('×') || text.includes('x') ||
                 ariaLabel.includes('close') || ariaLabel.includes('dismiss');
        }).slice(0, 3); // Get first 3 close buttons
      });
      
      for (const button of closeButtons) {
        try {
          await page.click(`button:has-text("${button.textContent}")`);
          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (e) {
          // Ignore if can't click
        }
      }
    } catch (e) {
      // Ignore errors in modal handling
    }
    
    const availabilityInfo = await page.evaluate(() => {
      const normalize = (text) => (text || '').replace(/\s+/g, ' ').trim();
      const toLower = (text) => normalize(text).toLowerCase();
      const isVisible = (el) => {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        return style && style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity || '1') > 0 && el.offsetParent !== null;
      };

      const result = {
        addToCart: null,
        notifyButtons: [],
        soldOutBadges: [],
        sectionTextSnippet: '',
        bodyTextSnippet: ''
      };

      const primaryAddToCart = document.querySelector('.add-to-cart');
      let addToCartEl = primaryAddToCart;

      if (!addToCartEl) {
        addToCartEl = Array.from(document.querySelectorAll('button, a')).find((el) => toLower(el.textContent).includes('add to cart')) || null;
      }

      if (addToCartEl) {
        result.addToCart = {
          text: normalize(addToCartEl.textContent),
          disabled: Boolean(addToCartEl.disabled) || toLower(addToCartEl.className).includes('disabled') || addToCartEl.getAttribute('aria-disabled') === 'true',
          visible: isVisible(addToCartEl),
          classes: addToCartEl.className
        };
      }

      let productSection = null;
      if (addToCartEl) {
        productSection = addToCartEl.closest('.product-detail, .product-details, .product-info, .product-content, .product-right, .product_page, .product-layout, .product-summary, form');
      }

      if (!productSection) {
        productSection = document.querySelector('.product-detail, .product-details, .product-info, .product-content, .product-right, .product_page, .product-layout, .product-summary');
      }

      if (!productSection) {
        productSection = document.querySelector('main') || document.body;
      }

      const sectionText = toLower(productSection ? productSection.innerText : '');
      result.sectionTextSnippet = sectionText.slice(0, 500);
      result.bodyTextSnippet = toLower(document.body.innerText).slice(0, 500);

      result.notifyButtons = Array.from(productSection.querySelectorAll('button, a'))
        .filter((el) => isVisible(el) && toLower(el.textContent).includes('notify me'))
        .map((el) => normalize(el.textContent));

      result.soldOutBadges = Array.from(productSection.querySelectorAll('[class*="sold"], [class*="out"], [id*="sold"], [id*="out"]'))
        .filter((el) => isVisible(el) && (toLower(el.textContent).includes('sold out') || toLower(el.textContent).includes('out of stock') || toLower(el.textContent).includes('currently unavailable')))
        .map((el) => normalize(el.textContent));

      return result;
    });

    let stockStatus = null;
    let isAvailable = false;

    const errorIndicators = ['we are sorry', 'not a functioning page', 'page not found', '404'];
    if (errorIndicators.some((token) => (availabilityInfo.bodyTextSnippet || '').includes(token))) {
      console.log(`${colors.yellow}Warning: Page shows error messaging, attempting to read stock status anyway...${colors.reset}`);
    }

    if (availabilityInfo.addToCart && availabilityInfo.addToCart.visible) {
      if (!availabilityInfo.addToCart.disabled) {
        isAvailable = true;
        stockStatus = 'IN STOCK';
      } else {
        isAvailable = false;
        stockStatus = 'OUT OF STOCK';
      }
    }

    if (stockStatus === null) {
      const section = availabilityInfo.sectionTextSnippet || '';
      const positiveTokens = ['in stock', 'available now', 'ready to ship'];
      const negativeTokens = ['out of stock', 'sold out', 'currently unavailable', 'notify me'];

      const hasPositive = positiveTokens.some((token) => section.includes(token));
      const hasNegative = negativeTokens.some((token) => section.includes(token)) ||
        availabilityInfo.notifyButtons.length > 0 || availabilityInfo.soldOutBadges.length > 0;

      if (hasPositive && !hasNegative) {
        isAvailable = true;
        stockStatus = 'IN STOCK';
      } else if (hasNegative && !hasPositive) {
        isAvailable = false;
        stockStatus = 'OUT OF STOCK';
      }
    }

    if (stockStatus === null) {
      const body = availabilityInfo.bodyTextSnippet || '';
      const hasPositive = body.includes('add to cart') || body.includes('in stock');
      const hasNegative = body.includes('out of stock') || body.includes('sold out') || body.includes('currently unavailable') || body.includes('notify me');

      if (hasPositive && !hasNegative) {
        isAvailable = true;
        stockStatus = 'IN STOCK';
      } else if (hasNegative && !hasPositive) {
        isAvailable = false;
        stockStatus = 'OUT OF STOCK';
      }
    }
    
    // Display results
    if (stockStatus) {
      if (isAvailable) {
        console.log(`${colors.green}${colors.bold}✓ STOCK AVAILABLE!${colors.reset}`);
        console.log(`${colors.green}Product is currently in stock.${colors.reset}`);
        console.log(`${colors.yellow}${colors.bold}🎉 HURRY!${colors.reset}`);
        
        // Send notification if stock is available and we haven't sent one yet
        if (!hasSentNotification) {
          console.log(`${colors.blue}Sending notification...${colors.reset}`);
          await sendStockNotification(PRODUCT_URL);
          hasSentNotification = true;
        }
      } else {
        console.log(`${colors.red}${colors.bold}✗ OUT OF STOCK${colors.reset}`);
        console.log(`${colors.yellow}Product is currently unavailable.${colors.reset}`);
        // Reset notification flag when stock goes out, so we notify again when it comes back
        hasSentNotification = false;
      }
      console.log(`Status: ${stockStatus}\n`);
    } else {
      console.log(`${colors.yellow}⚠ Could not determine stock status automatically.${colors.reset}`);
      console.log(`${colors.blue}Please check the page manually: ${PRODUCT_URL}${colors.reset}\n`);
      
      // Get page title for debugging
      const pageTitle = await page.title();
      const pageTextPreview = pageText.substring(0, 300);
      console.log(`${colors.blue}Page title: ${pageTitle || 'Not found'}${colors.reset}`);
      console.log(`${colors.blue}Page text preview: ${pageTextPreview}...${colors.reset}\n`);
    }
    
    await browser.close();
    return { isAvailable, stockStatus, timestamp };

  } catch (error) {
    if (browser) {
      await browser.close();
    }
    console.error(`${colors.red}Error checking stock:${colors.reset}`, error.message);
    return { isAvailable: false, stockStatus: 'ERROR', timestamp, error: error.message };
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  const runOnce = args.includes('--once') || args.includes('-o');

  console.log(`${colors.bold}${colors.blue}Amul Stock Checker${colors.reset}`);
  console.log(`Product URL: ${PRODUCT_URL}\n`);

  // Send test notification on startup
  console.log(`${colors.blue}Sending test notification...${colors.reset}`);
  await sendStockNotification(PRODUCT_URL, `🧪 Test Notification\n\nAmul Stock Checker has started!\n\nMonitoring: ${PRODUCT_URL}\n\nYou will receive notifications when stock becomes available.`);
  console.log('');

  if (runOnce) {
    await checkStock();
  } else {
    console.log(`Running continuously (checking every ${CHECK_INTERVAL_MINUTES} minutes)...`);
    console.log(`Press Ctrl+C to stop.\n`);
    
    // Run immediately
    await checkStock();
    
    // Then run at intervals
    setInterval(async () => {
      await checkStock();
    }, CHECK_INTERVAL_MS);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log(`\n${colors.yellow}Stopping stock checker...${colors.reset}`);
  process.exit(0);
});

main();
