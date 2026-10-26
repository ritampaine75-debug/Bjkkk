import http from 'node:http';
import config, { assertValidConfig } from './config.js';
import { createApp } from './app.js';
import { getStore } from './db/index.js';
import { logger } from './utils/logger.js';
import { startScheduler, stopScheduler } from './services/scheduler.js';

async function main() {
  assertValidConfig();
  for (const warning of config.warnings) logger.warn(warning);

  await getStore();
  const app = await createApp();
  const server = http.createServer(app);

  server.listen(config.port, '0.0.0.0', () => {
    logger.info('botforge studio listening', {
      url: `http://localhost:${config.port}`,
      env: config.env,
      storage: config.db.mode,
      auth: config.auth.mode,
    });
  });

  if (config.runtime.schedulerEnabled) {
    startScheduler();
  } else {
    logger.info('scheduler disabled (SCHEDULER_ENABLED=false)');
  }

  const shutdown = (signal) => {
    logger.info('shutting down', { signal });
    stopScheduler();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error('server failed to start', { message: err.message, details: err.details });
  process.exit(1);
});
