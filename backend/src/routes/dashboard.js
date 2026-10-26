import express from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { botRepo, workflowRepo, executionRepo } from '../repositories/index.js';
import { asyncHandler } from '../utils/errors.js';
import { summarizeExecution } from '../services/execution-summary.js';
import { WORKFLOW_STATUS } from '../../../shared/constants.js';

const router = express.Router();
router.use(authenticate);

/**
 * Aggregated dashboard payload. Everything is derived from stored data - no
 * invented numbers. Empty accounts receive honest zero counts.
 */
router.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const uid = req.user.uid;
    const bots = await botRepo.list(uid);

    let activeWorkflows = 0;
    let draftWorkflows = 0;
    let pausedWorkflows = 0;
    let totalCommands = 0;
    const recentExecutions = [];
    let totalExecutions = 0;
    let failedExecutions = 0;
    const recentFailures = [];

    for (const bot of bots) {
      const workflows = await workflowRepo.list(uid, bot.id);
      for (const wf of workflows) {
        if (wf.status === WORKFLOW_STATUS.PUBLISHED) activeWorkflows += 1;
        else if (wf.status === WORKFLOW_STATUS.PAUSED) pausedWorkflows += 1;
        else draftWorkflows += 1;
      }
      const stats = await executionRepo.stats(uid, bot.id);
      totalExecutions += stats.total;
      failedExecutions += stats.failed;
      if (stats.total > 0) {
        const recent = await executionRepo.recent(uid, bot.id, 5);
        for (const exec of recent) {
          recentExecutions.push({ ...summarizeExecution(exec), botName: bot.displayName });
          if (['failed', 'timeout'].includes(exec.status)) recentFailures.push(summarizeExecution(exec));
        }
      }
      const { getStore } = await import('../db/index.js');
      const store = await getStore();
      totalCommands += await store.count(`users/${uid}/bots/${bot.id}/commands`);
    }

    recentExecutions.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));

    res.json({
      bots: bots.map((bot) => ({
        id: bot.id,
        displayName: bot.displayName,
        environment: bot.environment,
        username: bot.telegram?.username || null,
        connectionState: bot.connection?.state || 'unknown',
        status: bot.status,
        lastCheckedAt: bot.connection?.lastCheckedAt || null,
      })),
      totals: {
        bots: bots.length,
        activeWorkflows,
        draftWorkflows,
        pausedWorkflows,
        totalWorkflows: activeWorkflows + draftWorkflows + pausedWorkflows,
        commands: totalCommands,
        executions: totalExecutions,
        failedExecutions,
      },
      gettingStarted: buildChecklist({ bots, activeWorkflows, totalExecutions }),
      recentExecutions: recentExecutions.slice(0, 5),
      recentFailures: recentFailures.slice(0, 3),
    });
  }),
);

function buildChecklist({ bots, activeWorkflows, totalExecutions }) {
  const hasBot = bots.length > 0;
  const hasValidatedBot = bots.some((bot) => bot.connection?.state === 'connected');
  return [
    { id: 'connect-bot', label: 'Connect your first Telegram bot', done: hasBot, hint: 'Add a BotFather token to unlock bot workspaces.' },
    { id: 'validate-bot', label: 'Validate the bot connection', done: hasValidatedBot, hint: 'Run a token validation from the bot settings page.' },
    { id: 'create-workflow', label: 'Create a workflow', done: activeWorkflows > 0, hint: 'Start with a /start reply using the form editor.' },
    { id: 'publish-workflow', label: 'Publish and activate an automation', done: activeWorkflows > 0, hint: 'Published workflows handle live updates.' },
    { id: 'run-test', label: 'Run a simulated conversation', done: totalExecutions > 0, hint: 'Open the simulator to test before going live.' },
  ];
}

export default router;
