import express from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { loadBot } from '../middleware/authorize.js';
import { getAnalytics } from '../services/analytics.js';
import { asyncHandler } from '../utils/errors.js';

const router = express.Router({ mergeParams: true });
router.use(authenticate);
router.use(loadBot({ allowRevoked: true }));

router.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({ analytics: await getAnalytics(req.user.uid, req.params.botId, { days: req.query.days }) });
  }),
);

export default router;
