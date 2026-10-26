/**
 * Secret redaction helpers. Used by the logger, error handler, audit trail and
 * execution logs so token material never reaches logs or API responses.
 */

const SENSITIVE_KEY_PATTERN =
  /(pass(word)?|secret|token|api[-_]?key|authorization|private[-_]?key|cookie|credential|session)/i;

/** Telegram bot tokens look like `<digits>:<35 url-safe chars>`. */
const BOT_TOKEN_PATTERN = /\b\d{6,12}:[A-Za-z0-9_-]{30,}\b/g;

export function maskToken(token) {
  if (typeof token !== 'string' || token.length === 0) return '';
  if (token.length <= 8) return '********';
  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}

export function redactString(value, { keepLength = false } = {}) {
  if (typeof value !== 'string') return value;
  const replaced = value.replace(BOT_TOKEN_PATTERN, (m) => maskToken(m));
  if (keepLength || replaced.length <= 2000) return replaced;
  return `${replaced.slice(0, 2000)}... [truncated]`;
}

/**
 * Deep-clone a value with sensitive keys masked and embedded bot tokens
 * stripped. Handles circular structures defensively.
 */
export function redact(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value !== 'object') return value;
  if (seen.has(value)) return '[circular]';
  seen.add(value);

  if (Array.isArray(value)) return value.map((item) => redact(item, seen));
  if (value instanceof Error) {
    return { name: value.name, message: redactString(value.message), code: value.code };
  }

  const out = {};
  for (const [key, val] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key) && typeof val !== 'object') {
      out[key] = typeof val === 'string' && val.length > 0 ? '[redacted]' : val;
    } else if (SENSITIVE_KEY_PATTERN.test(key) && val && typeof val === 'object') {
      out[key] = '[redacted]';
    } else {
      out[key] = redact(val, seen);
    }
  }
  return out;
}

/** Safely truncate free-form user text for log summaries. */
export function summarizeText(text, max = 160) {
  if (typeof text !== 'string') return '';
  const singleLine = text.replace(/\s+/g, ' ').trim();
  return singleLine.length > max ? `${singleLine.slice(0, max)}...` : singleLine;
}
