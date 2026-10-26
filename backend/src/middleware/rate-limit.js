/** Rate limiting for management and sensitive endpoints. */
import rateLimit from 'express-rate-limit';
import config from '../config.js';

function handler(_req, res) {
  res.status(429).json({
    error: { code: 'rate_limited', message: 'Too many requests. Please wait a moment and try again.' },
  });
}

export const generalLimiter = rateLimit({
  windowMs: config.security.rateLimitWindowSeconds * 1000,
  limit: config.security.rateLimitMaxRequests,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler,
  skip: () => config.isTest,
});

/** Stricter limit for endpoints that touch Telegram or encryption. */
export const sensitiveLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: config.security.connectRateLimitMaxRequests,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler,
  skip: () => config.isTest,
});
