const axios = require('axios');
const { notification } = require('./config');

const { log } = require('./observability');

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

    log('info', 'notification_sent', { provider: 'whatsapp' });
  } catch (error) {
    throw error;
  }
}

module.exports = {
  sendNotification
};
