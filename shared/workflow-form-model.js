/**
 * Projects a workflow graph into the ordered "steps" model used by Easy Mode,
 * and projects that model back into the same graph schema.
 *
 * Easy Mode only represents simple shapes: one trigger, a single path, and
 * conditions whose branches never merge. When a workflow is more complex the
 * projection reports why it is not editable instead of silently dropping data.
 */
import { NODE_DEFINITIONS, defaultConfigFor, newEntityId } from './workflow-schema.js';

const SUPPORTED_STEP_TYPES = Object.keys(NODE_DEFINITIONS);

export function canEditInForm(graph) {
  const reasons = [];
  const triggers = graph.triggers || [];
  const nodes = graph.nodes || [];
  const edges = graph.edges || [];

  if (triggers.length !== 1) {
    reasons.push(
      triggers.length === 0
        ? 'The workflow has no trigger yet. Add one in Advanced mode.'
        : `The workflow has ${triggers.length} triggers. Easy Mode edits one trigger at a time.`,
    );
  }
  if (nodes.length === 0) reasons.push('The workflow has no steps yet.');

  const incoming = new Map();
  edges.forEach((edge) => incoming.set(edge.to, (incoming.get(edge.to) || 0) + 1));
  const converged = [...incoming.entries()].filter(([, count]) => count > 1).map(([id]) => id);
  if (converged.length > 0) {
    reasons.push('Branches merge back together, which Easy Mode cannot show without losing the graph shape.');
  }

  const unsupported = nodes.filter((node) => !SUPPORTED_STEP_TYPES.includes(node.type));
  if (unsupported.length > 0) {
    reasons.push(`Unsupported step type(s): ${[...new Set(unsupported.map((n) => n.type))].join(', ')}.`);
  }

  if (triggers.length === 1) {
    const reachable = reachableFrom(triggers[0].id, edges);
    const orphans = nodes.filter((node) => !reachable.has(node.id));
    if (orphans.length > 0) {
      reasons.push(`${orphans.length} step(s) are not connected to the trigger.`);
    }
  }

  return { editable: reasons.length === 0, reasons };
}

function reachableFrom(triggerId, edges) {
  const seen = new Set();
  const queue = [triggerId];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const edge of edges.filter((e) => e.from === current)) {
      if (!seen.has(edge.to)) {
        seen.add(edge.to);
        queue.push(edge.to);
      }
    }
  }
  return seen;
}

function edgesFrom(edges, id) {
  return edges.filter((edge) => edge.from === id);
}

/**
 * Build the Easy Mode model. Throws when the graph cannot be projected, so
 * callers must check canEditInForm() first.
 */
export function buildFormModel(graph) {
  const nodesById = new Map((graph.nodes || []).map((node) => [node.id, node]));
  const edges = graph.edges || [];
  const trigger = (graph.triggers || [])[0];

  const buildStep = (node, depth = 0) => {
    const step = {
      id: node.id,
      type: node.type,
      config: structuredClone(node.config || defaultConfigFor(node.type)),
      position: node.position || { x: 60, y: 80 },
    };
    if (node.type === 'condition') {
      const nodeOutgoing = edgesFrom(edges, node.id);
      const trueEdge = nodeOutgoing.find((edge) => edge.label === 'true') || null;
      const falseEdge = nodeOutgoing.find((edge) => edge.label === 'false') || null;
      step.branches = {
        true: trueEdge ? stepsFromNode(trueEdge.to, depth + 1) : [],
        false: falseEdge ? stepsFromNode(falseEdge.to, depth + 1) : [],
      };
    }
    return step;
  };

  /** Steps starting at a node (inclusive) and following the single path. */
  const stepsFromNode = (nodeId, depth = 0) => {
    if (depth > 60) return [];
    const node = nodesById.get(nodeId);
    if (!node) return [];
    const step = buildStep(node, depth);
    if (node.type === 'condition') return [step];
    return [step, ...walk(node.id, depth + 1)];
  };

  /** Steps after the given id (exclusive), following the first outgoing edge. */
  const walk = (fromId, depth = 0) => {
    if (depth > 60) return [];
    const outgoing = edgesFrom(edges, fromId);
    if (outgoing.length === 0) return [];
    return stepsFromNode(outgoing[0].to, depth);
  };

  return {
    trigger: trigger ? { id: trigger.id, type: trigger.type, config: structuredClone(trigger.config) } : null,
    steps: trigger ? walk(trigger.id) : [],
    settings: structuredClone(graph.settings || { cooldownSeconds: 0, allowConcurrentRuns: false }),
    variables: structuredClone(graph.variables || {}),
    name: graph.name,
    description: graph.description || '',
  };
}

/**
 * Project the Easy Mode model back into a graph document. Existing ids are
 * preserved so links and history stay stable.
 */
export function applyFormModel(model, baseGraph = {}) {
  const triggers = model.trigger
    ? [{ id: model.trigger.id || newEntityId('trg'), type: model.trigger.type, config: { ...model.trigger.config } }]
    : [];
  const nodes = [];
  const edges = [];
  const triggerId = triggers[0]?.id;

  const layout = { x: 60, y: 100 };
  const pushStep = (step, fromId, label = null, depth = 0) => {
    const id = step.id || newEntityId('nd');
    const config = { ...defaultConfigFor(step.type), ...structuredClone(step.config || {}) };
    layout.y += 120;
    nodes.push({
      id,
      type: step.type,
      config,
      position: step.position || { x: 60 + depth * 220, y: layout.y },
    });
    edges.push({ id: newEntityId('edg'), from: fromId, to: id, ...(label ? { label } : {}) });

    if (step.type === 'condition') {
      const trueSteps = step.branches?.true || [];
      const falseSteps = step.branches?.false || [];
      let trueFrom = id;
      let falseFrom = id;
      trueSteps.forEach((child, index) => {
        pushStep(child, trueFrom, index === 0 ? 'true' : null, depth + 1);
        trueFrom = child.id || nodes[nodes.length - 1].id;
      });
      falseSteps.forEach((child, index) => {
        pushStep(child, falseFrom, index === 0 ? 'false' : null, depth + 1);
        falseFrom = child.id || nodes[nodes.length - 1].id;
      });
    }
    return id;
  };

  if (triggerId) {
    let fromId = triggerId;
    (model.steps || []).forEach((step, index) => {
      const generatedId = pushStep(step, fromId, index === 0 ? null : null, 0);
      fromId = step.id || generatedId;
    });
  }

  return {
    schemaVersion: baseGraph.schemaVersion || 1,
    name: model.name || baseGraph.name || 'Untitled workflow',
    description: model.description ?? baseGraph.description ?? '',
    status: baseGraph.status || 'draft',
    triggers,
    nodes,
    edges,
    variables: model.variables || baseGraph.variables || {},
    settings: model.settings || baseGraph.settings || { cooldownSeconds: 0, allowConcurrentRuns: false },
  };
}

/** Create a blank step of a given type for the form editor. */
export function createFormStep(type, config = {}) {
  const step = { id: newEntityId('nd'), type, config: { ...defaultConfigFor(type), ...config } };
  if (type === 'condition') step.branches = { true: [], false: [] };
  return step;
}

export { SUPPORTED_STEP_TYPES };
