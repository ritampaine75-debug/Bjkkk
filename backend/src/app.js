/**
 * Express application factory. Kept separate from server.js so tests can mount
 * the app without binding a port.
 */
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import config, { REPO_ROOT, assertValidConfig } from './config.js';
import { logger } from './utils/logger.js';
import { generalLimiter } from './middleware/rate-limit.js';
import { notFoundHandler, errorHandler } from './middleware/error-handler.js';
import authRoutes from './routes/auth.js';
import dashboardRoutes from './routes/dashboard.js';
import botRoutes from './routes/bots.js';
import commandRoutes from './routes/commands.js';
import workflowRoutes from './routes/workflows.js';
import simulatorRoutes from './routes/simulator.js';
import executionRoutes from './routes/executions.js';
import webhookRoutes from './routes/webhook.js';
import scheduleRoutes from './routes/schedules.js';
import analyticsRoutes from './routes/analytics.js';

export async function createApp({ frontendDir = path.join(REPO_ROOT, 'frontend') } = {}) {
  assertValidConfig();

  const app = express();
  app.disable('x-powered-by');
  if (config.security.trustProxy > 0) app.set('trust proxy', config.security.trustProxy);

  // -- Security headers ----------------------------------------------------
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'", 'https://www.gstatic.com'],
          'style-src': ["'self'", "'unsafe-inline'"],
          'img-src': ["'self'", 'data:', 'blob:', 'https://t.me', 'https://api.telegram.org'],
          'connect-src': [
            "'self'",
            'https://identitytoolkit.googleapis.com',
            'https://securetoken.googleapis.com',
            'https://www.googleapis.com',
          ],
          'font-src': ["'self'", 'data:'],
          'object-src': ["'none'"],
          'base-uri': ["'self'"],
          'form-action': ["'self'"],
          'frame-ancestors': ["'self'"],
          ...(config.isProduction ? { 'upgrade-insecure-requests': [] } : {}),
        },
      },
      crossOriginEmbedderPolicy: false,
      referrerPolicy: { policy: 'no-referrer' },
      hsts: config.isProduction ? { maxAge: 15552000, includeSubDomains: true } : false,
    }),
  );
  // -- CORS ---------------------------------------------------------------
  const allowed = config.security.allowedOrigins;
  app.use(
    cors({
      origin(origin, callback) {
        // Same-origin and non-browser clients send no Origin header.
        if (!origin) return callback(null, true);
        if (allowed.includes(origin)) return callback(null, true);
        if (allowed.length === 0 && !config.isProduction && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
          return callback(null, true);
        }
        logger.warn('blocked cross-origin request', { origin });
        return callback(null, false);
      },
      credentials: false,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
      maxAge: 600,
    }),
  );

  // -- Body parsing -------------------------------------------------------
  app.use(
    express.json({
      limit: config.security.maxJsonBodyBytes,
      strict: true,
      type: ['application/json', 'application/*+json'],
    }),
  );
  app.use(express.urlencoded({ extended: false, limit: '32kb' }));

  // -- Health (unauthenticated, no sensitive data) ------------------------
  app.get('/api/health', (_req, res) => {
    res.json({
      status: config.errors.length === 0 ? 'ok' : 'degraded',
      app: 'botforge-studio',
      env: config.env,
      time: new Date().toISOString(),
      storage: config.db.mode,
      auth: config.auth.mode,
    });
  });

  // -- Public Telegram webhook -------------------------------------------
  // Mounted before the general rate limiter: Telegram delivers bursts from a
  // small set of IPs and authenticity is enforced by the capability key.
  app.use('/api/v1/telegram', webhookRoutes);

  // -- API routes ---------------------------------------------------------
  app.use('/api/v1', generalLimiter);
  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/dashboard', dashboardRoutes);
  app.use('/api/v1/bots/:botId/commands', commandRoutes);
  app.use('/api/v1/bots/:botId/workflows', workflowRoutes);
  app.use('/api/v1/bots/:botId/simulate', simulatorRoutes);
  app.use('/api/v1/bots/:botId/executions', executionRoutes);
  app.use('/api/v1/bots/:botId/schedules', scheduleRoutes);
  app.use('/api/v1/bots/:botId/analytics', analyticsRoutes);
  app.use('/api/v1/bots', botRoutes);

  // -- Static frontend ----------------------------------------------------
  const hasFrontend = fs.existsSync(path.join(frontendDir, 'index.html'));
  if (hasFrontend) {
    app.use(
      express.static(frontendDir, {
        index: false,
        maxAge: config.isProduction ? '1h' : 0,
        setHeaders(res, filePath) {
          if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
        },
      }),
    );
    // SPA fallback: never shadow /api routes.
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.sendFile(path.join(frontendDir, 'index.html'));
    });
  } else {
    app.get('/', (_req, res) => {
      res.status(503).json({ error: { code: 'frontend_missing', message: 'Frontend assets were not built.' } });
    });
  }

  app.use('/api', notFoundHandler);
  app.use(errorHandler);

  return app;
}

export default createApp;
