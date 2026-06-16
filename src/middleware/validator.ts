/**
 * src/middleware/validator.ts
 *
 * Strict schema validation for incoming task payloads.
 * Zero runtime dependencies — mirrors the Zod API shape so it can be
 * swapped for the real `zod` package once network access is available.
 *
 * Issue #36 requirements:
 *  - Define TaskPayload schema
 *  - Validate on entry via validate() called before ingest
 *  - Reject invalid payloads with 400 Bad Request
 *  - Strictly whitelist expected properties (no parameter injection)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TaskPayloadLabel {
  id?: number | string;
  name: string;
}

export interface TaskPayloadPullRequest {
  id?: number | string;
  node_id?: string;
  number: number;
  merged: boolean;
  labels: TaskPayloadLabel[];
}

export interface TaskPayloadRepository {
  id?: number | string;
  name?: string;
  full_name?: string;
}

export interface TaskPayload {
  action: string;
  pull_request: TaskPayloadPullRequest;
  repository?: TaskPayloadRepository | null;
}

export interface ValidationError {
  path: string;
  message: string;
}

export type ValidationResult =
  | { success: true; data: TaskPayload }
  | { success: false; errors: ValidationError[] };

// ---------------------------------------------------------------------------
// Schema helpers – tiny hand-rolled validator (Zod-compatible output shape)
// ---------------------------------------------------------------------------

type Primitive = string | number | boolean | null | undefined;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Returns the set of keys present in `obj` that are NOT in `allowed`.
 * Used to enforce `.strict()` — unknown keys are rejected.
 */
function unknownKeys(obj: Record<string, unknown>, allowed: string[]): string[] {
  return Object.keys(obj).filter((k) => !allowed.includes(k));
}

// ---------------------------------------------------------------------------
// Inner validation functions
// ---------------------------------------------------------------------------

const LABEL_ALLOWED = ['id', 'name'];
const PR_ALLOWED = ['id', 'node_id', 'number', 'merged', 'labels'];
const REPO_ALLOWED = ['id', 'name', 'full_name'];
const PAYLOAD_ALLOWED = ['action', 'pull_request', 'repository'];

function validateLabel(label: unknown, path: string, errors: ValidationError[]): void {
  if (!isPlainObject(label)) {
    errors.push({ path, message: 'Each label must be an object' });
    return;
  }

  const extra = unknownKeys(label, LABEL_ALLOWED);
  for (const k of extra) {
    errors.push({ path: `${path}.${k}`, message: `Unrecognised property '${k}' — not allowed` });
  }

  if ('name' in label) {
    if (typeof label.name !== 'string' || label.name.trim() === '') {
      errors.push({ path: `${path}.name`, message: 'Label name must be a non-empty string' });
    }
  } else {
    errors.push({ path: `${path}.name`, message: 'name is required' });
  }

  if ('id' in label && label.id !== undefined) {
    if (typeof label.id !== 'string' && typeof label.id !== 'number') {
      errors.push({ path: `${path}.id`, message: 'id must be a string or number' });
    }
  }
}

function validatePullRequest(pr: unknown, path: string, errors: ValidationError[]): void {
  if (!isPlainObject(pr)) {
    errors.push({ path, message: 'pull_request must be an object' });
    return;
  }

  const extra = unknownKeys(pr, PR_ALLOWED);
  for (const k of extra) {
    errors.push({ path: `${path}.${k}`, message: `Unrecognised property '${k}' — not allowed` });
  }

  // number — required, integer, positive
  if (!('number' in pr) || pr.number === undefined || pr.number === null) {
    errors.push({ path: `${path}.number`, message: 'number is required' });
  } else if (typeof pr.number !== 'number' || !Number.isInteger(pr.number)) {
    errors.push({ path: `${path}.number`, message: 'PR number must be an integer' });
  } else if (pr.number <= 0) {
    errors.push({ path: `${path}.number`, message: 'PR number must be positive' });
  }

  // merged — required, boolean
  if (!('merged' in pr) || pr.merged === undefined || pr.merged === null) {
    errors.push({ path: `${path}.merged`, message: 'merged is required' });
  } else if (typeof pr.merged !== 'boolean') {
    errors.push({ path: `${path}.merged`, message: 'merged must be a boolean' });
  }

  // labels — optional array (defaults to [])
  if ('labels' in pr && pr.labels !== undefined) {
    if (!Array.isArray(pr.labels)) {
      errors.push({ path: `${path}.labels`, message: 'labels must be an array' });
    } else {
      pr.labels.forEach((label, i) => validateLabel(label, `${path}.labels.${i}`, errors));
    }
  }

  // optional string fields
  if ('node_id' in pr && pr.node_id !== undefined && typeof pr.node_id !== 'string') {
    errors.push({ path: `${path}.node_id`, message: 'node_id must be a string' });
  }
  if ('id' in pr && pr.id !== undefined && typeof pr.id !== 'string' && typeof pr.id !== 'number') {
    errors.push({ path: `${path}.id`, message: 'id must be a string or number' });
  }
}

function validateRepository(repo: unknown, path: string, errors: ValidationError[]): void {
  if (repo === null || repo === undefined) return; // nullable/optional — OK

  if (!isPlainObject(repo)) {
    errors.push({ path, message: 'repository must be an object or null' });
    return;
  }

  const extra = unknownKeys(repo, REPO_ALLOWED);
  for (const k of extra) {
    errors.push({ path: `${path}.${k}`, message: `Unrecognised property '${k}' — not allowed` });
  }

  for (const field of ['id', 'name', 'full_name'] as const) {
    if (field in repo && repo[field] !== undefined) {
      if (field === 'id') {
        if (typeof repo[field] !== 'string' && typeof repo[field] !== 'number') {
          errors.push({ path: `${path}.${field}`, message: 'id must be a string or number' });
        }
      } else if (typeof repo[field] !== 'string') {
        errors.push({ path: `${path}.${field}`, message: `${field} must be a string` });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate an incoming payload against the TaskPayload schema.
 * Call this before handing the payload to the ingest/queue layer.
 *
 * @param payload - Raw request body (unknown shape)
 * @returns ValidationResult – either parsed+coerced data or a structured error list
 */
export function validate(payload: unknown): ValidationResult {
  const errors: ValidationError[] = [];

  if (!isPlainObject(payload)) {
    return {
      success: false,
      errors: [{ path: '', message: 'Payload must be a plain object' }],
    };
  }

  // Strictly whitelist top-level keys
  const extra = unknownKeys(payload, PAYLOAD_ALLOWED);
  for (const k of extra) {
    errors.push({ path: k, message: `Unrecognised property '${k}' — not allowed` });
  }

  // action — required, non-empty string
  if (!('action' in payload) || payload.action === undefined || payload.action === null) {
    errors.push({ path: 'action', message: 'action is required' });
  } else if (typeof payload.action !== 'string' || payload.action.trim() === '') {
    errors.push({ path: 'action', message: 'action must be a non-empty string' });
  }

  // pull_request — required
  if (!('pull_request' in payload) || payload.pull_request === undefined || payload.pull_request === null) {
    errors.push({ path: 'pull_request', message: 'pull_request is required' });
  } else {
    validatePullRequest(payload.pull_request, 'pull_request', errors);
  }

  // repository — optional / nullable
  validateRepository(payload.repository, 'repository', errors);

  if (errors.length > 0) {
    return { success: false, errors };
  }

  // Build coerced, whitelisted payload
  const pr = payload.pull_request as Record<string, unknown>;
  const rawLabels = Array.isArray(pr.labels) ? pr.labels : [];

  const data: TaskPayload = {
    action: (payload.action as string).trim(),
    pull_request: {
      ...(pr.id !== undefined && { id: pr.id as number | string }),
      ...(pr.node_id !== undefined && { node_id: pr.node_id as string }),
      number: pr.number as number,
      merged: pr.merged as boolean,
      labels: rawLabels.map((l: any) => ({
        ...(l.id !== undefined && { id: l.id }),
        name: l.name,
      })),
    },
    ...(payload.repository !== undefined && {
      repository: payload.repository
        ? (() => {
            const r = payload.repository as Record<string, unknown>;
            return {
              ...(r.id !== undefined && { id: r.id as number | string }),
              ...(r.name !== undefined && { name: r.name as string }),
              ...(r.full_name !== undefined && { full_name: r.full_name as string }),
            };
          })()
        : null,
    }),
  };

  return { success: true, data };
}

// ---------------------------------------------------------------------------
// Express middleware
// ---------------------------------------------------------------------------

/**
 * Express middleware that validates req.body against the TaskPayload schema.
 * Responds 400 Bad Request with structured { error, details[] } on failure.
 * Attaches the validated, coerced payload back to req.body on success.
 */
export function validateTaskPayload(req: any, res: any, next: any): void {
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
