const puppeteer = require('puppeteer');
const { puppeteer: puppeteerConfig } = require('./config');

const COLORS = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m',
  bold: '\x1b[1m'
};

function colorize({ color, bold = false }, text) {
  const parts = [];
  if (bold) parts.push(COLORS.bold);
  if (color) parts.push(COLORS[color]);
  parts.push(text, COLORS.reset);
  return parts.join('');
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function setDeliveryPincode(page, deliveryPincode) {
  if (!deliveryPincode) {
    return false;
  }

  try {
    const bodyText = await page.evaluate(() => document.body.innerText.toLowerCase());
    if (!bodyText.includes('pincode')) {
      return false;
    }

    console.log(colorize({ color: 'blue' }, `Setting delivery pincode: ${deliveryPincode}...`));

    // Try to open location modal if needed
    const openButtons = await page.$$('button, [role="button"], a');
    for (const button of openButtons) {
      const buttonInfo = await page.evaluate((el) => ({
        text: (el.textContent || '').toLowerCase(),
        ariaLabel: (el.getAttribute('aria-label') || '').toLowerCase(),
        dataTarget: el.getAttribute('data-target') || el.getAttribute('data-bs-target') || ''
      }), button);

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
        } catch (error) {
          // Ignore click failures and continue
        }
      }
    }

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
        const info = await page.evaluate((el) => ({
          placeholder: (el.placeholder || '').toLowerCase(),
          name: (el.name || '').toLowerCase(),
          id: (el.id || '').toLowerCase(),
          visible: el.offsetParent !== null
        }), element);

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
      console.log(colorize({ color: 'yellow' }, 'Could not find pincode input field'));
      return false;
    }

    await inputHandle.click({ clickCount: 3 });
    await delay(200);
    await page.evaluate((el) => {
      el.value = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, inputHandle);
    await inputHandle.type(deliveryPincode, { delay: 120 });
    await delay(600);

    let suggestionSelected = false;
    try {
      await page.waitForSelector('.pac-item', { timeout: 4000 });
      const suggestions = await page.$$('.pac-item');
      for (const suggestion of suggestions) {
        const suggestionText = await page.evaluate((el) => (el.textContent || '').toLowerCase(), suggestion);
        if (suggestionText.includes(deliveryPincode)) {
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
        console.log(colorize({ color: 'green' }, '✓ Selected pincode suggestion'));
        await delay(1000);
      }
    } catch (error) {
      // No suggestions available
    }

    if (!suggestionSelected) {
      await inputHandle.press('Enter');
      console.log(colorize({ color: 'green' }, '✓ Pincode entered (pressed Enter)'));
      await delay(1000);
    }

    const buttons = await page.$$('button, [role="button"], input[type="submit"]');
    for (const button of buttons) {
      const info = await page.evaluate((btn) => ({
        text: (btn.textContent || '').toLowerCase(),
        ariaLabel: (btn.getAttribute('aria-label') || '').toLowerCase(),
        visible: btn.offsetParent !== null
      }), button);

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
          console.log(colorize({ color: 'green' }, '✓ Pincode confirmed'));
          await delay(1500);
          break;
        } catch (error) {
          // Ignore
        }
      }
    }

    try {
      await Promise.race([
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 5000 }),
        delay(3000)
      ]);
    } catch (error) {
      // Ignore timeout
    }

    // Wait a bit more for the page to stabilize after navigation
    await delay(1000);

    // Safely check if pincode was applied
    let success = false;
    try {
      success = await page.evaluate((pin) => {
        const body = document.body.innerText || '';
        return body.includes(pin);
      }, deliveryPincode);
    } catch (error) {
      // If evaluation fails due to navigation, assume success and let the main function verify
      console.log(colorize({ color: 'yellow' }, 'Could not verify pincode due to page navigation'));
      success = false;
    }

    if (success) {
      console.log(colorize({ color: 'green' }, '✓ Delivery pincode applied'));
    } else {
      console.log(colorize({ color: 'yellow' }, 'Could not confirm delivery pincode on the page'));
    }

    return success;
  } catch (error) {
    console.log(colorize({ color: 'yellow' }, `Could not set pincode automatically: ${error.message}`));
    return false;
  }
}

async function checkProductStock({ productUrl, deliveryPincode }) {
  const timestamp = new Date().toLocaleString();
  console.log(colorize({ color: 'blue' }, `[${timestamp}] Checking stock status for ${productUrl}`));

  const browser = await puppeteer.launch({
    headless: puppeteerConfig.headless,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  let page;

  try {
    page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    await page.goto(productUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    await delay(5000);

    await setDeliveryPincode(page, deliveryPincode);

    // Give the page time to stabilize after pincode setting
    await delay(2000);

    if (page.url() !== productUrl) {
      await page.goto(productUrl, {
        waitUntil: 'networkidle2',
        timeout: 30000
      });
      await delay(3000);
    } else {
      // Even if we're on the same URL, wait a bit for any dynamic updates
      await delay(2000);
    }

    try {
      const closeButtons = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button, [role="button"], .close, [aria-label*="close" i], [aria-label*="dismiss" i]'));
        return buttons
          .filter((btn) => {
            const text = (btn.textContent || '').toLowerCase();
            const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
            return text.includes('close') || text.includes('dismiss') ||
              text.includes('×') || text.includes('x') ||
              ariaLabel.includes('close') || ariaLabel.includes('dismiss');
          })
          .slice(0, 3)
          .map((btn) => btn.textContent.trim());
      });

      for (const textContent of closeButtons) {
        try {
          await page.click(`button:has-text("${textContent}")`);
          await delay(500);
        } catch (error) {
          // Ignore
        }
      }
    } catch (error) {
      // Ignore modal close errors
    }

    const availabilityInfo = await page.evaluate(() => {
      const normalize = (text) => (text || '').replace(/\s+/g, ' ').trim();
      const toLower = (text) => normalize(text).toLowerCase();
      const isVisible = (el) => {
        if (!el) return false;
        try {
          const style = window.getComputedStyle(el);
          return style && style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity || '1') > 0 && el.offsetParent !== null;
        } catch (error) {
          return false;
        }
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
        try {
          addToCartEl = Array.from(document.querySelectorAll('button, a')).find((el) => toLower(el.textContent).includes('add to cart')) || null;
        } catch (error) {
          addToCartEl = null;
        }
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
        try {
          productSection = addToCartEl.closest('.product-detail, .product-details, .product-info, .product-content, .product-right, .product_page, .product-layout, .product-summary, form');
        } catch (error) {
          productSection = null;
        }
      }

      if (!productSection) {
        productSection = document.querySelector('.product-detail, .product-details, .product-info, .product-content, .product-right, .product_page, .product-layout, .product-summary');
      }

      if (!productSection) {
        productSection = document.querySelector('main') || document.body;
      }

      let sectionText = '';
      let bodyText = '';

      try {
        sectionText = toLower(productSection && productSection.innerText ? productSection.innerText : '');
        result.sectionTextSnippet = sectionText.slice(0, 500);
      } catch (error) {
        result.sectionTextSnippet = '';
      }

      try {
        bodyText = toLower(document.body && document.body.innerText ? document.body.innerText : '');
        result.bodyTextSnippet = bodyText.slice(0, 500);
      } catch (error) {
        result.bodyTextSnippet = '';
      }

      try {
        if (productSection) {
          result.notifyButtons = Array.from(productSection.querySelectorAll('button, a'))
            .filter((el) => isVisible(el) && toLower(el.textContent).includes('notify me'))
            .map((el) => normalize(el.textContent));

          result.soldOutBadges = Array.from(productSection.querySelectorAll('[class*="sold"], [class*="out"], [id*="sold"], [id*="out"]'))
            .filter((el) => isVisible(el) && (toLower(el.textContent).includes('sold out') || toLower(el.textContent).includes('out of stock') || toLower(el.textContent).includes('currently unavailable')))
            .map((el) => normalize(el.textContent));
        }
      } catch (error) {
        // Ignore errors when querying for buttons/badges
      }

      return result;
    });

    let stockStatus = null;
    let isAvailable = false;

    const errorIndicators = ['we are sorry', 'not a functioning page', 'page not found', '404'];
    if (errorIndicators.some((token) => (availabilityInfo.bodyTextSnippet || '').includes(token))) {
      console.log(colorize({ color: 'yellow' }, 'Warning: Page shows error messaging, attempting to read stock status anyway...'));
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

    if (stockStatus) {
      if (isAvailable) {
        console.log(colorize({ color: 'green', bold: true }, '✓ STOCK AVAILABLE!'));
      } else {
        console.log(colorize({ color: 'red', bold: true }, '✗ OUT OF STOCK'));
      }
      console.log(`Status: ${stockStatus}\n`);
    } else {
      console.log(colorize({ color: 'yellow' }, '⚠ Could not determine stock status automatically.'));
      console.log(colorize({ color: 'blue' }, `Please check the page manually: ${productUrl}`));
    }

    const pageTitle = await page.title();

    return {
      isAvailable,
      stockStatus: stockStatus || 'UNKNOWN',
      pageTitle
    };
  } catch (error) {
    console.error(colorize({ color: 'red' }, `Error checking stock: ${error.message}`));
    throw error;
  } finally {
    if (page) {
      await page.close();
    }
    await browser.close();
  }
}

module.exports = {
  checkProductStock
};

