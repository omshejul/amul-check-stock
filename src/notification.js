const axios = require('axios');
const { notification } = require('./config');

const { log } = require('./observability');

class PhoneVerificationError extends Error {
  constructor(message, statusCode, code) {
    super(message);
    this.name = 'PhoneVerificationError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

async function verifyWhatsAppNumber(phoneNumber) {
  const number = typeof phoneNumber === 'string' ? phoneNumber.replace(/[\s()-]/g, '').replace(/^\+/, '') : '';
  if (!/^[1-9]\d{7,14}$/.test(number)) {
    throw new PhoneVerificationError('Enter a valid WhatsApp number including its country code.', 400, 'INVALID_PHONE_NUMBER');
  }

  let result;
  try {
    if (!notification.verificationUrl) throw new Error('Verification is not configured');
    const response = await axios.post(notification.verificationUrl, { numbers: [number] }, {
      headers: { apikey: notification.apiKey, 'Content-Type': 'application/json' },
      timeout: 8000,
      maxRedirects: 0
    });
    result = Array.isArray(response.data) && response.data.find((entry) =>
      String(entry?.number).replace(/^\+/, '') === number && typeof entry?.exists === 'boolean');
    if (!result) throw new Error('Invalid verification response');
  } catch {
    // Never attach provider errors, which can contain credentials and phone numbers.
    throw new PhoneVerificationError('We could not verify your WhatsApp number right now. Please try again shortly.', 503, 'WHATSAPP_VERIFICATION_UNAVAILABLE');
  }
  if (!result.exists) {
    throw new PhoneVerificationError('This number is not registered on WhatsApp. Enter a WhatsApp number including its country code.', 400, 'WHATSAPP_NOT_REGISTERED');
  }
  return `+${number}`;
}

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
  sendNotification,
  verifyWhatsAppNumber,
  PhoneVerificationError
};
