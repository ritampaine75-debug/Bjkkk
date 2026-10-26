import crypto from 'node:crypto';

/** URL-safe random id used for documents and execution ids. */
export function newId(prefix = '') {
  const id = crypto.randomBytes(12).toString('base64url');
  return prefix ? `${prefix}_${id}` : id;
}

export function newIdempotencyKey(...parts) {
  return crypto.createHash('sha256').update(parts.map(String).join('|')).digest('hex');
}

export function nowIso() {
  return new Date().toISOString();
}

/** Add milliseconds to an ISO timestamp. */
export function addMs(iso, ms) {
  return new Date(new Date(iso).getTime() + ms).toISOString();
}
