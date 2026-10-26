/**
 * BotForge workflow schema (version 1).
 *
 * A workflow is a set of triggers, action/condition nodes and directed edges.
 * Both editors (form mode and visual mode) read and write this exact structure,
 * and the runtime interpreter executes it - there is no second representation.
 *
 * {
 *   schemaVersion: 1,
 *   name: 'Welcome workflow',
 *   description: '',
 *   status: 'draft' | 'published' | 'paused',
 *   triggers: [{ id, type, config }],
 *   nodes:    [{ id, type, config, position: { x, y } }],
 *   edges:    [{ id, from, to, label? }],   // from: trigger or node id
 *   variables: { name: default },
 *   settings: { cooldownSeconds, allowConcurrentRuns }
 * }
 */
import {
  WORKFLOW_SCHEMA_VERSION,
  WORKFLOW_STATUS,
  WORKFLOW_LIMITS,
  TRIGGER_TYPES,
  NODE_TYPES,
  CONDITION_OPERATORS,
  CONDITION_SUBJECTS,
} from './constants.js';
import { normalizeKeyboard } from './command-schema.js';

const STATUSES = Object.values(WORKFLOW_STATUS);

export const NODE_DEFINITIONS = Object.freeze({
  sendMessage: { kind: 'action', label: 'Send text message', outputs: 1 },
  sendPhoto: { kind: 'action', label: 'Send photo', outputs: 1 },
  sendDocument: { kind: 'action', label: 'Send document', outputs: 1 },
  sendMedia: { kind: 'action', label: 'Send media (audio/video)', outputs: 1 },
  sendKeyboard: { kind: 'action', label: 'Send message with inline keyboard', outputs: 1 },
  editMessage: { kind: 'action', label: 'Edit last message', outputs: 1 },
  answerCallback: { kind: 'action', label: 'Answer callback query', outputs: 1 },
  setVariable: { kind: 'action', label: 'Set variable', outputs: 1 },
  delay: { kind: 'action', label: 'Delay', outputs: 1 },
  httpRequest: { kind: 'action', label: 'Call HTTP API (allowlisted)', outputs: 1 },
  logEvent: { kind: 'action', label: 'Log event', outputs: 1 },
  end: { kind: 'action', label: 'End workflow', outputs: 0 },
  condition: { kind: 'condition', label: 'Condition / branch', outputs: 2 },
});

export const TRIGGER_DEFINITIONS = Object.freeze({
  command: { label: 'Telegram command', description: 'Runs when a user sends a specific command.' },
  text: { label: 'Incoming text message', description: 'Runs for any text message.' },
  callback: { label: 'Callback button click', description: 'Runs when an inline button is tapped.' },
  newMember: { label: 'New member joins', description: 'Runs when a new member joins a group the bot can see.' },
  keyword: { label: 'Keyword match', description: 'Runs when a message contains one of the keywords.' },
  schedule: { label: 'Schedule', description: 'Runs on a schedule managed by BotForge.' },
  manual: { label: 'Manual test trigger', description: 'Runs only from the simulator or live test lab.' },
});

const TRIGGER_KINDS = Object.keys(TRIGGER_DEFINITIONS);
const NODE_KINDS = Object.keys(NODE_DEFINITIONS);

/* --------------------------------------------------------------------------
 * Builders
 * ------------------------------------------------------------------------ */
let idCounter = 0;
export function newEntityId(prefix) {
  idCounter = (idCounter + 1) % 100000;
  const random = Math.random().toString(36).slice(2, 7);
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}${random}`;
}

export function createTrigger(type = 'command', config = {}) {
  return { id: newEntityId('trg'), type, config: { command: 'start', ...config } };
}

export function createNode(type = 'sendMessage', config = {}, position = null) {
  return {
    id: newEntityId('nd'),
    type,
    config: { ...defaultConfigFor(type), ...config },
    position: position || { x: 60, y: 80 },
  };
}

export function defaultConfigFor(type) {
  switch (type) {
    case 'sendMessage':
      return { text: '' };
    case 'sendPhoto':
      return { photo: '', caption: '' };
    case 'sendDocument':
      return { document: '', caption: '' };
    case 'sendMedia':
      return { mediaType: 'audio', file: '', caption: '' };
    case 'sendKeyboard':
      return { text: '', keyboard: { rows: [] } };
    case 'editMessage':
      return { text: '' };
    case 'answerCallback':
      return { text: '', showAlert: false };
    case 'setVariable':
      return { name: 'lastChoice', value: '' };
    case 'delay':
      return { ms: 1000 };
    case 'httpRequest':
      return { url: '', method: 'GET', body: '', headers: {} };
    case 'logEvent':
      return { message: 'Reached this step' };
    case 'end':
      return { reason: 'completed' };
    case 'condition':
      return { subject: 'text', operator: 'contains', value: '', variableName: '' };
    default:
      return {};
  }
}

export function createEmptyWorkflow(overrides = {}) {
  return {
    schemaVersion: WORKFLOW_SCHEMA_VERSION,
    name: 'Untitled workflow',
    description: '',
    status: WORKFLOW_STATUS.DRAFT,
    triggers: [],
    nodes: [],
    edges: [],
    variables: {},
    settings: { cooldownSeconds: 0, allowConcurrentRuns: false },
    ...overrides,
  };
}

/** Starter template: /start → welcome message with inline keyboard. */
export function createWelcomeTemplate() {
  const trigger = createTrigger('command', { command: 'start' });
  const send = createNode(
    'sendKeyboard',
    {
      text: 'Welcome to BotForge Demo Bot.\n\nChoose an option below.',
      keyboard: {
        rows: [
          [
            { text: 'Help', type: 'callback', value: 'help' },
            { text: 'About', type: 'callback', value: 'about' },
          ],
          [{ text: 'Contact', type: 'callback', value: 'contact' }],
        ],
      },
    },
    { x: 60, y: 120 },
  );
  const end = createNode('end', { reason: 'completed' }, { x: 60, y: 320 });
  return createEmptyWorkflow({
    name: 'Welcome workflow',
    description: 'Replies to /start with a welcome message and inline keyboard.',
    triggers: [trigger],
    nodes: [send, end],
    edges: [
      { id: newEntityId('edg'), from: trigger.id, to: send.id },
      { id: newEntityId('edg'), from: send.id, to: end.id },
    ],
  });
}

/* --------------------------------------------------------------------------
 * Normalisation + validation
 * ------------------------------------------------------------------------ */
function asString(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function clampText(value, max) {
  return asString(value).slice(0, max);
}

export function validateTrigger(trigger, index, errors) {
  const field = `triggers[${index}]`;
  if (!trigger || typeof trigger !== 'object') {
    errors.push({ field, message: 'Trigger must be an object.' });
    return null;
  }
  if (!trigger.id || typeof trigger.id !== 'string') {
    errors.push({ field: `${field}.id`, message: 'Trigger id is required.' });
  }
  if (!TRIGGER_KINDS.includes(trigger.type)) {
    errors.push({ field: `${field}.type`, message: `Unsupported trigger type "${trigger.type}".` });
    return null;
  }
  const config = trigger.config && typeof trigger.config === 'object' ? trigger.config : {};
  const normalized = { ...config };

  switch (trigger.type) {
    case 'command': {
      const name = asString(config.command, '').trim().replace(/^\//, '').toLowerCase();
      if (!name) errors.push({ field: `${field}.config.command`, message: 'Choose which command triggers this workflow.' });
      else if (!/^[a-z0-9_]{1,32}$/.test(name)) {
        errors.push({ field: `${field}.config.command`, message: 'Command names may only contain lowercase letters, digits and underscores.' });
      }
      normalized.command = name;
      break;
    }
    case 'keyword': {
      const keywords = Array.isArray(config.keywords) ? config.keywords : [];
      const cleaned = keywords.map((k) => asString(k).trim()).filter(Boolean).slice(0, 20);
      if (cleaned.length === 0) errors.push({ field: `${field}.config.keywords`, message: 'Add at least one keyword.' });
      cleaned.forEach((k) => {
        if (k.length > 64) errors.push({ field: `${field}.config.keywords`, message: 'Keywords must be 64 characters or fewer.' });
      });
      normalized.keywords = cleaned;
      normalized.matchMode = config.matchMode === 'exact' ? 'exact' : 'contains';
      break;
    }
    case 'callback': {
      normalized.data = asString(config.data).slice(0, 64);
      normalized.matchAny = config.matchAny !== false;
      break;
    }
    case 'schedule': {
      const intervalMinutes = Number(config.intervalMinutes);
      if (!Number.isInteger(intervalMinutes) || intervalMinutes < 1 || intervalMinutes > 10080) {
        errors.push({ field: `${field}.config.intervalMinutes`, message: 'Interval must be between 1 and 10080 minutes.' });
      }
      normalized.intervalMinutes = Number.isFinite(intervalMinutes) ? intervalMinutes : 60;
      normalized.timezone = asString(config.timezone, 'UTC').slice(0, 64);
      break;
    }
    case 'text':
    case 'newMember':
    case 'manual':
      break;
    default:
      break;
  }

  return { id: trigger.id, type: trigger.type, config: normalized };
}

export function validateNode(node, index, errors, { allowHttp = false, allowedHosts = [] } = {}) {
  const field = `nodes[${index}]`;
  if (!node || typeof node !== 'object') {
    errors.push({ field, message: 'Node must be an object.' });
    return null;
  }
  if (!node.id || typeof node.id !== 'string') {
    errors.push({ field: `${field}.id`, message: 'Node id is required.' });
  }
  if (!NODE_KINDS.includes(node.type)) {
    errors.push({ field: `${field}.type`, message: `Unsupported node type "${node.type}".` });
    return null;
  }
  const config = node.config && typeof node.config === 'object' ? node.config : {};
  const normalized = { ...defaultConfigFor(node.type), ...config };

  switch (node.type) {
    case 'sendMessage':
    case 'editMessage':
    case 'logEvent': {
      const key = node.type === 'logEvent' ? 'message' : 'text';
      const text = asString(config[key], '').trim();
      if (!text) errors.push({ field: `${field}.config.${key}`, message: 'This node needs message text.' });
      if (text.length > WORKFLOW_LIMITS.TEXT_MAX) {
        errors.push({ field: `${field}.config.${key}`, message: `Text must be ${WORKFLOW_LIMITS.TEXT_MAX} characters or fewer.` });
      }
      normalized[key] = text;
      if (node.type !== 'logEvent') normalized.parseMode = ['plain', 'HTML', 'MarkdownV2'].includes(config.parseMode) ? config.parseMode : 'plain';
      break;
    }
    case 'sendKeyboard': {
      const text = asString(config.text, '').trim();
      if (!text) errors.push({ field: `${field}.config.text`, message: 'Add the message text shown above the buttons.' });
      normalized.text = text.slice(0, WORKFLOW_LIMITS.TEXT_MAX);
      const keyboardErrors = [];
      normalized.keyboard = normalizeKeyboard(config.keyboard, keyboardErrors);
      keyboardErrors.forEach((err) => errors.push({ field: `${field}.config.${err.field}`, message: err.message }));
      if (normalized.keyboard.rows.length === 0) {
        errors.push({ field: `${field}.config.keyboard`, message: 'Add at least one button, or use a plain text message node.' });
      }
      break;
    }
    case 'sendPhoto':
    case 'sendDocument': {
      const key = node.type === 'sendPhoto' ? 'photo' : 'document';
      const source = asString(config[key], '').trim();
      if (!source) {
        errors.push({ field: `${field}.config.${key}`, message: 'Provide a public URL or a Telegram file_id.' });
      } else if (source.startsWith('http')) {
        try {
          const url = new URL(source);
          if (!['https:', 'http:'].includes(url.protocol)) throw new Error('protocol');
        } catch {
          errors.push({ field: `${field}.config.${key}`, message: 'The URL is not valid.' });
        }
      }
      normalized[key] = source;
      normalized.caption = clampText(config.caption, 1024);
      break;
    }
    case 'sendMedia': {
      const mediaType = ['audio', 'video', 'animation', 'voice'].includes(config.mediaType) ? config.mediaType : 'audio';
      const file = asString(config.file, '').trim();
      if (!file) errors.push({ field: `${field}.config.file`, message: 'Provide a public URL or a Telegram file_id.' });
      normalized.mediaType = mediaType;
      normalized.file = file;
      normalized.caption = clampText(config.caption, 1024);
      break;
    }
    case 'answerCallback': {
      normalized.text = clampText(config.text, 200);
      normalized.showAlert = config.showAlert === true;
      break;
    }
    case 'setVariable': {
      const name = asString(config.name, '').trim();
      if (!/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(name)) {
        errors.push({ field: `${field}.config.name`, message: 'Variable names must start with a letter and use letters, digits or underscores.' });
      }
      const value = asString(config.value, '');
      if (value.length > WORKFLOW_LIMITS.VARIABLE_VALUE_MAX) {
        errors.push({ field: `${field}.config.value`, message: 'Variable values must be 2000 characters or fewer.' });
      }
      normalized.name = name;
      normalized.value = value;
      break;
    }
    case 'delay': {
      const ms = Number(config.ms);
      if (!Number.isInteger(ms) || ms < 0) {
        errors.push({ field: `${field}.config.ms`, message: 'Delay must be a whole number of milliseconds.' });
      } else if (ms > WORKFLOW_LIMITS.DELAY_MAX_MS) {
        errors.push({ field: `${field}.config.ms`, message: `Delays are limited to ${WORKFLOW_LIMITS.DELAY_MAX_MS / 1000} seconds.` });
      }
      normalized.ms = Number.isInteger(ms) ? ms : 0;
      break;
    }
    case 'httpRequest': {
      const url = asString(config.url, '').trim();
      const method = ['GET', 'POST'].includes(config.method) ? config.method : 'GET';
      if (!url) {
        errors.push({ field: `${field}.config.url`, message: 'Provide an HTTPS URL to call.' });
      } else {
        let parsed = null;
        try {
          parsed = new URL(url);
        } catch {
          errors.push({ field: `${field}.config.url`, message: 'The URL is not valid.' });
        }
        if (parsed) {
          if (parsed.protocol !== 'https:') {
            errors.push({ field: `${field}.config.url`, message: 'Only HTTPS URLs are allowed.' });
          }
          if (allowHttp === false) {
            errors.push({ field: `${field}.config.url`, message: 'External HTTP actions are disabled on this deployment.' });
          } else if (allowedHosts.length > 0 && !allowedHosts.includes(parsed.hostname)) {
            errors.push({
              field: `${field}.config.url`,
              message: `Host "${parsed.hostname}" is not in the allowlist (${allowedHosts.join(', ')}).`,
            });
          }
        }
      }
      normalized.url = url;
      normalized.method = method;
      normalized.body = clampText(config.body, 4000);
      normalized.headers = config.headers && typeof config.headers === 'object' ? config.headers : {};
      break;
    }
    case 'end': {
      normalized.reason = clampText(config.reason, 200) || 'completed';
      break;
    }
    case 'condition': {
      const subject = CONDITION_SUBJECTS.includes(config.subject) ? config.subject : 'text';
      const operator = CONDITION_OPERATORS.includes(config.operator) ? config.operator : 'equals';
      normalized.subject = subject;
      normalized.operator = operator;
      normalized.value = clampText(config.value, 500);
      if (subject === 'variable') {
        const variableName = asString(config.variableName, '').trim();
        if (!/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(variableName)) {
          errors.push({ field: `${field}.config.variableName`, message: 'Choose the variable to evaluate.' });
        }
        normalized.variableName = variableName;
      }
      if (operator === 'regex') {
        try {
          // Compile only to validate the pattern; never executed against input here.
          new RegExp(normalized.value.slice(0, 200));
        } catch {
          errors.push({ field: `${field}.config.value`, message: 'The regular expression is invalid.' });
        }
      }
      if (['gt', 'gte', 'lt', 'lte'].includes(operator) && normalized.value !== '' && Number.isNaN(Number(normalized.value))) {
        errors.push({ field: `${field}.config.value`, message: 'Numeric comparisons need a number.' });
      }
      break;
    }
    default:
      break;
  }

  const position = node.position && typeof node.position === 'object' ? node.position : {};
  return {
    id: node.id,
    type: node.type,
    config: normalized,
    position: {
      x: Number.isFinite(position.x) ? Math.max(0, Math.min(4000, Math.round(position.x))) : 60,
      y: Number.isFinite(position.y) ? Math.max(0, Math.min(4000, Math.round(position.y))) : 80,
    },
  };
}

/**
 * Validate and normalise a complete workflow document.
 * Returns { valid, errors, warnings, workflow }.
 */
export function validateWorkflow(input, { allowHttp = false, allowedHosts = [] } = {}) {
  const errors = [];
  const warnings = [];
  const source = input && typeof input === 'object' ? input : {};

  if (source.schemaVersion !== undefined && source.schemaVersion !== WORKFLOW_SCHEMA_VERSION) {
    errors.push({ field: 'schemaVersion', message: `Unsupported schema version ${source.schemaVersion}. This build supports version ${WORKFLOW_SCHEMA_VERSION}.` });
  }

  const name = asString(source.name, '').trim();
  if (!name) errors.push({ field: 'name', message: 'Give the workflow a name.' });
  else if (name.length > WORKFLOW_LIMITS.NAME_MAX) {
    errors.push({ field: 'name', message: `Names must be ${WORKFLOW_LIMITS.NAME_MAX} characters or fewer.` });
  }

  const status = STATUSES.includes(source.status) ? source.status : WORKFLOW_STATUS.DRAFT;

  const triggersInput = Array.isArray(source.triggers) ? source.triggers : [];
  const nodesInput = Array.isArray(source.nodes) ? source.nodes : [];
  const edgesInput = Array.isArray(source.edges) ? source.edges : [];

  if (triggersInput.length === 0) errors.push({ field: 'triggers', message: 'Add at least one trigger.' });
  if (triggersInput.length > 10) errors.push({ field: 'triggers', message: 'A workflow can have at most 10 triggers.' });
  if (nodesInput.length === 0) errors.push({ field: 'nodes', message: 'Add at least one action node.' });
  if (nodesInput.length > WORKFLOW_LIMITS.MAX_NODES) {
    errors.push({ field: 'nodes', message: `A workflow can have at most ${WORKFLOW_LIMITS.MAX_NODES} nodes.` });
  }
  if (edgesInput.length > WORKFLOW_LIMITS.MAX_EDGES) {
    errors.push({ field: 'edges', message: `A workflow can have at most ${WORKFLOW_LIMITS.MAX_EDGES} edges.` });
  }

  const triggers = [];
  triggersInput.forEach((trigger, index) => {
    const normalized = validateTrigger(trigger, index, errors);
    if (normalized) triggers.push(normalized);
  });

  const nodes = [];
  nodesInput.forEach((node, index) => {
    const normalized = validateNode(node, index, errors, { allowHttp, allowedHosts });
    if (normalized) nodes.push(normalized);
  });

  const triggerIds = new Set(triggers.map((t) => t.id));
  const nodeIds = new Set(nodes.map((n) => n.id));
  if (triggerIds.size !== triggers.length) errors.push({ field: 'triggers', message: 'Trigger ids must be unique.' });
  if (nodeIds.size !== nodes.length) errors.push({ field: 'nodes', message: 'Node ids must be unique.' });

  const seenNodeCommand = new Set();
  triggers.forEach((trigger) => {
    if (trigger.type !== 'command') return;
    const key = trigger.config.command;
    if (seenNodeCommand.has(key)) {
      errors.push({ field: 'triggers', message: `More than one trigger uses /${key}.` });
    }
    seenNodeCommand.add(key);
  });

  const edges = [];
  const outgoing = new Map();
  const incoming = new Map();
  const seenEdgeIds = new Set();

  edgesInput.forEach((edge, index) => {
    const field = `edges[${index}]`;
    if (!edge || typeof edge !== 'object') {
      errors.push({ field, message: 'Edge must be an object.' });
      return;
    }
    const id = typeof edge.id === 'string' && edge.id ? edge.id : newEntityId('edg');
    if (seenEdgeIds.has(id)) errors.push({ field: `${field}.id`, message: 'Edge ids must be unique.' });
    seenEdgeIds.add(id);

    if (!nodeIds.has(edge.to)) {
      errors.push({ field: `${field}.to`, message: 'Edge target must be an existing node.' });
      return;
    }
    const fromIsTrigger = triggerIds.has(edge.from);
    if (!fromIsTrigger && !nodeIds.has(edge.from)) {
      errors.push({ field: `${field}.from`, message: 'Edge source must be an existing trigger or node.' });
      return;
    }
    if (fromIsTrigger) {
      if (nodeIds.has(edge.from)) {
        errors.push({ field: `${field}.from`, message: 'Trigger and node ids must not collide.' });
      }
    }

    let label = null;
    if (edge.label !== undefined && edge.label !== null && edge.label !== '') {
      if (!['true', 'false'].includes(edge.label)) {
        errors.push({ field: `${field}.label`, message: 'Edge labels may only be "true" or "false".' });
        return;
      }
      label = edge.label;
    }

    if (fromIsTrigger) {
      const trigger = triggers.find((t) => t.id === edge.from);
      if (trigger) {
        const key = `${trigger.id}`;
        const existing = outgoing.get(key) || [];
        if (existing.length > 0) {
          errors.push({ field: `${field}.from`, message: 'A trigger can only start one branch.' });
        }
      }
    } else {
      const sourceNode = nodes.find((n) => n.id === edge.from);
      const definition = sourceNode ? NODE_DEFINITIONS[sourceNode.type] : null;
      const key = `${edge.from}`;
      const existing = outgoing.get(key) || [];
      if (definition && definition.outputs === 0) {
        errors.push({ field: `${field}.from`, message: `${definition.label} nodes cannot have an outgoing connection.` });
      } else if (definition && definition.outputs === 2) {
        if (label === null) {
          errors.push({ field: `${field}.label`, message: 'Condition branches must be labelled "true" or "false".' });
        } else if (existing.some((e) => e.label === label)) {
          errors.push({ field: `${field}.label`, message: `The "${label}" branch is already connected.` });
        }
      } else if (existing.length >= (definition?.outputs ?? 1)) {
        errors.push({ field: `${field}.from`, message: 'This node already has an outgoing connection.' });
      }
    }

    // Multiple incoming connections are allowed (branch convergence); the
    // interpreter executes a converging node once per run.
    const incomingKey = String(edge.to);
    incoming.set(incomingKey, (incoming.get(incomingKey) || 0) + 1);

    const list = outgoing.get(String(edge.from)) || [];
    list.push({ label });
    outgoing.set(String(edge.from), list);

    edges.push({ id, from: edge.from, to: edge.to, ...(label ? { label } : {}) });
  });

  // Conditions must branch in both directions.
  nodes.forEach((node, index) => {
    if (node.type !== 'condition') return;
    const outgoing = edges.filter((edge) => edge.from === node.id);
    for (const label of ['true', 'false']) {
      if (!outgoing.some((edge) => edge.label === label)) {
        errors.push({
          field: `nodes[${index}].config`,
          message: `This condition needs a "${label}" branch connection.`,
        });
      }
    }
  });

  // Connectivity: every trigger must start a branch.
  triggers.forEach((trigger, index) => {
    if (!edges.some((edge) => edge.from === trigger.id)) {
      errors.push({ field: `triggers[${index}]`, message: 'This trigger is not connected to any node. Drag a connection or add one in the form editor.' });
    }
  });

  // Unreachable nodes are a warning, not an error (draft-friendly).
  if (triggers.length > 0 && nodes.length > 0) {
    const reachable = new Set();
    const queue = triggers.map((t) => t.id);
    while (queue.length > 0) {
      const current = queue.shift();
      for (const edge of edges.filter((e) => e.from === current)) {
        if (!reachable.has(edge.to)) {
          reachable.add(edge.to);
          queue.push(edge.to);
        }
      }
    }
    const unreachable = nodes.filter((node) => !reachable.has(node.id));
    if (unreachable.length > 0) {
      warnings.push({
        field: 'nodes',
        message: `${unreachable.length} node${unreachable.length === 1 ? ' is' : 's are'} not reachable from a trigger and will never run.`,
      });
    }
    if (hasCycle({ triggers, nodes, edges })) {
      errors.push({ field: 'edges', message: 'The workflow contains a loop. Loops are not supported because they can run forever.' });
    }
  }

  const variables = {};
  if (source.variables && typeof source.variables === 'object' && !Array.isArray(source.variables)) {
    const entries = Object.entries(source.variables).slice(0, WORKFLOW_LIMITS.MAX_VARIABLES);
    for (const [key, value] of entries) {
      if (!/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(key)) {
        errors.push({ field: `variables.${key}`, message: 'Variable names must start with a letter and use letters, digits or underscores.' });
        continue;
      }
      variables[key] = String(value ?? '').slice(0, WORKFLOW_LIMITS.VARIABLE_VALUE_MAX);
    }
  }

  const settingsInput = source.settings && typeof source.settings === 'object' ? source.settings : {};
  const cooldownSeconds = Number(settingsInput.cooldownSeconds);
  const settings = {
    cooldownSeconds: Number.isFinite(cooldownSeconds) ? Math.max(0, Math.min(3600, Math.round(cooldownSeconds))) : 0,
    allowConcurrentRuns: settingsInput.allowConcurrentRuns === true,
  };

  const workflow = {
    schemaVersion: WORKFLOW_SCHEMA_VERSION,
    name,
    description: asString(source.description, '').slice(0, 500),
    status,
    triggers,
    nodes,
    edges,
    variables,
    settings,
  };

  return { valid: errors.length === 0, errors, warnings, workflow };
}

/** Cycle detection over trigger+node graph (DFS with colouring). */
export function hasCycle({ triggers, nodes, edges }) {
  const adjacency = new Map();
  const add = (from, to) => {
    const list = adjacency.get(from) || [];
    list.push(to);
    adjacency.set(from, list);
  };
  edges.forEach((edge) => add(edge.from, edge.to));

  const colour = new Map();
  const visit = (id) => {
    const state = colour.get(id);
    if (state === 'grey') return true;
    if (state === 'black') return false;
    colour.set(id, 'grey');
    for (const next of adjacency.get(id) || []) {
      if (visit(next)) return true;
    }
    colour.set(id, 'black');
    return false;
  };

  for (const entity of [...triggers, ...nodes]) {
    if (visit(entity.id)) return true;
  }
  return false;
}

/** Nodes reachable from a trigger, in breadth-first execution order. */
export function executionOrder({ triggers, nodes, edges }, triggerId) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const order = [];
  const queue = [triggerId];
  const visited = new Set();
  while (queue.length > 0) {
    const current = queue.shift();
    const outgoing = edges.filter((edge) => edge.from === current);
    for (const edge of outgoing) {
      const node = byId.get(edge.to);
      if (!node) continue;
      const key = `${edge.to}:${edge.label || ''}`;
      if (visited.has(key)) continue;
      visited.add(key);
      order.push({ node, edge });
      queue.push(edge.to);
    }
  }
  return order;
}

/** Human-readable summary used by lists and the publish dialog. */
export function summarizeWorkflow(workflow) {
  const triggers = (workflow.triggers || []).map((trigger) => {
    switch (trigger.type) {
      case 'command':
        return `/${trigger.config.command}`;
      case 'keyword':
        return `keywords: ${(trigger.config.keywords || []).join(', ')}`;
      case 'callback':
        return trigger.config.matchAny ? 'any button' : `button: ${trigger.config.data}`;
      case 'schedule':
        return `every ${trigger.config.intervalMinutes}m`;
      case 'text':
        return 'any text message';
      case 'newMember':
        return 'new member';
      case 'manual':
        return 'manual test';
      default:
        return trigger.type;
    }
  });
  return {
    triggerSummary: triggers.join(' · ') || 'No trigger',
    nodeCount: (workflow.nodes || []).length,
    conditionCount: (workflow.nodes || []).filter((n) => n.type === 'condition').length,
  };
}

/** Compare the parts of a workflow that affect execution. */
export function workflowFingerprint(workflow) {
  if (!workflow) return null;
  const relevant = {
    schemaVersion: workflow.schemaVersion,
    triggers: workflow.triggers,
    nodes: workflow.nodes,
    edges: workflow.edges,
    variables: workflow.variables,
    settings: workflow.settings,
  };
  return JSON.stringify(relevant);
}

export const TRIGGER_TYPE_LIST = TRIGGER_KINDS;
export const NODE_TYPE_LIST = NODE_KINDS;
