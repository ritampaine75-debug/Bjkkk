import express from 'express';
import { authenticate } from '../middleware/authenticate.js';
import * as workflowService from '../services/workflow-service.js';
import { asyncHandler, badRequest } from '../utils/errors.js';
import { loadBot } from '../middleware/authorize.js';

const router = express.Router({ mergeParams: true });
router.use(authenticate);
// Owns the botId in the path: 404 for bots the user does not own.
router.use(loadBot({ allowRevoked: true }));

router.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({ workflows: await workflowService.listWorkflows(req.user.uid, req.params.botId) });
  }),
);

router.get('/catalog', (_req, res) => {
  res.json(workflowService.catalog());
});

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const workflow = await workflowService.createWorkflow(req.user.uid, req.params.botId, req.body || {});
    res.status(201).json({ workflow });
  }),
);

router.post(
  '/import',
  asyncHandler(async (req, res) => {
    if (req.body?.document === undefined) throw badRequest('A workflow document is required.');
    const result = await workflowService.importWorkflow(req.user.uid, req.params.botId, req.body.document);
    res.status(201).json(result);
  }),
);

router.get(
  '/:workflowId',
  asyncHandler(async (req, res) => {
    res.json({ workflow: await workflowService.getWorkflow(req.user.uid, req.params.botId, req.params.workflowId) });
  }),
);

router.put(
  '/:workflowId',
  asyncHandler(async (req, res) => {
    const result = await workflowService.saveWorkflow(
      req.user.uid,
      req.params.botId,
      req.params.workflowId,
      req.body?.workflow ?? req.body,
    );
    res.json(result);
  }),
);

router.post(
  '/:workflowId/validate',
  asyncHandler(async (req, res) => {
    const result = workflowService.validateWorkflowDocument(
      req.user.uid,
      req.params.botId,
      req.body?.workflow ?? req.body,
    );
    res.json(result);
  }),
);

router.post(
  '/:workflowId/publish',
  asyncHandler(async (req, res) => {
    const result = await workflowService.publishWorkflow(req.user.uid, req.params.botId, req.params.workflowId, {
      confirmProduction: req.body?.confirmProduction === true,
    });
    res.json(result);
  }),
);

router.post(
  '/:workflowId/pause',
  asyncHandler(async (req, res) => {
    res.json({ workflow: await workflowService.pauseWorkflow(req.user.uid, req.params.botId, req.params.workflowId) });
  }),
);

router.post(
  '/:workflowId/resume',
  asyncHandler(async (req, res) => {
    res.json({ workflow: await workflowService.resumeWorkflow(req.user.uid, req.params.botId, req.params.workflowId) });
  }),
);

router.post(
  '/:workflowId/duplicate',
  asyncHandler(async (req, res) => {
    res.status(201).json({ workflow: await workflowService.duplicateWorkflow(req.user.uid, req.params.botId, req.params.workflowId) });
  }),
);

router.delete(
  '/:workflowId',
  asyncHandler(async (req, res) => {
    await workflowService.deleteWorkflow(req.user.uid, req.params.botId, req.params.workflowId);
    res.status(204).end();
  }),
);

router.get(
  '/:workflowId/versions',
  asyncHandler(async (req, res) => {
    res.json({ versions: await workflowService.listVersions(req.user.uid, req.params.botId, req.params.workflowId) });
  }),
);

router.get(
  '/:workflowId/versions/:versionId',
  asyncHandler(async (req, res) => {
    res.json({ version: await workflowService.getVersion(req.user.uid, req.params.botId, req.params.workflowId, req.params.versionId) });
  }),
);

router.post(
  '/:workflowId/versions/:versionId/restore',
  asyncHandler(async (req, res) => {
    const workflow = await workflowService.restoreVersion(
      req.user.uid,
      req.params.botId,
      req.params.workflowId,
      req.params.versionId,
    );
    res.json({ workflow });
  }),
);

router.get(
  '/:workflowId/export',
  asyncHandler(async (req, res) => {
    const payload = await workflowService.exportWorkflow(req.user.uid, req.params.botId, req.params.workflowId);
    res.setHeader('Content-Disposition', `attachment; filename="${payload.workflow.name.replace(/[^A-Za-z0-9-_ ]/g, '') || 'workflow'}.json"`);
    res.json(payload);
  }),
);

export default router;
