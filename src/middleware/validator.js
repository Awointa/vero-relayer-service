'use strict';
/**
 * src/middleware/validator.js
 *
 * Strict schema validation for incoming task payloads.
 * Zero runtime dependencies — designed to be swapped for zod once
 * network access is available (see package.json: "zod": "^3.23.8").
 *
 * Issue #36 requirements:
 *  - Define TaskPayload schema
 *  - validate(payload) called before ingest
 *  - Invalid payloads rejected with 400 Bad Request
 *  - Strictly whitelist expected properties (no parameter injection)
 */

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if value is a plain object (not null, not array).
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Returns the keys present in obj that are NOT in the allowed list.
 * Mirrors Zod's .strict() behaviour.
 * @param {Record<string, unknown>} obj
 * @param {string[]} allowed
 * @returns {string[]}
 */
function unknownKeys(obj, allowed) {
  return Object.keys(obj).filter((k) => !allowed.includes(k));
}

const LABEL_ALLOWED = ['id', 'name'];
const PR_ALLOWED    = ['id', 'node_id', 'number', 'merged', 'labels'];
const REPO_ALLOWED  = ['id', 'name', 'full_name'];
const ROOT_ALLOWED  = ['action', 'pull_request', 'repository'];

// ---------------------------------------------------------------------------
// Per-object validators
// ---------------------------------------------------------------------------

/**
 * @param {unknown} label
 * @param {string} path
 * @param {{ path: string, message: string }[]} errors
 */
function validateLabel(label, path, errors) {
  if (!isPlainObject(label)) {
    errors.push({ path, message: 'Each label must be a plain object' });
    return;
  }

  for (const k of unknownKeys(label, LABEL_ALLOWED)) {
    errors.push({ path: `${path}.${k}`, message: `Unrecognised property '${k}' — not allowed` });
  }

  if (!Object.prototype.hasOwnProperty.call(label, 'name') || label.name === undefined) {
    errors.push({ path: `${path}.name`, message: 'name is required' });
  } else if (typeof label.name !== 'string' || label.name.trim() === '') {
    errors.push({ path: `${path}.name`, message: 'Label name must be a non-empty string' });
  }

  if (Object.prototype.hasOwnProperty.call(label, 'id') && label.id !== undefined) {
    if (typeof label.id !== 'string' && typeof label.id !== 'number') {
      errors.push({ path: `${path}.id`, message: 'id must be a string or number' });
    }
  }
}

/**
 * @param {unknown} pr
 * @param {string} path
 * @param {{ path: string, message: string }[]} errors
 */
function validatePullRequest(pr, path, errors) {
  if (!isPlainObject(pr)) {
    errors.push({ path, message: 'pull_request must be a plain object' });
    return;
  }

  for (const k of unknownKeys(pr, PR_ALLOWED)) {
    errors.push({ path: `${path}.${k}`, message: `Unrecognised property '${k}' — not allowed` });
  }

  // number — required, positive integer
  if (!Object.prototype.hasOwnProperty.call(pr, 'number') || pr.number == null) {
    errors.push({ path: `${path}.number`, message: 'number is required' });
  } else if (typeof pr.number !== 'number' || !Number.isInteger(pr.number)) {
    errors.push({ path: `${path}.number`, message: 'PR number must be an integer' });
  } else if (pr.number <= 0) {
    errors.push({ path: `${path}.number`, message: 'PR number must be positive' });
  }

  // merged — required, boolean
  if (!Object.prototype.hasOwnProperty.call(pr, 'merged') || pr.merged == null) {
    errors.push({ path: `${path}.merged`, message: 'merged is required' });
  } else if (typeof pr.merged !== 'boolean') {
    errors.push({ path: `${path}.merged`, message: 'merged must be a boolean' });
  }

  // labels — optional array, defaults to []
  if (Object.prototype.hasOwnProperty.call(pr, 'labels') && pr.labels !== undefined) {
    if (!Array.isArray(pr.labels)) {
      errors.push({ path: `${path}.labels`, message: 'labels must be an array' });
    } else {
      pr.labels.forEach((label, i) => validateLabel(label, `${path}.labels.${i}`, errors));
    }
  }

  // optional typed fields
  if (Object.prototype.hasOwnProperty.call(pr, 'node_id') && pr.node_id !== undefined && typeof pr.node_id !== 'string') {
    errors.push({ path: `${path}.node_id`, message: 'node_id must be a string' });
  }
  if (Object.prototype.hasOwnProperty.call(pr, 'id') && pr.id !== undefined) {
    if (typeof pr.id !== 'string' && typeof pr.id !== 'number') {
      errors.push({ path: `${path}.id`, message: 'id must be a string or number' });
    }
  }
}

/**
 * @param {unknown} repo
 * @param {string} path
 * @param {{ path: string, message: string }[]} errors
 */
function validateRepository(repo, path, errors) {
  if (repo === null || repo === undefined) return; // nullable / optional — OK

  if (!isPlainObject(repo)) {
    errors.push({ path, message: 'repository must be a plain object or null' });
    return;
  }

  for (const k of unknownKeys(repo, REPO_ALLOWED)) {
    errors.push({ path: `${path}.${k}`, message: `Unrecognised property '${k}' — not allowed` });
  }

  for (const field of ['name', 'full_name']) {
    if (Object.prototype.hasOwnProperty.call(repo, field) && repo[field] !== undefined && typeof repo[field] !== 'string') {
      errors.push({ path: `${path}.${field}`, message: `${field} must be a string` });
    }
  }

  if (Object.prototype.hasOwnProperty.call(repo, 'id') && repo.id !== undefined) {
    if (typeof repo.id !== 'string' && typeof repo.id !== 'number') {
      errors.push({ path: `${path}.id`, message: 'id must be a string or number' });
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate an incoming payload against the TaskPayload schema.
 * Call this before handing the payload to the ingest / queue layer.
 *
 * @param {unknown} payload - Raw request body
 * @returns {{ success: true, data: object } | { success: false, errors: { path: string, message: string }[] }}
 */
function validate(payload) {
  /** @type {{ path: string, message: string }[]} */
  const errors = [];

  if (!isPlainObject(payload)) {
    return { success: false, errors: [{ path: '', message: 'Payload must be a plain object' }] };
  }

  // Strictly whitelist top-level keys
  for (const k of unknownKeys(payload, ROOT_ALLOWED)) {
    errors.push({ path: k, message: `Unrecognised property '${k}' — not allowed` });
  }

  // action — required, non-empty string
  if (!Object.prototype.hasOwnProperty.call(payload, 'action') || payload.action == null) {
    errors.push({ path: 'action', message: 'action is required' });
  } else if (typeof payload.action !== 'string' || payload.action.trim() === '') {
    errors.push({ path: 'action', message: 'action must be a non-empty string' });
  }

  // pull_request — required
  if (!Object.prototype.hasOwnProperty.call(payload, 'pull_request') || payload.pull_request == null) {
    errors.push({ path: 'pull_request', message: 'pull_request is required' });
  } else {
    validatePullRequest(payload.pull_request, 'pull_request', errors);
  }

  // repository — optional / nullable
  validateRepository(payload.repository, 'repository', errors);

  if (errors.length > 0) {
    return { success: false, errors };
  }

  // Build coerced, strictly whitelisted output
  const pr = payload.pull_request;
  const rawLabels = Array.isArray(pr.labels) ? pr.labels : [];

  const data = {
    action: payload.action.trim(),
    pull_request: {
      ...(pr.id     !== undefined && { id: pr.id }),
      ...(pr.node_id !== undefined && { node_id: pr.node_id }),
      number: pr.number,
      merged: pr.merged,
      labels: rawLabels.map((l) => ({
        ...(l.id !== undefined && { id: l.id }),
        name: l.name,
      })),
    },
    ...(Object.prototype.hasOwnProperty.call(payload, 'repository') && {
      repository: payload.repository
        ? (() => {
            const r = payload.repository;
            return {
              ...(r.id        !== undefined && { id: r.id }),
              ...(r.name      !== undefined && { name: r.name }),
              ...(r.full_name !== undefined && { full_name: r.full_name }),
            };
          })()
        : null,
    }),
  };

  return { success: true, data };
}

/**
 * Express middleware — validates req.body against the TaskPayload schema.
 * Responds 400 Bad Request with { error, details[] } on failure.
 * Replaces req.body with the validated, coerced payload on success.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function validateTaskPayload(req, res, next) {
  const result = validate(req.body);

  if (!result.success) {
    res.status(400).json({
      error: 'Invalid task payload',
      details: result.errors,
    });
    return;
  }

  req.body = result.data;
  next();
}

module.exports = { validate, validateTaskPayload };
