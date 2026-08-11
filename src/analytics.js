const { PostHog } = require('posthog-node');
const { log, safeError } = require('./observability');

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
        log('info', 'posthog_not_configured');
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
        log('info', 'posthog_initialized');
    } catch (error) {
        log('warn', 'posthog_initialization_failed', { error_type: safeError(error).type });
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
        log('warn', 'posthog_event_failed', { error_type: safeError(error).type });
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
        log('warn', 'posthog_exception_capture_failed', { error_type: safeError(err).type });
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
            log('warn', 'posthog_flush_failed', { error_type: safeError(error).type });
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
            log('info', 'posthog_shutdown');
        } catch (error) {
            log('warn', 'posthog_shutdown_failed', { error_type: safeError(error).type });
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
