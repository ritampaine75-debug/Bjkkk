/**
 * Public Telegram webhook endpoint.
 *
 * No session is required: authenticity comes from the per-bot capability key
 * in the URL plus Telegram's `X-Telegram-Bot-Api-Secret-Token` header. The
 * route always answers fast and does the work in the background queue.
 */
import express from 'express';
import { resolveWebhookRoute, __safeEqual } from '../services/webhook-service.js';
import { enqueueUpdate, runtimeStatus } from '../services/live-runtime.js';
import { asyncHandler } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

router.get('/health', (_req, res) => {
  const status = runtimeStatus();
  res.json({ ok: true, queue: { pending: status.queue.pending, active: status.queue.active, idle: status.queue.idle } });
});

router.post(
  '/webhook/:botId/:key',
  asyncHandler(async (req, res) => {
    const route = await resolveWebhookRoute(req.params.botId, req.params.key);
    if (!route) {
      logger.warn('webhook rejected', { botId: req.params.botId, reason: 'invalid_capability_key' });
      res.status(401).json({ error: { code: 'invalid_webhook_key', message: 'Unknown webhook endpoint.' } });
      return;
    }
    const headerSecret = req.get('x-telegram-bot-api-secret-token');
    if (headerSecret && !__safeEqual(headerSecret, req.params.key)) {
      logger.warn('webhook rejected', { botId: req.params.botId, reason: 'secret_token_mismatch' });
      res.status(401).json({ error: { code: 'invalid_webhook_secret', message: 'Unknown webhook endpoint.' } });
      return;
    }

    const update = req.body;
    if (!update || typeof update !== 'object' || Array.isArray(update)) {
      res.status(400).json({ error: { code: 'invalid_update', message: 'Expected a Telegram update object.' } });
      return;
    }

    // Acknowledge immediately: Telegram retries anything slower than ~60s and
    // retries are handled by our own queue instead.
    res.status(200).json({ ok: true });

    try {
      enqueueUpdate({ uid: route.uid, botId: route.botId, update });
    } catch (err) {
      logger.warn('webhook enqueue failed', { botId: route.botId, code: err.code || err.message });
    }
  }),
);

export default router;
