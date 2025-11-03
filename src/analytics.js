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

module.exports = {
    initPostHog,
    track,
    shutdown,
    isEnabled: () => isEnabled,
};

