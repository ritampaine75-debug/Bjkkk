/**
 * Minimal structured logger with secret redaction. Intentionally dependency
 * free so it can be reused inside worker scripts.
 */
import { redact, redactString } from './redact.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

function enabled(level) {
  const configured = (process.env.LOG_LEVEL || 'info').toLowerCase();
  return (LEVELS[level] ?? 20) >= (LEVELS[configured] ?? 20);
}

function emit(level, message, meta) {
  if (!enabled(level)) return;
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg: redactString(String(message)),
  };
  if (meta && Object.keys(meta).length > 0) entry.meta = redact(meta);
  const line = JSON.stringify(entry);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (message, meta) => emit('debug', message, meta),
  info: (message, meta) => emit('info', message, meta),
  warn: (message, meta) => emit('warn', message, meta),
  error: (message, meta) => emit('error', message, meta),
  child(bindings) {
    return {
      debug: (m, meta) => emit('debug', m, { ...bindings, ...meta }),
      info: (m, meta) => emit('info', m, { ...bindings, ...meta }),
      warn: (m, meta) => emit('warn', m, { ...bindings, ...meta }),
      error: (m, meta) => emit('error', m, { ...bindings, ...meta }),
      child: (more) => logger.child({ ...bindings, ...more }),
    };
  },
};

export default logger;
