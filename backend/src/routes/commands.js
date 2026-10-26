import express from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { sensitiveLimiter } from '../middleware/rate-limit.js';
import * as commandService from '../services/command-service.js';
import { asyncHandler } from '../utils/errors.js';
import { loadBot } from '../middleware/authorize.js';

const router = express.Router({ mergeParams: true });
router.use(authenticate);
router.use(loadBot({ allowRevoked: true }));

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const result = await commandService.listCommands(req.user.uid, req.params.botId);
    res.json(result);
  }),
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const command = await commandService.saveCommand(req.user.uid, req.params.botId, req.body || {});
    const { commands, sync } = await commandService.listCommands(req.user.uid, req.params.botId);
    res.status(201).json({ command, commands, sync });
  }),
);

router.put(
  '/',
  asyncHandler(async (req, res) => {
    const result = await commandService.replaceCommands(req.user.uid, req.params.botId, req.body?.commands);
    res.json(result);
  }),
);

router.post(
  '/sync',
  sensitiveLimiter,
  asyncHandler(async (req, res) => {
    const result = await commandService.syncCommands(req.user.uid, req.params.botId, {
      confirm: req.body?.confirm === true,
      scope: req.body?.scope || null,
    });
    res.json(result);
  }),
);

router.post(
  '/import',
  sensitiveLimiter,
  asyncHandler(async (req, res) => {
    const result = await commandService.importCommands(req.user.uid, req.params.botId);
    res.json(result);
  }),
);

router.delete(
  '/:commandId',
  asyncHandler(async (req, res) => {
    await commandService.deleteCommand(req.user.uid, req.params.botId, req.params.commandId);
    const { commands, sync } = await commandService.listCommands(req.user.uid, req.params.botId);
    res.json({ commands, sync });
  }),
);

export default router;
