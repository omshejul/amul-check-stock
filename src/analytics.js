const { PostHog } = require('posthog-node');

let posthogClient = null;
let isEnabled = false;

/**
 * Initialize PostHog if API key is provided
 * @param {Object} config - PostHog configuration
 * @param {string} config.apiKey - PostHog API key
 * @param {string} config.host - PostHog host URL (optional)
 */
function initPostHog(config) {
  if (!config || !config.apiKey) {
    console.log('📊 PostHog: Not configured (optional)');
    return;
  }

  try {
    posthogClient = new PostHog(config.apiKey, {
      host: config.host || 'https://app.posthog.com',
      flushAt: 1, // Send events immediately (default is 20)
      flushInterval: 0, // Disable batching interval (default is 10000ms)
      enableExceptionAutocapture: true // Auto-capture exceptions
    });
    isEnabled = true;
    console.log('📊 PostHog: Initialized successfully');
  } catch (error) {
    console.error('⚠️ PostHog: Failed to initialize:', error.message);
  }
}

/**
 * Track an event in PostHog (no-op if not configured)
 * @param {Object} params - Event parameters
 * @param {string} params.distinctId - Unique identifier for the user/entity
 * @param {string} params.event - Event name
 * @param {Object} params.properties - Event properties (optional)
 */
function track({ distinctId, event, properties = {} }) {
  if (!isEnabled || !posthogClient) {
    return;
  }

  try {
    posthogClient.capture({
      distinctId,
      event,
      properties,
    });
  } catch (error) {
    console.error('⚠️ PostHog: Failed to track event:', error.message);
  }
}

/**
 * Capture an exception in PostHog
 * @param {Error} error - The error object
 * @param {string} distinctId - Unique identifier for the user/entity
 * @param {Object} additionalProperties - Additional properties (optional)
 */
function captureException(error, distinctId = 'system', additionalProperties = {}) {
  if (!isEnabled || !posthogClient) {
    return;
  }

  try {
    posthogClient.captureException(error, distinctId, additionalProperties);
  } catch (err) {
    console.error('⚠️ PostHog: Failed to capture exception:', err.message);
  }
}

/**
 * Flush any pending events
 */
async function flush() {
  if (posthogClient) {
    try {
      await posthogClient.flush();
    } catch (error) {
      console.error('⚠️ PostHog: Error during flush:', error.message);
    }
  }
}

/**
 * Shutdown PostHog client gracefully
 */
async function shutdown() {
  if (posthogClient) {
    try {
      await posthogClient.shutdown();
      console.log('📊 PostHog: Shut down successfully');
    } catch (error) {
      console.error('⚠️ PostHog: Error during shutdown:', error.message);
    }
  }
}

/**
 * Get the PostHog client instance (for Express error handler)
 */
function getClient() {
  return posthogClient;
}

module.exports = {
  initPostHog,
  track,
  captureException,
  flush,
  shutdown,
  getClient,
  isEnabled: () => isEnabled,
};

