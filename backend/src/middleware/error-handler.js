import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { redact } from '../utils/redact.js';
import config from '../config.js';

export function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: 'not_found', message: `No route matches ${req.method} ${req.path}.` } });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  let status = 500;
  let code = 'internal_error';
  let message = 'Something went wrong. Please try again.';
  let details = null;

  if (err instanceof AppError) {
    status = err.status;
    code = err.code;
    message = err.expose ? err.message : 'Request failed.';
    details = err.details || null;
  } else if (err?.type === 'entity.too.large') {
    status = 413;
    code = 'payload_too_large';
    message = 'The request body is too large.';
  } else if (err?.type === 'entity.parse.failed') {
    status = 400;
    code = 'invalid_json';
    message = 'The request body is not valid JSON.';
  } else if (err?.code === 'CONFIG_INVALID') {
    status = 500;
    code = 'configuration_error';
    message = 'The server is not configured correctly.';
    details = err.details || null;
  }

  if (status >= 500) {
    logger.error('request failed', {
      method: req.method,
      path: req.path,
      uid: req.user?.uid,
      error: { name: err.name, message: err.message, code: err.code },
      stack: config.isProduction ? undefined : err.stack?.split('\n').slice(0, 6).join('\n'),
    });
  } else {
    logger.debug('request rejected', { method: req.method, path: req.path, code, status });
  }

  const body = { error: { code, message } };
  if (details) body.error.details = redact(details);
  if (!config.isProduction && status >= 500 && err.code !== 'CONFIG_INVALID') {
    body.error.debug = redact({ name: err.name, code: err.code });
  }
  res.status(status).json(body);
}
