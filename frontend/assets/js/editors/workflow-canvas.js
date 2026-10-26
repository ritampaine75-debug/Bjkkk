/**
 * Canvas-based node editor used by Advanced Mode.
 *
 * Supports pointer drag (desktop), click-to-connect (desktop and mobile),
 * zoom, pan, edge selection, node search highlighting and auto layout.
 * All mutations are reported through onChange() with a new graph object; the
 * canvas never mutates the graph it was given.
 */
import { escapeHtml } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { NODE_DEFINITIONS, TRIGGER_DEFINITIONS, createNode as buildNode } from '../../../../shared/workflow-schema.js';

const NODE_WIDTH = 220;
const NODE_HEIGHT_BASE = 74;

const NODE_ICONS = {
  sendMessage: 'message',
  sendPhoto: 'upload',
  sendDocument: 'upload',
  sendMedia: 'upload',
  sendKeyboard: 'keyboard',
  editMessage: 'edit',
  answerCallback: 'checkCircle',
  setVariable: 'code',
  delay: 'clock',
  httpRequest: 'globe',
  logEvent: 'logs',
  end: 'xCircle',
  condition: 'branch',
};

const TRIGGER_ICONS = {
  command: 'terminal',
  text: 'message',
  callback: 'keyboard',
  newMember: 'users',
  keyword: 'search',
  schedule: 'calendar',
  manual: 'play',
};

export function createWorkflowCanvas({ container, graph, onChange, onSelect, onToast }) {
  const state = {
    graph: structuredClone(graph),
    selected: null, // { kind: 'node'|'trigger'|'edge', id }
    zoom: 1,
    pan: { x: 0, y: 0 },
    connect: null, // { fromId, fromKind, label }
    search: '',
    dragging: null,
    panning: null,
  };

  container.innerHTML = `
    <div class="wf-canvas" tabindex="0" role="application" aria-label="Workflow canvas">
      <svg class="wf-canvas__edges" aria-hidden="true">
        <defs>
          <marker id="wf-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
          </marker>
        </defs>
        <g class="wf-canvas__edge-layer"></g>
      </svg>
      <div class="wf-canvas__world">
        <div class="wf-canvas__nodes"></div>
      </div>
      <div class="wf-canvas__hint" aria-live="polite"></div>
    </div>`;

  const canvas = container.querySelector('.wf-canvas');
  const world = container.querySelector('.wf-canvas__world');
  const nodesLayer = container.querySelector('.wf-canvas__nodes');
  const edgeLayer = container.querySelector('.wf-canvas__edge-layer');
  const hint = container.querySelector('.wf-canvas__hint');

  /* ---------------------------------------------------------------- render */
  function render() {
    const { triggers, nodes, edges } = state.graph;
    const height = Math.max(560, ...nodes.map((n) => (n.position?.y || 0) + 160), ...triggers.map((t) => (t.position?.y || 0) + 160));

    world.style.transform = `translate(${state.pan.x}px, ${state.pan.y}px) scale(${state.zoom})`;
    world.style.height = `${height}px`;

    nodesLayer.innerHTML = [
      ...triggers.map((trigger, index) => renderTrigger(trigger, index)),
      ...nodes.map((node, index) => renderNode(node, index)),
    ].join('');

    edgeLayer.innerHTML = edges.map(renderEdge).join('');
    updateHint();
    applySearchHighlight();
  }

  function positionOf(id) {
    const node = state.graph.nodes.find((n) => n.id === id);
    if (node) return node.position || { x: 60, y: 80 };
    const trigger = state.graph.triggers.find((t) => t.id === id);
    if (trigger) return trigger.position || { x: 60, y: 20 };
    return null;
  }

  function renderTrigger(trigger, index) {
    const position = trigger.position || { x: 60, y: 20 + index * 150 };
    const selected = state.selected?.kind === 'trigger' && state.selected.id === trigger.id;
    const definition = TRIGGER_DEFINITIONS[trigger.type] || { label: trigger.type };
    return `<div class="wf-node wf-node--trigger${selected ? ' is-selected' : ''}" data-node-id="${escapeHtml(trigger.id)}"
        data-node-kind="trigger" style="left:${position.x}px;top:${position.y}px">
      <div class="wf-node__header">
        <span class="wf-node__icon">${icon(TRIGGER_ICONS[trigger.type] || 'zap', { size: 14 })}</span>
        <span class="wf-node__title">${escapeHtml(definition.label)}</span>
      </div>
      <div class="wf-node__body">${escapeHtml(triggerSummary(trigger))}</div>
      <span class="wf-port wf-port--out" data-port-from="${escapeHtml(trigger.id)}" data-port-kind="trigger"
        title="Connect this trigger" aria-label="Connect trigger"></span>
    </div>`;
  }

  function renderNode(node, index) {
    const definition = NODE_DEFINITIONS[node.type] || { label: node.type, outputs: 1 };
    const position = node.position || { x: 60 + (index % 3) * 260, y: 100 + Math.floor(index / 3) * 150 };
    const selected = state.selected?.kind === 'node' && state.selected.id === node.id;
    const ports = [];
    if (definition.outputs === 2) {
      ports.push(`<span class="wf-port wf-port--out wf-port--true" data-port-from="${escapeHtml(node.id)}" data-port-kind="node"
        data-port-label="true" title="True branch"></span>`);
      ports.push(`<span class="wf-port wf-port--out wf-port--false" data-port-from="${escapeHtml(node.id)}" data-port-kind="node"
        data-port-label="false" title="False branch"></span>`);
    } else if (definition.outputs === 1) {
      ports.push(`<span class="wf-port wf-port--out" data-port-from="${escapeHtml(node.id)}" data-port-kind="node"
        title="Connect this node" aria-label="Connect node"></span>`);
    }
    return `<div class="wf-node wf-node--${definition.kind}${selected ? ' is-selected' : ''}" data-node-id="${escapeHtml(node.id)}"
        data-node-kind="node" style="left:${position.x}px;top:${position.y}px">
      <div class="wf-node__header">
        <span class="wf-node__icon">${icon(NODE_ICONS[node.type] || 'zap', { size: 14 })}</span>
        <span class="wf-node__title">${escapeHtml(definition.label)}</span>
      </div>
      <div class="wf-node__body">${escapeHtml(nodeSummary(node))}</div>
      ${ports.join('')}
    </div>`;
  }

  function renderEdge(edge) {
    const from = positionOf(edge.from);
    const to = positionOf(edge.to);
    if (!from || !to) return '';
    const x1 = from.x + NODE_WIDTH / 2;
    const y1 = from.y + NODE_HEIGHT_BASE;
    const x2 = to.x + NODE_WIDTH / 2;
    const y2 = to.y;
    const midY = (y1 + y2) / 2;
    const path = `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
    const selected = state.selected?.kind === 'edge' && state.selected.id === edge.id;
    const colour = edge.label === 'false' ? 'var(--danger)' : edge.label === 'true' ? 'var(--success)' : 'var(--border-strong)';
    return `<g class="wf-edge${selected ? ' is-selected' : ''}" data-edge-id="${escapeHtml(edge.id)}" style="color:${colour}">
      <path d="${path}" class="wf-edge__path" marker-end="url(#wf-arrow)"></path>
      <path d="${path}" class="wf-edge__hit" ></path>
      ${edge.label ? `<text x="${(x1 + x2) / 2 + 6}" y="${midY}" class="wf-edge__label">${escapeHtml(edge.label)}</text>` : ''}
    </g>`;
  }

  function nodeSummary(node) {
    const config = node.config || {};
    switch (node.type) {
      case 'sendMessage':
      case 'editMessage':
        return truncate(config.text, 90);
      case 'sendKeyboard':
        return `${truncate(config.text, 60)} · ${(config.keyboard?.rows || []).flat().length} buttons`;
      case 'sendPhoto':
        return truncate(config.photo, 80);
      case 'sendDocument':
        return truncate(config.document, 80);
      case 'sendMedia':
        return `${config.mediaType}: ${truncate(config.file, 60)}`;
      case 'answerCallback':
        return truncate(config.text || 'Answer silently', 80);
      case 'setVariable':
        return `${config.name} = ${truncate(config.value, 40)}`;
      case 'delay':
        return `${(Number(config.ms) || 0) / 1000}s delay`;
      case 'httpRequest':
        return `${config.method} ${truncate(config.url, 60)}`;
      case 'logEvent':
        return truncate(config.message, 80);
      case 'end':
        return truncate(config.reason, 60);
      case 'condition':
        return `${config.subject} ${config.operator} ${truncate(config.value, 30)}`;
      default:
        return node.type;
    }
  }

  function triggerSummary(trigger) {
    const config = trigger.config || {};
    switch (trigger.type) {
      case 'command':
        return `/${config.command}`;
      case 'keyword':
        return (config.keywords || []).join(', ');
      case 'callback':
        return config.matchAny ? 'Any button' : config.data;
      case 'schedule':
        return `Every ${config.intervalMinutes} min (${config.timezone || 'UTC'})`;
      case 'text':
        return 'Any text message';
      case 'newMember':
        return 'New group member';
      case 'manual':
        return 'Manual / simulator only';
      default:
        return '';
    }
  }

  function truncate(text, max) {
    const value = String(text || '');
    return value.length > max ? `${value.slice(0, max)}…` : value || '(empty)';
  }

  function updateHint() {
    if (state.connect) {
      hint.textContent = state.connect.label
        ? `Connecting the ${state.connect.label} branch — tap the destination node.`
        : 'Connecting — tap the destination node. Press Escape to cancel.';
      hint.classList.add('is-active');
      canvas.classList.add('is-connecting');
    } else {
      hint.textContent = '';
      hint.classList.remove('is-active');
      canvas.classList.remove('is-connecting');
    }
  }

  function applySearchHighlight() {
    const query = state.search.trim().toLowerCase();
    nodesLayer.querySelectorAll('.wf-node').forEach((el) => {
      const text = el.textContent.toLowerCase();
      el.classList.toggle('is-dimmed', Boolean(query) && !text.includes(query));
    });
  }

  /* ------------------------------------------------------------ mutations */
  function commit(nextGraph) {
    state.graph = nextGraph;
    render();
    onChange?.(structuredClone(state.graph));
  }

  function addNode(type, position = null) {
    const placed = position || nextPosition();
    const node = buildNode(type, {}, placed);
    const graph = structuredClone(state.graph);
    graph.nodes.push(node);
    // Auto-connect when a single unconnected output slot is free.
    const dangling = findDanglingSource(graph);
    if (dangling) {
      graph.edges.push({ id: `edg_${Math.random().toString(36).slice(2, 10)}`, from: dangling.from, to: node.id, ...(dangling.label ? { label: dangling.label } : {}) });
    }
    state.selected = { kind: 'node', id: node.id };
    commit(graph);
    onSelect?.({ kind: 'node', id: node.id });
  }

  function nextPosition() {
    const nodes = state.graph.nodes;
    if (nodes.length === 0) return { x: 340, y: 90 };
    const lowest = nodes.reduce((acc, node) => (node.position.y > acc.position.y ? node : acc), nodes[0]);
    return { x: lowest.position.x, y: lowest.position.y + 150 };
  }

  function findDanglingSource(graph) {
    const nodeOutputs = new Map(graph.nodes.map((n) => [n.id, NODE_DEFINITIONS[n.type]?.outputs ?? 1]));
    const used = new Map();
    graph.edges.forEach((edge) => {
      const key = `${edge.from}:${edge.label || ''}`;
      used.set(key, (used.get(key) || 0) + 1);
    });
    for (const trigger of graph.triggers) {
      if (!graph.edges.some((edge) => edge.from === trigger.id)) return { from: trigger.id };
    }
    for (const node of graph.nodes) {
      const outputs = nodeOutputs.get(node.id);
      if (outputs === 2) {
        for (const label of ['true', 'false']) {
          if (!graph.edges.some((edge) => edge.from === node.id && edge.label === label)) {
            return { from: node.id, label };
          }
        }
      } else if (outputs === 1 && !graph.edges.some((edge) => edge.from === node.id)) {
        return { from: node.id };
      }
    }
    return null;
  }

  function connect(fromId, fromKind, label, toId) {
    if (fromId === toId) return;
    const graph = structuredClone(state.graph);
    const definition = fromKind === 'trigger' ? { outputs: 1 } : NODE_DEFINITIONS[graph.nodes.find((n) => n.id === fromId)?.type];
    const outputs = definition?.outputs ?? 1;
    if (outputs === 0) {
      onToast?.('This node cannot have an outgoing connection.', 'error');
      return;
    }
    // Replace an existing outgoing edge from the same slot.
    const existingIndex = graph.edges.findIndex(
      (edge) => edge.from === fromId && (outputs === 2 ? edge.label === label : true),
    );
    if (existingIndex >= 0) {
      graph.edges.splice(existingIndex, 1);
    }
    if (outputs === 1 && fromKind === 'trigger' && graph.edges.some((edge) => edge.from === fromId)) {
      onToast?.('A trigger can only start one branch.', 'error');
      return;
    }
    graph.edges.push({
      id: `edg_${Math.random().toString(36).slice(2, 10)}`,
      from: fromId,
      to: toId,
      ...(label ? { label } : {}),
    });
    state.connect = null;
    commit(graph);
  }

  function deleteSelection() {
    const selection = state.selected;
    if (!selection) return;
    const graph = structuredClone(state.graph);
    if (selection.kind === 'node') {
      graph.nodes = graph.nodes.filter((n) => n.id !== selection.id);
      graph.edges = graph.edges.filter((e) => e.from !== selection.id && e.to !== selection.id);
    } else if (selection.kind === 'edge') {
      graph.edges = graph.edges.filter((e) => e.id !== selection.id);
    } else if (selection.kind === 'trigger') {
      if (graph.triggers.length <= 1) {
        onToast?.('A workflow needs at least one trigger.', 'error');
        return;
      }
      graph.triggers = graph.triggers.filter((t) => t.id !== selection.id);
      graph.edges = graph.edges.filter((e) => e.from !== selection.id);
    }
    state.selected = null;
    commit(graph);
    onSelect?.(null);
  }

  function duplicateSelection() {
    if (state.selected?.kind !== 'node') return;
    const node = state.graph.nodes.find((n) => n.id === state.selected.id);
    if (!node) return;
    const graph = structuredClone(state.graph);
    const copy = {
      ...structuredClone(node),
      id: `nd_${Math.random().toString(36).slice(2, 10)}`,
      position: { x: node.position.x + 40, y: node.position.y + 40 },
    };
    graph.nodes.push(copy);
    state.selected = { kind: 'node', id: copy.id };
    commit(graph);
  }

  /** Simple layered auto-layout based on graph depth from the triggers. */
  function autoLayout() {
    const graph = structuredClone(state.graph);
    const depths = new Map();
    const queue = graph.triggers.map((trigger) => ({ id: trigger.id, depth: 0 }));
    while (queue.length > 0) {
      const { id, depth } = queue.shift();
      if (depths.has(id) && depths.get(id) <= depth) continue;
      depths.set(id, depth);
      for (const edge of graph.edges.filter((e) => e.from === id)) {
        queue.push({ id: edge.to, depth: depth + 1 });
      }
    }
    const perDepth = new Map();
    graph.triggers.forEach((trigger, index) => {
      trigger.position = { x: 40, y: 20 + index * 130 };
    });
    graph.nodes.forEach((node) => {
      const depth = depths.get(node.id) ?? 1;
      const count = perDepth.get(depth) || 0;
      perDepth.set(depth, count + 1);
      node.position = { x: 40 + depth * 290, y: 20 + count * 140 };
    });
    commit(graph);
  }

  function zoomBy(factor) {
    state.zoom = Math.min(1.8, Math.max(0.35, Number((state.zoom * factor).toFixed(2))));
    world.style.transform = `translate(${state.pan.x}px, ${state.pan.y}px) scale(${state.zoom})`;
    return state.zoom;
  }

  function resetView() {
    state.zoom = 1;
    state.pan = { x: 0, y: 0 };
    world.style.transform = 'translate(0px, 0px) scale(1)';
  }

  /* --------------------------------------------------------- interactions */
  canvas.addEventListener('pointerdown', (event) => {
    const port = event.target.closest('[data-port-from]');
    if (port) {
      event.preventDefault();
      state.connect = {
        fromId: port.dataset.portFrom,
        fromKind: port.dataset.portKind,
        label: port.dataset.portLabel || null,
      };
      updateHint();
      return;
    }

    const nodeEl = event.target.closest('[data-node-id]');
    if (nodeEl) {
      const kind = nodeEl.dataset.nodeKind;
      const id = nodeEl.dataset.nodeId;
      if (state.connect) {
        connect(state.connect.fromId, state.connect.fromKind, state.connect.label, id);
        onSelect?.(null);
        return;
      }
      state.selected = { kind, id };
      render();
      onSelect?.({ kind, id });
      if (event.pointerType === 'mouse') startDrag(event, nodeEl, id, kind);
      return;
    }

    const edgeEl = event.target.closest('[data-edge-id]');
    if (edgeEl) {
      state.selected = { kind: 'edge', id: edgeEl.dataset.edgeId };
      render();
      onSelect?.({ kind: 'edge', id: edgeEl.dataset.edgeId });
      return;
    }

    // Background: pan the canvas and clear the selection.
    state.panning = { startX: event.clientX, startY: event.clientY, panX: state.pan.x, panY: state.pan.y };
    if (state.selected) {
      state.selected = null;
      render();
      onSelect?.(null);
    }
    canvas.setPointerCapture?.(event.pointerId);
  });

  canvas.addEventListener('pointermove', (event) => {
    if (state.dragging) {
      const dx = (event.clientX - state.dragging.startX) / state.zoom;
      const dy = (event.clientY - state.dragging.startY) / state.zoom;
      const el = nodesLayer.querySelector(`[data-node-id="${state.dragging.id}"]`);
      if (el) {
        el.style.left = `${Math.max(0, state.dragging.x + dx)}px`;
        el.style.top = `${Math.max(0, state.dragging.y + dy)}px`;
      }
      return;
    }
    if (state.panning) {
      state.pan = {
        x: state.panning.panX + (event.clientX - state.panning.startX),
        y: state.panning.panY + (event.clientY - state.panning.startY),
      };
      world.style.transform = `translate(${state.pan.x}px, ${state.pan.y}px) scale(${state.zoom})`;
    }
  });

  canvas.addEventListener('pointerup', (event) => {
    if (state.dragging) {
      const dx = (event.clientX - state.dragging.startX) / state.zoom;
      const dy = (event.clientY - state.dragging.startY) / state.zoom;
      const graph = structuredClone(state.graph);
      const target =
        state.dragging.kind === 'trigger'
          ? graph.triggers.find((t) => t.id === state.dragging.id)
          : graph.nodes.find((n) => n.id === state.dragging.id);
      if (target) {
        target.position = {
          x: Math.round(Math.max(0, state.dragging.x + dx)),
          y: Math.round(Math.max(0, state.dragging.y + dy)),
        };
      }
      state.dragging = null;
      commit(graph);
    }
    state.panning = null;
    if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  });

  canvas.addEventListener('pointercancel', () => {
    state.dragging = null;
    state.panning = null;
  });

  canvas.addEventListener('click', (event) => {
    const edgeEl = event.target.closest('[data-edge-id]');
    if (edgeEl) onSelect?.({ kind: 'edge', id: edgeEl.dataset.edgeId });
  });

  canvas.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      zoomBy(event.deltaY < 0 ? 1.08 : 0.92);
    },
    { passive: false },
  );

  function startDrag(event, element, id, kind) {
    const position =
      kind === 'trigger'
        ? state.graph.triggers.find((t) => t.id === id)?.position || { x: 0, y: 0 }
        : state.graph.nodes.find((n) => n.id === id)?.position || { x: 0, y: 0 };
    state.dragging = { id, kind, startX: event.clientX, startY: event.clientY, x: position.x, y: position.y };
    element.classList.add('is-dragging');
    canvas.setPointerCapture?.(event.pointerId);
  }

  render();
  return {
    getGraph: () => structuredClone(state.graph),
    setGraph(next) {
      state.graph = structuredClone(next);
      state.selected = null;
      render();
    },
    addNode,
    deleteSelection,
    duplicateSelection,
    autoLayout,
    zoomIn: () => zoomBy(1.15),
    zoomOut: () => zoomBy(0.87),
    resetView,
    getZoom: () => state.zoom,
    setSearch(query) {
      state.search = query;
      applySearchHighlight();
    },
    selectNode(id) {
      state.selected = id ? { kind: 'node', id } : null;
      render();
    },
    beginConnect(fromId, fromKind = 'node', label = null) {
      state.connect = { fromId, fromKind, label };
      updateHint();
    },
    cancelConnect() {
      state.connect = null;
      updateHint();
    },
    focusNode(id) {
      const position = positionOf(id);
      if (!position) return;
      state.pan = { x: -position.x + 80, y: -position.y + 60 };
      world.style.transform = `translate(${state.pan.x}px, ${state.pan.y}px) scale(${state.zoom})`;
    },
    destroy() {
      container.innerHTML = '';
    },
  };
}
