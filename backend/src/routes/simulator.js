import express from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { loadBot } from '../middleware/authorize.js';
import { sensitiveLimiter } from '../middleware/rate-limit.js';
import * as simulation from '../services/simulation-service.js';
import { asyncHandler } from '../utils/errors.js';

const router = express.Router({ mergeParams: true });
router.use(authenticate);
router.use(loadBot({ allowRevoked: true }));

router.post(
  '/',
  sensitiveLimiter,
  asyncHandler(async (req, res) => {
    const result = await simulation.simulate(req.user.uid, req.params.botId, req.body || {});
    res.json(result);
  }),
);

router.get(
  '/scenarios',
  asyncHandler(async (req, res) => {
    res.json({ scenarios: await simulation.listScenarios(req.user.uid, req.params.botId) });
  }),
);

router.post(
  '/scenarios',
  asyncHandler(async (req, res) => {
    const scenario = await simulation.saveScenario(req.user.uid, req.params.botId, req.body || {});
    res.status(201).json({ scenario });
  }),
);

router.delete(
  '/scenarios/:scenarioId',
  asyncHandler(async (req, res) => {
    await simulation.deleteScenario(req.user.uid, req.params.botId, req.params.scenarioId);
    res.status(204).end();
  }),
);

export default router;
