// Small, dependency-free body validator. Each helper trims/strips control
// characters and enforces the length/range limit. Throws ValidationError
// which the route wraps into a 400 response.

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.status = 400;
  }
}

const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

function clean(s) {
  return String(s).replace(CONTROL_CHARS, '').trim();
}

export function str(value, { field, required = true, max = 1000, min = 0 } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new ValidationError(`${field} is required`);
    return '';
  }
  if (typeof value !== 'string') throw new ValidationError(`${field} must be a string`);
  const v = clean(value);
  if (v.length < min) throw new ValidationError(`${field} must be at least ${min} characters`);
  if (v.length > max) throw new ValidationError(`${field} must be at most ${max} characters`);
  return v;
}

export function int(value, { field, required = true, min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new ValidationError(`${field} is required`);
    return null;
  }
  const n = typeof value === 'number' ? value : parseInt(value, 10);
  if (!Number.isFinite(n)) throw new ValidationError(`${field} must be a number`);
  if (n < min || n > max) throw new ValidationError(`${field} must be between ${min} and ${max}`);
  return n;
}

export function bool(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value === 'true' || value === '1';
  return !!value;
}

export function oneOf(value, allowed, { field, required = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new ValidationError(`${field} is required`);
    return '';
  }
  const v = clean(value);
  if (!allowed.includes(v)) throw new ValidationError(`${field} must be one of: ${allowed.join(', ')}`);
  return v;
}

// Express wrapper: catches ValidationError thrown in a handler and returns 400 JSON.
export function handleValidation(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (err) {
      if (err instanceof ValidationError) {
        return res.status(400).json({ error: err.message });
      }
      throw err;
    }
  };
}
