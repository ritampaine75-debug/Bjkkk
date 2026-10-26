/**
 * Lightweight request validation helpers. Every route declares the shape it
 * accepts; unexpected or oversized input is rejected with a safe 422.
 */
import { unprocessable, badRequest } from '../utils/errors.js';

export function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function requireObject(value, label = 'body') {
  if (!isPlainObject(value)) throw badRequest(`Expected ${label} to be a JSON object.`);
  return value;
}

export class Validator {
  constructor(value, label = 'body') {
    this.value = requireObject(value, label);
    this.label = label;
    this.errors = [];
  }

  string(key, { required = false, min = 0, max = 10000, pattern = null, trim = true, field = key } = {}) {
    const raw = this.value[key];
    if (raw === undefined || raw === null || raw === '') {
      if (required) this.errors.push({ field, message: `${field} is required.` });
      return this;
    }
    if (typeof raw !== 'string') {
      this.errors.push({ field, message: `${field} must be a string.` });
      return this;
    }
    const val = trim ? raw.trim() : raw;
    if (val.length < min) this.errors.push({ field, message: `${field} must be at least ${min} characters.` });
    if (val.length > max) this.errors.push({ field, message: `${field} must be at most ${max} characters.` });
    if (pattern && !pattern.test(val)) this.errors.push({ field, message: `${field} has an invalid format.` });
    return this;
  }

  boolean(key, { required = false, field = key } = {}) {
    const raw = this.value[key];
    if (raw === undefined || raw === null) {
      if (required) this.errors.push({ field, message: `${field} is required.` });
      return this;
    }
    if (typeof raw !== 'boolean') this.errors.push({ field, message: `${field} must be true or false.` });
    return this;
  }

  enum(key, allowed, { required = false, field = key } = {}) {
    const raw = this.value[key];
    if (raw === undefined || raw === null || raw === '') {
      if (required) this.errors.push({ field, message: `${field} is required.` });
      return this;
    }
    if (!allowed.includes(raw)) {
      this.errors.push({ field, message: `${field} must be one of: ${allowed.join(', ')}.` });
    }
    return this;
  }

  integer(key, { required = false, min = -Infinity, max = Infinity, field = key } = {}) {
    const raw = this.value[key];
    if (raw === undefined || raw === null || raw === '') {
      if (required) this.errors.push({ field, message: `${field} is required.` });
      return this;
    }
    if (!Number.isInteger(raw)) this.errors.push({ field, message: `${field} must be an integer.` });
    else if (raw < min || raw > max) this.errors.push({ field, message: `${field} must be between ${min} and ${max}.` });
    return this;
  }

  /** Reject unknown keys so typos cannot silently do nothing. */
  only(allowed) {
    for (const key of Object.keys(this.value)) {
      if (!allowed.includes(key)) this.errors.push({ field: key, message: `${key} is not a recognised field.` });
    }
    return this;
  }

  check() {
    if (this.errors.length > 0) throw unprocessable('The request contains invalid fields.', this.errors);
    return this.value;
  }
}

export function validateBody(schemaFn) {
  return (req, _res, next) => {
    try {
      const result = schemaFn(req.body ?? {});
      if (result !== undefined) req.validated = result;
      next();
    } catch (err) {
      next(err);
    }
  };
}
