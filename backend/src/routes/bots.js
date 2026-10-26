import express from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { sensitiveLimiter } from '../middleware/rate-limit.js';
import * as botConnection from '../services/bot-connection.js';
import * as webhookService from '../services/webhook-service.js';
import { runtimeStatus, processUpdate, runtimeQueue } from '../services/live-runtime.js';
import { getBotTelegramClient } from '../services/bot-client.js';
import { createTelegramTransport } from '../services/transports/mock-transport.js';
import { summarizeText } from '../utils/redact.js';
import { botRepo, workflowRepo, executionRepo } from '../repositories/index.js';
import { asyncHandler, badRequest, notFound } from '../utils/errors.js';
import { publicBot } from '../services/bot-connection.js';
import { BOT_ENVIRONMENT } from '../../../shared/constants.js';

const router = express.Router();
router.use(authenticate);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const bots = await botRepo.list(req.user.uid);
    res.json({ bots: bots.map((bot) => publicBot(bot)) });
  }),
);

router.post(
  '/connect',
  sensitiveLimiter,
  asyncHandler(async (req, res) => {
    const bot = await botConnection.connectBot(req.user.uid, req.body || {});
    res.status(201).json({ bot });
  }),
);

router.get(
  '/:botId',
  asyncHandler(async (req, res) => {
    const bot = await botRepo.get(req.user.uid, req.params.botId);
    if (!bot) throw notFound('Bot not found.');
    const workflows = await workflowRepo.list(req.user.uid, bot.id);
    const stats = await executionRepo.stats(req.user.uid, bot.id);
    res.json({
      bot: publicBot(bot),
      counts: {
        workflows: workflows.length,
        publishedWorkflows: workflows.filter((wf) => wf.status === 'published').length,
        executions: stats.total,
        failedExecutions: stats.failed,
      },
    });
  }),
);

router.patch(
  '/:botId',
  asyncHandler(async (req, res) => {
    const bot = await botConnection.updateBot(req.user.uid, req.params.botId, req.body || {});
    res.json({ bot });
  }),
);

router.post(
  '/:botId/validate',
  sensitiveLimiter,
  asyncHandler(async (req, res) => {
    const result = await botConnection.revalidateBot(req.user.uid, req.params.botId);
    res.json(result);
  }),
);

router.post(
  '/:botId/token',
  sensitiveLimiter,
  asyncHandler(async (req, res) => {
    const bot = await botConnection.replaceToken(req.user.uid, req.params.botId, req.body || {});
    res.json({ bot });
  }),
);

router.get(
  '/:botId/diagnostics',
  asyncHandler(async (req, res) => {
    const diagnostics = await botConnection.getDiagnostics(req.user.uid, req.params.botId);
    res.json({ diagnostics });
  }),
);

router.post(
  '/:botId/revoke',
  sensitiveLimiter,
  asyncHandler(async (req, res) => {
    if (req.body?.confirm !== true) {
      throw badRequest('Revoking a connection requires explicit confirmation.');
    }
    const bot = await botConnection.revokeBot(req.user.uid, req.params.botId);
    res.json({ bot });
  }),
);

router.delete(
  '/:botId',
  asyncHandler(async (req, res) => {
    if (req.body?.confirm !== true) {
      throw badRequest('Deleting a bot workspace requires explicit confirmation.');
    }
    await botConnection.deleteBot(req.user.uid, req.params.botId);
    res.status(204).end();
  }),
);

/* --------------------------------------------------------------------------
 * Live runtime: webhook lifecycle, health and a guarded live-test lab
 * ------------------------------------------------------------------------ */

router.patch(
  '/:botId/restrictions',
  asyncHandler(async (req, res) => {
    const bot = await botConnection.updateRestrictions(req.user.uid, req.params.botId, req.body || {});
    res.json({ bot });
  }),
);

router.get(
  '/:botId/webhook',
  asyncHandler(async (req, res) => {
    res.json(await webhookService.getWebhookStatus(req.user.uid, req.params.botId));
  }),
);

router.post(
  '/:botId/webhook',
  sensitiveLimiter,
  asyncHandler(async (req, res) => {
    const result = await webhookService.registerWebhook(req.user.uid, req.params.botId, {
      dropPendingUpdates: req.body?.dropPendingUpdates === true,
    });
    res.status(201).json(result);
  }),
);

router.delete(
  '/:botId/webhook',
  asyncHandler(async (req, res) => {
    res.json(await webhookService.removeWebhook(req.user.uid, req.params.botId));
  }),
);

router.get(
  '/:botId/runtime',
  asyncHandler(async (req, res) => {
    const bot = await botRepo.get(req.user.uid, req.params.botId);
    if (!bot) throw notFound('Bot not found.');
    res.json({
      runtime: runtimeStatus(),
      bot: { id: bot.id, webhook: { state: bot.webhook?.state || 'not_configured', registeredAt: bot.webhook?.registeredAt || null } },
    });
  }),
);

/**
 * Delivers one synthetic update through the real runtime path (no Telegram
 * call is made when `dryRun` is true) so owners can prove routing works.
 */
router.post(
  '/:botId/runtime/simulate-update',
  sensitiveLimiter,
  asyncHandler(async (req, res) => {
    const updateId = Number(req.body?.updateId) || Math.floor(Math.random() * 2_000_000_000);
    const text = typeof req.body?.text === 'string' ? req.body.text.slice(0, 4096) : '/start';
    const dryRun = req.body?.dryRun !== false;
    const bot = await botRepo.get(req.user.uid, req.params.botId);
    if (!bot) throw notFound('Bot not found.');

    const update = {
      update_id: updateId,
      message: {
        message_id: updateId,
        date: Math.floor(Date.now() / 1000),
        chat: { id: req.body?.chatId ? Number(req.body.chatId) : 424242, type: 'private' },
        from: { id: 424242, is_bot: false, first_name: 'Runtime', username: 'runtime_tester' },
        text,
      },
    };

    let client = null;
    if (dryRun) {
      const recorder = await createDryRunClient();
      client = recorder;
    }
    const summary = await processUpdate({ uid: req.user.uid, botId: req.params.botId, update, client });
    res.json({ ...summary, dryRun, input: summarizeText(text, 160) });
  }),
);

/** A Telegram-shaped client that records calls instead of sending them. */
async function createDryRunClient() {
  const calls = [];
  const ok = (result) => {
    calls.push(result.method);
    return Promise.resolve({ result: { ...result.value, dryRun: true }, latencyMs: 0 });
  };
  const client = {
    calls,
    call: (method, payload) => ok({ method, value: { message_id: 1, payload } }),
    getMe: () => ok({ method: 'getMe', value: { is_bot: true, id: 1 } }),
    sendMessage: (payload) => ok({ method: 'sendMessage', value: { message_id: 1, text: payload.text } }),
    sendPhoto: (payload) => ok({ method: 'sendPhoto', value: { message_id: 1, photo: payload.photo } }),
    sendDocument: (payload) => ok({ method: 'sendDocument', value: { message_id: 1, document: payload.document } }),
    editMessageText: (payload) => ok({ method: 'editMessageText', value: { message_id: payload.message_id } }),
    answerCallbackQuery: () => ok({ method: 'answerCallbackQuery', value: {} }),
  };
  return client;
}

/**
 * Live test lab: send one real message to a chat. Requires explicit
 * confirmation because it messages a real Telegram user.
 */
router.post(
  '/:botId/live-test',
  sensitiveLimiter,
  asyncHandler(async (req, res) => {
    if (req.body?.confirm !== true) {
      throw badRequest('Sending a real Telegram message requires confirm: true.');
    }
    const chatId = String(req.body?.chatId || '').trim();
    if (!/^-?\d{1,20}$/.test(chatId)) throw badRequest('A numeric Telegram chat id is required.');
    const text = String(req.body?.text || '').trim();
    if (!text) throw badRequest('Message text is required.');
    if (text.length > 4096) throw badRequest('Telegram limits messages to 4096 characters.');

    const { client } = await getBotTelegramClient(req.user.uid, req.params.botId);
    const transport = createTelegramTransport(client);
    try {
      const message = await transport.sendMessage({ chat_id: chatId, text });
      res.json({
        delivered: true,
        messageId: message.messageId,
        chatId,
        preview: summarizeText(text, 120),
      });
    } catch (err) {
      const mapped = err.name === 'TelegramError' ? err : err;
      res.status(mapped.code === 'rate_limited' ? 429 : 502).json({
        error: { code: mapped.code || 'delivery_failed', message: mapped.message, retryAfter: mapped.retryAfter || null },
      });
    }
  }),
);

router.get('/meta/environments', (_req, res) => {
  res.json({ environments: Object.values(BOT_ENVIRONMENT) });
});

export default router;
