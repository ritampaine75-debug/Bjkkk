/**
 * Workflow persistence, validation, draft/published versioning and import/export.
 * The stored document is always produced by the shared schema validator.
 */
import { workflowRepo, botRepo, auditRepo } from '../repositories/index.js';
import {
  validateWorkflow,
  createEmptyWorkflow,
  createWelcomeTemplate,
  summarizeWorkflow,
  workflowFingerprint,
  TRIGGER_TYPE_LIST,
  NODE_TYPE_LIST,
  NODE_DEFINITIONS,
  TRIGGER_DEFINITIONS,
} from '../../../shared/workflow-schema.js';
import { WORKFLOW_STATUS, WORKFLOW_LIMITS } from '../../../shared/constants.js';
import { AppError, badRequest, notFound, conflict } from '../utils/errors.js';
import { nowIso } from '../utils/ids.js';
import config from '../config.js';
import { logger } from '../utils/logger.js';

const ALLOWED_EXTERNAL_HOSTS = (process.env.HTTP_ACTION_ALLOWED_HOSTS || '')
  .split(',')
  .map((host) => host.trim())
  .filter(Boolean);
const ALLOW_HTTP_ACTIONS = process.env.ALLOW_HTTP_ACTIONS === 'true' || ALLOWED_EXTERNAL_HOSTS.length > 0;

export function workflowOptions() {
  return { allowHttp: ALLOW_HTTP_ACTIONS, allowedHosts: ALLOWED_EXTERNAL_HOSTS };
}

export function publicWorkflow(doc, { includeGraph = false } = {}) {
  if (!doc) return null;
  const base = {
    id: doc.id,
    name: doc.name,
    description: doc.description || '',
    status: doc.status,
    schemaVersion: doc.schemaVersion || 1,
    version: doc.version || 0,
    publishedVersion: doc.publishedVersion ?? null,
    publishedAt: doc.publishedAt || null,
    lastRunAt: doc.lastRunAt || null,
    runCount: doc.runCount || 0,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    summary: doc.summary || summarizeWorkflow(doc),
    hasDraftChanges: Boolean(doc.publishedVersion) && workflowFingerprint(doc.draft || doc) !== (doc.publishedFingerprint || null),
  };
  if (includeGraph) {
    const graph = doc.draft || doc;
    base.triggers = graph.triggers || [];
    base.nodes = graph.nodes || [];
    base.edges = graph.edges || [];
    base.variables = graph.variables || {};
    base.settings = graph.settings || { cooldownSeconds: 0, allowConcurrentRuns: false };
    base.draft = doc.draft || null;
    base.published = doc.published || null;
  }
  return base;
}

export function catalog() {
  return {
    triggers: TRIGGER_TYPE_LIST.map((type) => ({
      type,
      label: TRIGGER_DEFINITIONS[type].label,
      description: TRIGGER_DEFINITIONS[type].description,
    })),
    nodes: NODE_TYPE_LIST.map((type) => ({
      type,
      label: NODE_DEFINITIONS[type].label,
      kind: NODE_DEFINITIONS[type].kind,
      outputs: NODE_DEFINITIONS[type].outputs,
    })),
    limits: WORKFLOW_LIMITS,
    httpActionsEnabled: ALLOW_HTTP_ACTIONS,
    httpAllowedHosts: ALLOWED_EXTERNAL_HOSTS,
  };
}

async function loadWorkflowForBot(uid, botId, workflowId, { includeGraph = true } = {}) {
  const workflow = await workflowRepo.get(uid, botId, workflowId);
  if (!workflow) throw notFound('Workflow not found.');
  return workflow;
}

export async function listWorkflows(uid, botId) {
  const rows = await workflowRepo.list(uid, botId);
  return rows.map((doc) => publicWorkflow(doc));
}

export async function getWorkflow(uid, botId, workflowId) {
  const doc = await loadWorkflowForBot(uid, botId, workflowId);
  return publicWorkflow(doc, { includeGraph: true });
}

export async function createWorkflow(uid, botId, { template = 'blank', name = null } = {}) {
  const bot = await botRepo.get(uid, botId);
  if (!bot) throw notFound('Bot not found.');
  const existing = await workflowRepo.list(uid, botId);
  if (existing.length >= 50) throw conflict('A bot can have at most 50 workflows.');

  let graph;
  if (template === 'welcome') graph = createWelcomeTemplate();
  else if (template === 'blank') graph = createEmptyWorkflow();
  else throw badRequest('template must be "blank" or "welcome".');

  if (name && typeof name === 'string') graph.name = name.trim().slice(0, WORKFLOW_LIMITS.NAME_MAX);

  // Template commands must not collide with an existing workflow trigger.
  if (template === 'welcome') {
    const command = graph.triggers[0]?.config.command;
    const taken = existing.some(
      (doc) =>
        doc.status !== WORKFLOW_STATUS.ARCHIVED &&
        (doc.triggers || doc.draft?.triggers || []).some(
          (trigger) => trigger.type === 'command' && trigger.config.command === command,
        ),
    );
    if (taken) graph.name = `${graph.name} (${existing.length + 1})`;
  }

  const doc = await workflowRepo.create(uid, botId, {
    schemaVersion: 1,
    name: graph.name,
    description: graph.description,
    status: WORKFLOW_STATUS.DRAFT,
    version: 0,
    publishedVersion: null,
    draft: graph,
    graph,
    summary: summarizeWorkflow(graph),
  });
  await auditRepo.record(uid, { action: 'workflow.created', botId, workflowId: doc.id, template });
  return publicWorkflow(doc, { includeGraph: true });
}

/** Save the draft after normalising it. Published versions are untouched. */
export async function saveWorkflow(uid, botId, workflowId, input) {
  const existing = await loadWorkflowForBot(uid, botId, workflowId);
  if (!input || typeof input !== 'object') throw badRequest('A workflow document is required.');
  // Drafts may be incomplete: they are saved with their validation report so
  // the editor can show what still needs fixing. Publishing requires validity.
  const { valid, errors, warnings, workflow } = validateWorkflow(input, workflowOptions());

  const updated = await workflowRepo.update(uid, botId, workflowId, {
    name: (workflow.name || '').trim() || 'Untitled workflow',
    description: workflow.description,
    draft: workflow,
    graph: workflow,
    summary: summarizeWorkflow(workflow),
  });
  await auditRepo.record(uid, { action: 'workflow.saved', botId, workflowId });
  return {
    workflow: publicWorkflow(updated, { includeGraph: true }),
    errors,
    warnings,
    valid,
    unchanged: workflowFingerprint(workflow) === workflowFingerprint(existing.draft || existing),
  };
}

export function validateWorkflowDocument(uid, botId, input) {
  const { valid, errors, warnings, workflow } = validateWorkflow(input, workflowOptions());
  return { valid, errors, warnings, workflow };
}

/** Validate then snapshot the workflow into an immutable version. */
export async function publishWorkflow(uid, botId, workflowId, { confirmProduction = false } = {}) {
  const existing = await loadWorkflowForBot(uid, botId, workflowId);
  const bot = await botRepo.get(uid, botId);
  const draft = existing.draft || existing;
  const { valid, errors, warnings, workflow } = validateWorkflow(draft, workflowOptions());
  if (!valid) {
    throw new AppError('Fix the validation errors before publishing.', {
      status: 422,
      code: 'validation_failed',
      details: errors,
    });
  }
  if (bot.environment === 'production' && confirmProduction !== true) {
    throw new AppError('This bot is marked as production. Confirm publishing to production explicitly.', {
      status: 409,
      code: 'production_confirmation_required',
    });
  }

  const version = (existing.publishedVersion || 0) + 1;
  const snapshot = {
    schemaVersion: workflow.schemaVersion,
    name: workflow.name,
    description: workflow.description,
    triggers: workflow.triggers,
    nodes: workflow.nodes,
    edges: workflow.edges,
    variables: workflow.variables,
    settings: workflow.settings,
  };
  await workflowRepo.addVersion(uid, botId, workflowId, {
    version,
    workflow: snapshot,
    fingerprint: workflowFingerprint(workflow),
    notes: null,
  });
  const updated = await workflowRepo.update(uid, botId, workflowId, {
    status: WORKFLOW_STATUS.PUBLISHED,
    version,
    publishedVersion: version,
    publishedAt: nowIso(),
    published: snapshot,
    publishedFingerprint: workflowFingerprint(workflow),
    draft: workflow,
    graph: workflow,
    summary: summarizeWorkflow(workflow),
  });
  await auditRepo.record(uid, { action: 'workflow.published', botId, workflowId, version });
  await syncSchedule(uid, botId, updated);
  return { workflow: publicWorkflow(updated, { includeGraph: true }), version, warnings };
}

/**
 * Keep the scheduler in sync with the workflow's schedule trigger.
 * Imported lazily so the workflow service and the runtime stay decoupled.
 */
async function syncSchedule(uid, botId, workflow) {
  try {
    const { syncWorkflowSchedule } = await import('./scheduler.js');
    await syncWorkflowSchedule(uid, botId, workflow);
  } catch (err) {
    logger.warn('schedule sync failed', { workflowId: workflow?.id, message: err.message });
  }
}

export async function pauseWorkflow(uid, botId, workflowId) {
  const existing = await loadWorkflowForBot(uid, botId, workflowId);
  if (existing.status !== WORKFLOW_STATUS.PUBLISHED) {
    throw badRequest('Only published workflows can be paused.');
  }
  const updated = await workflowRepo.update(uid, botId, workflowId, {
    status: WORKFLOW_STATUS.PAUSED,
    pausedAt: nowIso(),
  });
  await auditRepo.record(uid, { action: 'workflow.paused', botId, workflowId });
  await syncSchedule(uid, botId, updated);
  return publicWorkflow(updated, { includeGraph: true });
}

export async function resumeWorkflow(uid, botId, workflowId) {
  const existing = await loadWorkflowForBot(uid, botId, workflowId);
  if (existing.status !== WORKFLOW_STATUS.PAUSED) {
    throw badRequest('Only paused workflows can be resumed.');
  }
  if (!existing.published) {
    throw badRequest('Publish the workflow before resuming it.');
  }
  const updated = await workflowRepo.update(uid, botId, workflowId, {
    status: WORKFLOW_STATUS.PUBLISHED,
    resumedAt: nowIso(),
  });
  await auditRepo.record(uid, { action: 'workflow.resumed', botId, workflowId });
  await syncSchedule(uid, botId, updated);
  return publicWorkflow(updated, { includeGraph: true });
}

export async function duplicateWorkflow(uid, botId, workflowId) {
  const existing = await loadWorkflowForBot(uid, botId, workflowId);
  const graph = structuredClone(existing.draft || existing);
  graph.name = `${existing.name} (copy)`.slice(0, WORKFLOW_LIMITS.NAME_MAX);
  const doc = await workflowRepo.create(uid, botId, {
    schemaVersion: 1,
    name: graph.name,
    description: existing.description,
    status: WORKFLOW_STATUS.DRAFT,
    version: 0,
    publishedVersion: null,
    draft: graph,
    graph,
    summary: summarizeWorkflow(graph),
  });
  await auditRepo.record(uid, { action: 'workflow.duplicated', botId, workflowId, newWorkflowId: doc.id });
  return publicWorkflow(doc, { includeGraph: true });
}

export async function deleteWorkflow(uid, botId, workflowId) {
  const existing = await loadWorkflowForBot(uid, botId, workflowId);
  if (existing.status === WORKFLOW_STATUS.PUBLISHED) {
    throw conflict('Pause the workflow before deleting it, so live updates are not dropped silently.');
  }
  await workflowRepo.delete(uid, botId, workflowId);
  try {
    const { removeWorkflowSchedule } = await import('./scheduler.js');
    await removeWorkflowSchedule(uid, botId, workflowId);
  } catch (err) {
    logger.warn('schedule cleanup failed', { workflowId, message: err.message });
  }
  await auditRepo.record(uid, { action: 'workflow.deleted', botId, workflowId });
  return true;
}

export async function listVersions(uid, botId, workflowId) {
  await loadWorkflowForBot(uid, botId, workflowId, { includeGraph: false });
  const versions = await workflowRepo.listVersions(uid, botId, workflowId);
  return versions.map((version) => ({
    id: version.id,
    version: version.version,
    publishedAt: version.publishedAt,
    name: version.workflow?.name || null,
    nodeCount: version.workflow?.nodes?.length || 0,
  }));
}

export async function getVersion(uid, botId, workflowId, versionId) {
  await loadWorkflowForBot(uid, botId, workflowId, { includeGraph: false });
  const version = await workflowRepo.getVersion(uid, botId, workflowId, versionId);
  if (!version) throw notFound('Workflow version not found.');
  return version;
}

/** Restore a published version into the draft (never rewrites history). */
export async function restoreVersion(uid, botId, workflowId, versionId) {
  const version = await getVersion(uid, botId, workflowId, versionId);
  const updated = await workflowRepo.update(uid, botId, workflowId, {
    draft: version.workflow,
    graph: version.workflow,
    name: version.workflow.name,
    description: version.workflow.description || '',
    summary: summarizeWorkflow(version.workflow),
  });
  await auditRepo.record(uid, { action: 'workflow.version_restored', botId, workflowId, version: version.version });
  return publicWorkflow(updated, { includeGraph: true });
}

/** Validated import: rejects anything the schema cannot represent. */
export async function importWorkflow(uid, botId, document) {
  const parsed = typeof document === 'string' ? safeParse(document) : document;
  if (!parsed) throw badRequest('The imported file is not valid JSON.');
  // Accept both a bare workflow document and a BotForge export envelope.
  const raw = parsed.workflow && typeof parsed.workflow === 'object' ? parsed.workflow : parsed;
  if (JSON.stringify(raw).length > WORKFLOW_LIMITS.EXPORT_BYTES) {
    throw new AppError('The imported workflow exceeds the size limit.', { status: 413, code: 'payload_too_large' });
  }
  const { valid, errors, warnings, workflow } = validateWorkflow(raw, workflowOptions());
  if (!valid) {
    throw new AppError('The imported workflow is not valid.', { status: 422, code: 'validation_failed', details: errors });
  }
  // Imported workflows always start as drafts.
  workflow.status = WORKFLOW_STATUS.DRAFT;
  const doc = await workflowRepo.create(uid, botId, {
    schemaVersion: 1,
    name: workflow.name.slice(0, WORKFLOW_LIMITS.NAME_MAX),
    description: workflow.description,
    status: WORKFLOW_STATUS.DRAFT,
    version: 0,
    draft: workflow,
    graph: workflow,
    summary: summarizeWorkflow(workflow),
  });
  await auditRepo.record(uid, { action: 'workflow.imported', botId, workflowId: doc.id });
  return { workflow: publicWorkflow(doc, { includeGraph: true }), warnings };
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Export payload: always validated, never includes server-side ids of people. */
export async function exportWorkflow(uid, botId, workflowId) {
  const doc = await loadWorkflowForBot(uid, botId, workflowId);
  const graph = doc.draft || doc;
  return {
    botforgeExport: true,
    exportedAt: nowIso(),
    schemaVersion: graph.schemaVersion || 1,
    workflow: {
      schemaVersion: graph.schemaVersion || 1,
      name: graph.name,
      description: graph.description || '',
      triggers: graph.triggers || [],
      nodes: graph.nodes || [],
      edges: graph.edges || [],
      variables: graph.variables || {},
      settings: graph.settings || {},
    },
  };
}

/** Published workflows matching a simulated/live update (used by the runtime). */
export async function findMatchingWorkflows(uid, botId, matcher) {
  const rows = await workflowRepo.listPublishedForBot(uid, botId);
  const matches = [];
  for (const doc of rows) {
    const graph = doc.published || doc.draft;
    if (!graph) continue;
    const trigger = (graph.triggers || []).find((candidate) => matcher(candidate));
    if (trigger) matches.push({ workflow: doc, graph, trigger });
  }
  return matches;
}

export const __internal = { ALLOW_HTTP_ACTIONS, ALLOWED_EXTERNAL_HOSTS, config };
