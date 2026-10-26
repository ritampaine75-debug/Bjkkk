/**
 * Server-side repositories. Every privileged data access goes through here so
 * ownership scoping is applied consistently (paths always include the uid).
 */
import { getStore } from '../db/index.js';
import { newId, nowIso } from '../utils/ids.js';

export const paths = {
  user: (uid) => `users/${uid}`,
  credentials: (uid) => `credentials/${uid}`,
  bots: (uid) => `users/${uid}/bots`,
  bot: (uid, botId) => `users/${uid}/bots/${botId}`,
  botSecret: (botId) => `botSecrets/${botId}`,
  commands: (uid, botId) => `users/${uid}/bots/${botId}/commands`,
  command: (uid, botId, commandId) => `users/${uid}/bots/${botId}/commands/${commandId}`,
  workflows: (uid, botId) => `users/${uid}/bots/${botId}/workflows`,
  workflow: (uid, botId, wfId) => `users/${uid}/bots/${botId}/workflows/${wfId}`,
  workflowVersions: (uid, botId, wfId) => `users/${uid}/bots/${botId}/workflows/${wfId}/versions`,
  workflowVersion: (uid, botId, wfId, versionId) =>
    `users/${uid}/bots/${botId}/workflows/${wfId}/versions/${versionId}`,
  executions: (uid, botId) => `users/${uid}/bots/${botId}/executions`,
  execution: (uid, botId, execId) => `users/${uid}/bots/${botId}/executions/${execId}`,
  scenarios: (uid, botId) => `users/${uid}/bots/${botId}/testScenarios`,
  scenario: (uid, botId, sid) => `users/${uid}/bots/${botId}/testScenarios/${sid}`,
  auditLogs: (uid) => `users/${uid}/auditLogs`,
  auditLog: (uid, id) => `users/${uid}/auditLogs/${id}`,
  webhookReceipt: (botId, updateId) => `webhookReceipts/${botId}_${updateId}`,
  webhookRoute: (botId) => `webhookRoutes/${botId}`,
  scheduledJobs: 'scheduledJobs',
  scheduledJob: (id) => `scheduledJobs/${id}`,
};

const db = () => getStore();

/* --------------------------------------------------------------------------
 * Users
 * ------------------------------------------------------------------------ */
export const userRepo = {
  async get(uid) {
    return (await db()).doc.get(paths.user(uid));
  },
  async upsert(uid, data, { create = false } = {}) {
    const store = await db();
    const existing = await store.doc.get(paths.user(uid));
    const now = nowIso();
    if (!existing) {
      const doc = {
        uid,
        email: data.email || '',
        displayName: data.displayName || '',
        photoURL: data.photoURL || '',
        authProvider: data.authProvider || 'unknown',
        createdAt: now,
        updatedAt: now,
        lastLoginAt: now,
        preferences: { theme: 'system', ...(data.preferences || {}) },
      };
      await store.doc.set(paths.user(uid), doc);
      return doc;
    }
    if (create) return existing;
    const patch = {
      updatedAt: now,
      lastLoginAt: now,
      ...(data.email ? { email: data.email } : {}),
      ...(data.displayName ? { displayName: data.displayName } : {}),
      ...(data.photoURL ? { photoURL: data.photoURL } : {}),
    };
    await store.doc.update(paths.user(uid), patch);
    return { ...existing, ...patch };
  },
  async updatePreferences(uid, preferences) {
    const store = await db();
    const existing = await store.doc.get(paths.user(uid));
    if (!existing) return null;
    const merged = { ...existing.preferences, ...preferences };
    await store.doc.update(paths.user(uid), { preferences: merged, updatedAt: nowIso() });
    return merged;
  },
  // Local (development) credential records live in a server-only collection.
  async getCredentials(uid) {
    return (await db()).doc.get(paths.credentials(uid));
  },
  async setCredentials(uid, record) {
    await (await db()).doc.set(paths.credentials(uid), { ...record, uid, updatedAt: nowIso() });
  },
  async findCredentialsByEmail(email) {
    const rows = await (await db()).query('credentials', {
      where: [{ field: 'email', op: '==', value: String(email).toLowerCase() }],
      limit: 1,
    });
    return rows[0] || null;
  },
};

/* --------------------------------------------------------------------------
 * Bots
 * ------------------------------------------------------------------------ */
export const botRepo = {
  async list(uid) {
    const rows = await (await db()).query(paths.bots(uid), {
      orderBy: { field: 'createdAt', direction: 'desc' },
    });
    return rows;
  },
  async get(uid, botId) {
    return (await db()).doc.get(paths.bot(uid, botId));
  },
  async create(uid, data) {
    const store = await db();
    const botId = data.id || newId('bot');
    const now = nowIso();
    const doc = { ...data, id: botId, uid, createdAt: now, updatedAt: now };
    await store.doc.set(paths.bot(uid, botId), doc);
    return doc;
  },
  async update(uid, botId, patch) {
    const store = await db();
    const updated = { ...patch, updatedAt: nowIso() };
    const ok = await store.doc.update(paths.bot(uid, botId), updated);
    if (!ok) return null;
    return store.doc.get(paths.bot(uid, botId));
  },
  async delete(uid, botId) {
    const store = await db();
    await store.deleteTree(paths.bot(uid, botId));
    await store.doc.delete(paths.botSecret(botId));
    return true;
  },
  async findByTelegramId(uid, telegramId) {
    const rows = await (await db()).query(paths.bots(uid), {
      where: [{ field: 'telegram.id', op: '==', value: telegramId }],
      limit: 1,
    });
    return rows[0] || null;
  },
};

/** Encrypted token records live in a top-level, client-inaccessible collection. */
export const botSecretRepo = {
  async get(botId) {
    return (await db()).doc.get(paths.botSecret(botId));
  },
  async set(botId, record) {
    await (await db()).doc.set(paths.botSecret(botId), { ...record, botId, updatedAt: nowIso() });
  },
  async delete(botId) {
    return (await db()).doc.delete(paths.botSecret(botId));
  },
};

/* --------------------------------------------------------------------------
 * Commands
 * ------------------------------------------------------------------------ */
export const commandRepo = {
  async list(uid, botId) {
    return (await db()).query(paths.commands(uid, botId), {
      orderBy: { field: 'name', direction: 'asc' },
    });
  },
  async get(uid, botId, commandId) {
    return (await db()).doc.get(paths.command(uid, botId, commandId));
  },
  async findByName(uid, botId, name) {
    const rows = await (await db()).query(paths.commands(uid, botId), {
      where: [{ field: 'name', op: '==', value: name }],
      limit: 1,
    });
    return rows[0] || null;
  },
  async save(uid, botId, command) {
    const store = await db();
    const id = command.id || newId('cmd');
    const existing = command.id ? await store.doc.get(paths.command(uid, botId, id)) : null;
    const now = nowIso();
    const doc = {
      ...existing,
      ...command,
      id,
      uid,
      botId,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    await store.doc.set(paths.command(uid, botId, id), doc);
    return doc;
  },
  async delete(uid, botId, commandId) {
    return (await db()).doc.delete(paths.command(uid, botId, commandId));
  },
  async replaceAll(uid, botId, commands) {
    const store = await db();
    const existing = await commandRepo.list(uid, botId);
    for (const old of existing) await store.doc.delete(paths.command(uid, botId, old.id));
    const saved = [];
    for (const cmd of commands) saved.push(await commandRepo.save(uid, botId, cmd));
    return saved;
  },
};

/* --------------------------------------------------------------------------
 * Workflows + versions
 * ------------------------------------------------------------------------ */
export const workflowRepo = {
  async list(uid, botId) {
    return (await db()).query(paths.workflows(uid, botId), {
      orderBy: { field: 'updatedAt', direction: 'desc' },
    });
  },
  async get(uid, botId, workflowId) {
    return (await db()).doc.get(paths.workflow(uid, botId, workflowId));
  },
  async findTriggerMatches(uid, botId, predicate) {
    const rows = await workflowRepo.list(uid, botId);
    return rows.filter(predicate);
  },
  async create(uid, botId, data) {
    const store = await db();
    const id = data.id || newId('wf');
    const now = nowIso();
    const doc = {
      ...data,
      id,
      uid,
      botId,
      createdAt: now,
      updatedAt: now,
      publishedVersion: data.publishedVersion ?? null,
    };
    await store.doc.set(paths.workflow(uid, botId, id), doc);
    return doc;
  },
  async update(uid, botId, workflowId, patch) {
    const store = await db();
    const ok = await store.doc.update(paths.workflow(uid, botId, workflowId), {
      ...patch,
      updatedAt: nowIso(),
    });
    if (!ok) return null;
    return store.doc.get(paths.workflow(uid, botId, workflowId));
  },
  async delete(uid, botId, workflowId) {
    const store = await db();
    await store.deleteTree(paths.workflow(uid, botId, workflowId));
    await store.doc.delete(paths.workflow(uid, botId, workflowId));
    return true;
  },
  async addVersion(uid, botId, workflowId, version) {
    const store = await db();
    const versionId = String(version.version).padStart(6, '0');
    await store.doc.set(paths.workflowVersion(uid, botId, workflowId, versionId), {
      ...version,
      id: versionId,
      workflowId,
      publishedAt: nowIso(),
    });
    return versionId;
  },
  async listVersions(uid, botId, workflowId) {
    return (await db()).query(paths.workflowVersions(uid, botId, workflowId), {
      orderBy: { field: 'version', direction: 'desc' },
    });
  },
  async getVersion(uid, botId, workflowId, versionId) {
    return (await db()).doc.get(paths.workflowVersion(uid, botId, workflowId, versionId));
  },
  async listPublishedForBot(uid, botId) {
    const rows = await workflowRepo.list(uid, botId);
    return rows.filter((wf) => wf.status === 'published' && wf.published);
  },
};

/* --------------------------------------------------------------------------
 * Executions
 * ------------------------------------------------------------------------ */
export const executionRepo = {
  async create(uid, botId, execution) {
    const store = await db();
    const id = execution.id || newId('exec');
    const doc = { ...execution, id, uid, botId };
    await store.doc.set(paths.execution(uid, botId, id), doc);
    return doc;
  },
  async update(uid, botId, executionId, patch) {
    const store = await db();
    const ok = await store.doc.update(paths.execution(uid, botId, executionId), patch);
    if (!ok) return null;
    return store.doc.get(paths.execution(uid, botId, executionId));
  },
  async get(uid, botId, executionId) {
    return (await db()).doc.get(paths.execution(uid, botId, executionId));
  },
  async list(uid, botId, { limit = 25, offset = 0, status = null, workflowId = null } = {}) {
    const where = [];
    if (status) where.push({ field: 'status', op: '==', value: status });
    if (workflowId) where.push({ field: 'workflowId', op: '==', value: workflowId });
    const rows = await (await db()).query(paths.executions(uid, botId), {
      where,
      orderBy: { field: 'startedAt', direction: 'desc' },
      limit,
      offset,
    });
    return rows;
  },
  async recent(uid, botId, limit = 5) {
    return executionRepo.list(uid, botId, { limit });
  },
  async stats(uid, botId) {
    const store = await db();
    const total = await store.count(paths.executions(uid, botId));
    const failed = await store.count(paths.executions(uid, botId), {
      where: [{ field: 'status', op: 'in', value: ['failed', 'timeout'] }],
    });
    const succeeded = await store.count(paths.executions(uid, botId), {
      where: [{ field: 'status', op: '==', value: 'succeeded' }],
    });
    return { total, failed, succeeded };
  },
};

/* --------------------------------------------------------------------------
 * Test scenarios
 * ------------------------------------------------------------------------ */
export const scenarioRepo = {
  async list(uid, botId) {
    return (await db()).query(paths.scenarios(uid, botId), {
      orderBy: { field: 'createdAt', direction: 'asc' },
    });
  },
  async save(uid, botId, scenario) {
    const store = await db();
    const id = scenario.id || newId('scn');
    const existing = scenario.id ? await store.doc.get(paths.scenario(uid, botId, id)) : null;
    const doc = {
      ...existing,
      ...scenario,
      id,
      createdAt: existing?.createdAt || nowIso(),
      updatedAt: nowIso(),
    };
    await store.doc.set(paths.scenario(uid, botId, id), doc);
    return doc;
  },
  async delete(uid, botId, id) {
    return (await db()).doc.delete(paths.scenario(uid, botId, id));
  },
};

/* --------------------------------------------------------------------------
 * Audit + webhook idempotency
 * ------------------------------------------------------------------------ */
export const auditRepo = {
  async record(uid, entry) {
    const store = await db();
    const id = newId('audit');
    await store.doc.set(paths.auditLog(uid, id), {
      id,
      at: nowIso(),
      ...entry,
    });
    return id;
  },
  async list(uid, { limit = 25, offset = 0 } = {}) {
    return (await db()).query(paths.auditLogs(uid), {
      orderBy: { field: 'at', direction: 'desc' },
      limit,
      offset,
    });
  },
};

export const webhookReceiptRepo = {
  /** Returns true when this update has not been seen before (atomic claim). */
  async claim(botId, updateId, meta = {}) {
    const store = await db();
    return store.doc.create(paths.webhookReceipt(botId, updateId), {
      botId,
      updateId,
      receivedAt: nowIso(),
      ...meta,
    });
  },
  async get(botId, updateId) {
    return (await db()).doc.get(paths.webhookReceipt(botId, updateId));
  },
};

/** Per-bot webhook routing record. Only hashes of the capability key are stored. */
export const webhookRouteRepo = {
  async set(botId, data) {
    const store = await db();
    await store.doc.set(paths.webhookRoute(botId), { ...data, botId, updatedAt: nowIso() });
    return webhookRouteRepo.get(botId);
  },
  async get(botId) {
    return (await db()).doc.get(paths.webhookRoute(botId));
  },
  async delete(botId) {
    return (await db()).doc.delete(paths.webhookRoute(botId));
  },
};

/* --------------------------------------------------------------------------
 * Scheduled jobs
 * ------------------------------------------------------------------------ */
export const jobRepo = {
  async upsert(job) {
    const store = await db();
    const id = job.id || newId('job');
    const doc = { ...job, id, updatedAt: nowIso() };
    await store.doc.set(paths.scheduledJob(id), doc);
    return doc;
  },
  async list({ dueBefore = null, enabled = null, limit = 50 } = {}) {
    const where = [];
    if (enabled !== null) where.push({ field: 'enabled', op: '==', value: enabled });
    const rows = await (await db()).query(paths.scheduledJobs, {
      where,
      orderBy: { field: 'nextRunAt', direction: 'asc' },
      limit,
    });
    if (!dueBefore) return rows;
    return rows.filter((row) => !row.nextRunAt || row.nextRunAt <= dueBefore);
  },
  async get(id) {
    return (await db()).doc.get(paths.scheduledJob(id));
  },
  async update(id, patch) {
    await (await db()).doc.update(paths.scheduledJob(id), { ...patch, updatedAt: nowIso() });
    return jobRepo.get(id);
  },
  async delete(id) {
    return (await db()).doc.delete(paths.scheduledJob(id));
  },
};
