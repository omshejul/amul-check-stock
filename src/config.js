require('dotenv').config();

const REQUIRED_ENV_VARS = [
  'NOTIFICATION_API_URL',
  'NOTIFICATION_API_KEY',
  'API_KEY'
];

const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);

if (missing.length > 0) {
  console.error('❌ Missing required environment variables:');
  missing.forEach((key) => console.error(` - ${key}`));
  process.exit(1);
}

module.exports = {
  notification: {
    apiUrl: process.env.NOTIFICATION_API_URL,
    apiKey: process.env.NOTIFICATION_API_KEY
  },
  server: {
    port: Number.parseInt(process.env.PORT || '3000', 10),
    apiKey: process.env.API_KEY
  },
  puppeteer: {
    headless: process.env.PUPPETEER_HEADLESS || 'new'
  }
};

