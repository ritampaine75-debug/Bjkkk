/** Safe, structured application errors. Never carry secrets in messages. */
export class AppError extends Error {
  constructor(message, { status = 400, code = 'bad_request', details = null, expose = true } = {}) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.expose = expose;
  }

  toJSON() {
    const body = { error: { code: this.code, message: this.message } };
    if (this.details) body.error.details = this.details;
    return body;
  }
}

export const badRequest = (message, details) =>
  new AppError(message, { status: 400, code: 'bad_request', details });
export const unauthorized = (message = 'Authentication required.') =>
  new AppError(message, { status: 401, code: 'unauthorized' });
export const forbidden = (message = 'You do not have access to this resource.') =>
  new AppError(message, { status: 403, code: 'forbidden' });
export const notFound = (message = 'Resource not found.') =>
  new AppError(message, { status: 404, code: 'not_found' });
export const conflict = (message, details) =>
  new AppError(message, { status: 409, code: 'conflict', details });
export const tooManyRequests = (message = 'Too many requests. Try again shortly.') =>
  new AppError(message, { status: 429, code: 'rate_limited' });
export const payloadTooLarge = (message = 'Request body is too large.') =>
  new AppError(message, { status: 413, code: 'payload_too_large' });
export const unprocessable = (message, details) =>
  new AppError(message, { status: 422, code: 'validation_failed', details });
export const upstreamError = (message = 'Upstream service error.') =>
  new AppError(message, { status: 502, code: 'upstream_error' });

export function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
