import express from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { loadBot } from '../middleware/authorize.js';
import { sensitiveLimiter } from '../middleware/rate-limit.js';
import { listSchedules, jobIdFor, runJob, schedulerState } from '../services/scheduler.js';
import { getAnalytics } from '../services/analytics.js';
import { jobRepo, workflowRepo } from '../repositories/index.js';
import { asyncHandler, notFound, badRequest } from '../utils/errors.js';

const router = express.Router({ mergeParams: true });
router.use(authenticate);
router.use(loadBot({ allowRevoked: true }));

router.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({ schedules: await listSchedules(req.user.uid, req.params.botId), scheduler: schedulerState() });
  }),
);

router.post(
  '/:workflowId/run',
  sensitiveLimiter,
  asyncHandler(async (req, res) => {
    const { uid } = req.user;
    const { botId, workflowId } = req.params;
    const workflow = await workflowRepo.get(uid, botId, workflowId);
    if (!workflow) throw notFound('Workflow not found.');
    if (!workflow.published) throw badRequest('Publish the workflow before running it on a schedule.');
    const jobId = jobIdFor(uid, botId, workflowId);
    let job = await jobRepo.get(jobId);
    if (!job) {
      job = await jobRepo.upsert({
        id: jobId,
        uid,
        botId,
        workflowId,
        workflowName: workflow.name,
        intervalMinutes: Number((workflow.published.triggers || []).find((t) => t.type === 'schedule')?.config?.intervalMinutes) || 60,
        enabled: true,
        nextRunAt: null,
        runs: 0,
      });
    }
    const result = await runJob(job);
    res.json({ result, schedules: await listSchedules(uid, botId) });
  }),
);

router.get(
  '/analytics',
  asyncHandler(async (req, res) => {
    res.json({ analytics: await getAnalytics(req.user.uid, req.params.botId, { days: req.query.days }) });
  }),
);

export default router;
