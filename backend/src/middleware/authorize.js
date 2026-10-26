/**
 * Ownership enforcement. Any bot addressed by the API must belong to the
 * authenticated application user; there is no way to address another user's
 * bot because bot ids are always resolved inside `users/{uid}/bots`.
 */
import { botRepo } from '../repositories/index.js';
import { notFound, forbidden } from '../utils/errors.js';

export function loadBot({ param = 'botId', allowRevoked = true } = {}) {
  return async function botLoader(req, _res, next) {
    try {
      const botId = req.params[param];
      if (!botId || !/^[A-Za-z0-9_-]{3,64}$/.test(botId)) {
        throw notFound('Bot not found.');
      }
      const bot = await botRepo.get(req.user.uid, botId);
      if (!bot) throw notFound('Bot not found.');
      if (!allowRevoked && bot.connection?.state === 'revoked') {
        throw forbidden('This bot connection has been revoked. Reconnect the bot to continue.');
      }
      req.bot = bot;
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Load a workflow scoped to the authenticated user's bot. */
export function loadWorkflow({ param = 'workflowId' } = {}) {
  return async function workflowLoader(req, _res, next) {
    try {
      const workflowId = req.params[param];
      if (!workflowId) throw notFound('Workflow not found.');
      const { workflowRepo } = await import('../repositories/index.js');
      const workflow = await workflowRepo.get(req.user.uid, req.bot.id, workflowId);
      if (!workflow) throw notFound('Workflow not found.');
      req.workflow = workflow;
      next();
    } catch (err) {
      next(err);
    }
  };
}
