import express from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { loadBot } from '../middleware/authorize.js';
import { executionRepo, auditRepo } from '../repositories/index.js';
import { summarizeExecution } from '../services/execution-summary.js';
import { asyncHandler, notFound, badRequest } from '../utils/errors.js';

const router = express.Router({ mergeParams: true });
router.use(authenticate);
router.use(loadBot({ allowRevoked: true }));

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const status = typeof req.query.status === 'string' && req.query.status ? req.query.status : null;
    const workflowId = typeof req.query.workflowId === 'string' && req.query.workflowId ? req.query.workflowId : null;
    const rows = await executionRepo.list(req.user.uid, req.params.botId, { limit: limit + 1, offset, status, workflowId });
    const hasMore = rows.length > limit;
    res.json({
      executions: rows.slice(0, limit).map((row) => summarizeExecution(row)),
      pagination: { limit, offset, hasMore, nextOffset: hasMore ? offset + limit : null },
    });
  }),
);

router.get(
  '/:executionId',
  asyncHandler(async (req, res) => {
    const execution = await executionRepo.get(req.user.uid, req.params.botId, req.params.executionId);
    if (!execution) throw notFound('Execution not found.');
    res.json({
      execution: {
        ...summarizeExecution(execution),
        steps: execution.steps || [],
        variables: execution.variables || {},
        transcript: execution.transcript || [],
        simulated: execution.simulated === true,
      },
    });
  }),
);

router.delete(
  '/:executionId',
  asyncHandler(async (req, res) => {
    if (req.body?.confirm !== true) throw badRequest('Deleting a log entry requires explicit confirmation.');
    const existing = await executionRepo.get(req.user.uid, req.params.botId, req.params.executionId);
    if (!existing) throw notFound('Execution not found.');
    const { getStore } = await import('../db/index.js');
    const store = await getStore();
    await store.doc.delete(`users/${req.user.uid}/bots/${req.params.botId}/executions/${req.params.executionId}`);
    await auditRepo.record(req.user.uid, { action: 'execution.deleted', botId: req.params.botId, executionId: req.params.executionId });
    res.status(204).end();
  }),
);

export default router;
