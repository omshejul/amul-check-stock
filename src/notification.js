const axios = require('axios');
const { notification } = require('./config');

const COLORS = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
};

async function sendNotification({ phoneNumber, message }) {
  try {
    const delayValue = Math.floor(Math.random() * 101) + 100;

    await axios.post(
      notification.apiUrl,
      {
        number: phoneNumber,
        text: message,
        delay: delayValue
      },
      {
        headers: {
          apikey: notification.apiKey,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log(`${COLORS.green}✓ Notification sent to ${phoneNumber}${COLORS.reset}`);
  } catch (error) {
    console.error(`${COLORS.red}Error sending notification to ${phoneNumber}:${COLORS.reset}`, error.message);
    if (error.response) {
      console.error(`${COLORS.yellow}Response: ${JSON.stringify(error.response.data)}${COLORS.reset}`);
    }
    throw error;
  }
}

module.exports = {
  sendNotification
};

