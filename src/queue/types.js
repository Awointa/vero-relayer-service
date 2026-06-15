const EVENT_TYPES = Object.freeze({
  GITHUB_PULL_REQUEST_MERGED: 'github.pull_request.merged'
});

/**
 * @typedef {Object} EventJobPayload
 * @property {string} eventType
 * @property {string} receivedAt
 * @property {string|null} requestId
 * @property {string|null} source
 * @property {string|null} idempotencyKey
 * @property {Object} payload
 * @property {string} payload.action
 * @property {Object} payload.pull_request
 * @property {number} payload.pull_request.number
 * @property {boolean} payload.pull_request.merged
 * @property {Array<{ id?: number|string, name: string }>} payload.pull_request.labels
 * @property {Object|null} payload.repository
 */

module.exports = {
  EVENT_TYPES
};
