/**
 * Advanced Mode: visual workflow builder.
 *
 * Composes the canvas (nodes/edges) with a toolbar and an inspector. Every
 * change flows through the same onChange(graph) contract used by Easy Mode, so
 * both editors always write the identical schema.
 */
import { escapeHtml } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { createWorkflowCanvas } from './workflow-canvas.js';
import { stepFields, bindStepFields, readStepFields, STEP_CHOICES } from './form-editor.js';
import { NODE_DEFINITIONS, TRIGGER_DEFINITIONS, defaultConfigFor } from '../../../../shared/workflow-schema.js';

export function createVisualEditor({ container, graph, onChange, onSelect, onToast }) {
  container.innerHTML = `
    <div class="stack">
      <div class="wf-toolbar" role="toolbar" aria-label="Canvas toolbar">
        <div class="wf-toolbar__group">
          <div class="select-wrap">
            <select class="select" id="wf-node-type" aria-label="Node type to add" style="min-height:32px;font-size:var(--fs-sm);padding:0 var(--space-6) 0 var(--space-2);width:auto">
              ${STEP_CHOICES.map((choice) => `<option value="${choice.type}">${escapeHtml(choice.label)}</option>`).join('')}
            </select>
          </div>
          <button class="btn btn--primary btn--sm" type="button" id="wf-add-node">${icon('plus')} Add node</button>
        </div>
        <div class="wf-toolbar__sep"></div>
        <div class="wf-toolbar__group">
          <button class="btn btn--ghost btn--sm btn--icon" type="button" data-wf-zoom="out" aria-label="Zoom out">${icon('zoomOut')}</button>
          <button class="btn btn--ghost btn--sm" type="button" data-wf-zoom="reset" aria-label="Reset view">100%</button>
          <button class="btn btn--ghost btn--sm btn--icon" type="button" data-wf-zoom="in" aria-label="Zoom in">${icon('zoomIn')}</button>
        </div>
        <div class="wf-toolbar__sep"></div>
        <div class="wf-toolbar__group">
          <button class="btn btn--ghost btn--sm" type="button" id="wf-autolayout">${icon('grid')} Auto layout</button>
          <button class="btn btn--ghost btn--sm btn--icon" type="button" id="wf-duplicate" aria-label="Duplicate selected node" disabled>${icon('copy')}</button>
          <button class="btn btn--ghost btn--sm btn--icon" type="button" id="wf-delete" aria-label="Delete selection" disabled>${icon('trash')}</button>
        </div>
        <div class="wf-toolbar__sep"></div>
        <input class="input" type="search" id="wf-search" placeholder="Find a node…" aria-label="Search nodes" />
        <button class="btn btn--ghost btn--sm" type="button" id="wf-toggle-list" aria-pressed="false">${icon('list')} Node list</button>
      </div>

      <div class="wf-layout">
        <div>
          <div id="wf-canvas-host"></div>
          <div id="wf-nodelist" class="card" hidden>
            <div class="card__header"><h2 class="card__title">Nodes</h2></div>
            <div class="card__body wf-nodelist" id="wf-nodelist-body"></div>
          </div>
        </div>
        <aside class="wf-inspector" id="wf-inspector">
          <div class="card__header">
            <div>
              <h2 class="card__title">${icon('settings')} Inspector</h2>
              <p class="card__subtitle">Select a node on the canvas</p>
            </div>
          </div>
          <div class="wf-inspector__body" id="wf-inspector-body">
            <div class="empty" style="padding:var(--space-6) var(--space-3)">
              <div class="empty__icon">${icon('canvas')}</div>
              <p class="small secondary" style="margin:0">Select a node or connection to edit it. Use the round port under a node to connect it to another node.</p>
            </div>
          </div>
        </aside>
      </div>
    </div>`;

  const canvasHost = container.querySelector('#wf-canvas-host');
  const inspectorBody = container.querySelector('#wf-inspector-body');
  const nodeListBody = container.querySelector('#wf-nodelist-body');
  const nodeList = container.querySelector('#wf-nodelist');
  const deleteButton = container.querySelector('#wf-delete');
  const duplicateButton = container.querySelector('#wf-duplicate');

  const pendingGraph = structuredClone(graph);
  let selection = null;

  const canvas = createWorkflowCanvas({
    container: canvasHost,
    graph: pendingGraph,
    onToast,
    onChange(nextGraph) {
      Object.assign(pendingGraph, nextGraph);
      onChange?.(structuredClone(pendingGraph));
      renderNodeList();
    },
    onSelect(nextSelection) {
      selection = nextSelection;
      updateToolbarState();
      renderInspector();
      onSelect?.(nextSelection);
      if (nextSelection?.kind === 'node') renderNodeList(nextSelection.id);
    },
  });

  const zoomLabel = container.querySelector('[data-wf-zoom="reset"]');

  container.querySelector('#wf-add-node').addEventListener('click', () => {
    const type = container.querySelector('#wf-node-type').value;
    if (type === 'condition') {
      // Conditions need both branches, so add the two End nodes for the user.
      canvas.addNode(type);
      onToast?.('Condition added. Connect the true and false branches to their next steps.', 'info');
      return;
    }
    canvas.addNode(type);
  });

  container.querySelectorAll('[data-wf-zoom]').forEach((button) =>
    button.addEventListener('click', () => {
      const action = button.dataset.wfZoom;
      if (action === 'in') canvas.zoomIn();
      else if (action === 'out') canvas.zoomOut();
      else canvas.resetView();
      zoomLabel.textContent = `${Math.round(canvas.getZoom() * 100)}%`;
    }),
  );

  container.querySelector('#wf-autolayout').addEventListener('click', () => {
    canvas.autoLayout();
    onToast?.('Applied an automatic layout.', 'success');
  });
  container.querySelector('#wf-delete').addEventListener('click', () => {
    canvas.deleteSelection();
    selection = null;
    updateToolbarState();
    renderInspector();
  });
  container.querySelector('#wf-duplicate').addEventListener('click', () => canvas.duplicateSelection());
  container.querySelector('#wf-search').addEventListener('input', (event) => canvas.setSearch(event.target.value));
  container.querySelector('#wf-toggle-list').addEventListener('click', (event) => {
    const pressed = event.currentTarget.getAttribute('aria-pressed') === 'true';
    event.currentTarget.setAttribute('aria-pressed', String(!pressed));
    nodeList.hidden = pressed;
    renderNodeList();
  });

  updateToolbarState();
  renderNodeList();

  function updateToolbarState() {
    const isNode = selection?.kind === 'node';
    deleteButton.disabled = !selection;
    duplicateButton.disabled = !isNode;
  }

  function renderNodeList(selectedId = selection?.id) {
    if (nodeList.hidden) return;
    const graphNow = canvas.getGraph();
    nodeListBody.innerHTML = [
      ...graphNow.triggers.map(
        (trigger) => `<button class="wf-nodelist__item${selectedId === trigger.id ? ' is-selected' : ''}" type="button" data-list-node="${escapeHtml(trigger.id)}">
          <span class="wf-node__icon">${icon('zap', { size: 14 })}</span>
          <span class="truncate small">${escapeHtml(TRIGGER_DEFINITIONS[trigger.type]?.label || trigger.type)}</span>
        </button>`,
      ),
      ...graphNow.nodes.map(
        (node) => `<button class="wf-nodelist__item${selectedId === node.id ? ' is-selected' : ''}" type="button" data-list-node="${escapeHtml(node.id)}">
          <span class="wf-node__icon">${icon('workflow', { size: 14 })}</span>
          <span class="truncate small">${escapeHtml(NODE_DEFINITIONS[node.type]?.label || node.type)}</span>
        </button>`,
      ),
    ].join('');

    nodeListBody.querySelectorAll('[data-list-node]').forEach((button) =>
      button.addEventListener('click', () => {
        const id = button.dataset.listNode;
        const kind = canvas.getGraph().triggers.some((t) => t.id === id) ? 'trigger' : 'node';
        selection = { kind, id };
        canvas.selectNode(kind === 'node' ? id : null);
        if (kind === 'trigger') {
          // Triggers are selected through the inspector without a canvas API for it.
          selection = { kind: 'trigger', id };
        }
        canvas.focusNode(id);
        renderInspector();
        renderNodeList(id);
        updateToolbarState();
      }),
    );
  }

  function renderInspector() {
    const graphNow = canvas.getGraph();
    if (!selection) {
      inspectorBody.innerHTML = `<div class="empty" style="padding:var(--space-6) var(--space-3)">
        <div class="empty__icon">${icon('canvas')}</div>
        <p class="small secondary" style="margin:0">Select a node or connection to edit it.</p>
      </div>`;
      container.querySelector('.card__subtitle')?.replaceChildren(document.createTextNode('Select a node on the canvas'));
      return;
    }

    if (selection.kind === 'edge') {
      const edge = graphNow.edges.find((item) => item.id === selection.id);
      if (!edge) return;
      inspectorBody.innerHTML = `
        <div class="card__body stack-sm">
          <div class="small secondary">Connection${edge.label ? ` (${escapeHtml(edge.label)} branch)` : ''}</div>
          <code class="mono">${escapeHtml(edge.from)} → ${escapeHtml(edge.to)}</code>
          <button class="btn btn--danger-ghost btn--sm" type="button" id="inspector-delete-edge">${icon('trash')} Delete connection</button>
        </div>`;
      container.querySelector('#inspector-delete-edge').addEventListener('click', () => {
        canvas.deleteSelection();
        selection = null;
        renderInspector();
        updateToolbarState();
      });
      return;
    }

    if (selection.kind === 'trigger') {
      const trigger = graphNow.triggers.find((item) => item.id === selection.id);
      if (!trigger) return;
      inspectorBody.innerHTML = `
        <div class="card__body stack-sm">
          <div class="field" style="margin:0">
            <label class="field__label" for="inspector-trigger-type">Trigger type</label>
            <div class="select-wrap">
              <select class="select" id="inspector-trigger-type">
                ${Object.entries(TRIGGER_DEFINITIONS)
                  .map(([type, def]) => `<option value="${type}" ${trigger.type === type ? 'selected' : ''}>${escapeHtml(def.label)}</option>`)
                  .join('')}
              </select>
            </div>
          </div>
          <div id="inspector-trigger-config">${triggerConfigFields(trigger)}</div>
          <button class="btn btn--primary btn--sm" type="button" id="inspector-apply-trigger">${icon('save')} Apply trigger</button>
        </div>`;

      container.querySelector('#inspector-trigger-type').addEventListener('change', (event) => {
        const nextType = event.target.value;
        container.querySelector('#inspector-trigger-config').innerHTML = triggerConfigFields({
          type: nextType,
          config: nextType === 'command' ? { command: 'start' } : {},
        });
      });
      container.querySelector('#inspector-apply-trigger').addEventListener('click', () => {
        const nextGraph = canvas.getGraph();
        const target = nextGraph.triggers.find((item) => item.id === selection.id);
        if (!target) return;
        target.type = container.querySelector('#inspector-trigger-type').value;
        target.config = readTriggerConfig(container.querySelector('#inspector-trigger-config'), target.type);
        canvas.setGraph(nextGraph);
        onChange?.(canvas.getGraph());
        renderNodeList();
        onToast?.('Trigger updated.', 'success');
      });
      return;
    }

    const node = graphNow.nodes.find((item) => item.id === selection.id);
    if (!node) return;
    let draft = structuredClone(node);
    let keyboardRows = structuredClone(draft.config?.keyboard?.rows || []);

    const drawNodeInspector = () => {
      inspectorBody.innerHTML = `
        <div class="card__body stack-sm">
          <div class="row-between">
            <strong class="small">${escapeHtml(NODE_DEFINITIONS[draft.type]?.label || draft.type)}</strong>
            <span class="tiny muted">${(NODE_DEFINITIONS[draft.type]?.outputs ?? 1)} output${(NODE_DEFINITIONS[draft.type]?.outputs ?? 1) === 1 ? '' : 's'}</span>
          </div>
          <div class="field" style="margin:0">
            <label class="field__label" for="inspector-node-type">Node type</label>
            <div class="select-wrap">
              <select class="select" id="inspector-node-type">
                ${STEP_CHOICES.map(
                  (choice) => `<option value="${choice.type}" ${draft.type === choice.type ? 'selected' : ''}>${escapeHtml(choice.label)}</option>`,
                ).join('')}
              </select>
            </div>
          </div>
          <div id="inspector-node-fields">${stepFields(draft, keyboardRows)}</div>
          <div class="row">
            <button class="btn btn--primary btn--sm" type="button" id="inspector-apply-node">${icon('save')} Apply changes</button>
            <button class="btn btn--secondary btn--sm" type="button" id="inspector-connect-node">${icon('link')} Connect</button>
          </div>
        </div>`;

      container.querySelector('#inspector-node-type').addEventListener('change', (event) => {
        draft = { ...draft, type: event.target.value, config: defaultConfigFor(event.target.value) };
        keyboardRows = structuredClone(draft.config?.keyboard?.rows || []);
        drawNodeInspector();
      });
      bindStepFields(inspectorBody, draft, keyboardRows, drawNodeInspector);
      container.querySelector('#inspector-apply-node').addEventListener('click', () => {
        const nextGraph = canvas.getGraph();
        const target = nextGraph.nodes.find((item) => item.id === node.id);
        if (!target) return;
        target.type = draft.type;
        target.config = readStepFields(inspectorBody, draft, keyboardRows);
        canvas.setGraph(nextGraph);
        onChange?.(canvas.getGraph());
        selection = { kind: 'node', id: node.id };
        renderNodeList();
        onToast?.('Node updated.', 'success');
      });
      container.querySelector('#inspector-connect-node').addEventListener('click', () => {
        // Keyboard/click alternative to dragging from the port.
        inspectorBody.insertAdjacentHTML(
          'afterbegin',
          `<div class="alert alert--info small" style="margin-bottom:var(--space-2)">
            ${icon('info')}
            <div class="alert__body"><div class="alert__text">Select the destination node on the canvas. Press Escape to cancel.</div></div>
          </div>`,
        );
        canvas.beginConnect(node.id, 'node');
      });
    };
    drawNodeInspector();
  }

  function triggerConfigFields(trigger) {
    const config = trigger.config || {};
    switch (trigger.type) {
      case 'command':
        return `<div class="field" style="margin:0">
          <label class="field__label" for="trg-command">Command</label>
          <input class="input input--mono" id="trg-command" value="${escapeHtml(config.command || 'start')}" maxlength="32" />
        </div>`;
      case 'keyword':
        return `<div class="field" style="margin:0">
          <label class="field__label" for="trg-keywords">Keywords</label>
          <input class="input" id="trg-keywords" value="${escapeHtml((config.keywords || []).join(', '))}" />
        </div>`;
      case 'callback':
        return `<div class="field" style="margin:0">
          <label class="field__label" for="trg-data">Callback data (blank = any button)</label>
          <input class="input input--mono" id="trg-data" value="${escapeHtml(config.data || '')}" maxlength="64" />
        </div>`;
      case 'schedule':
        return `<div class="field" style="margin:0">
          <label class="field__label" for="trg-interval">Interval (minutes)</label>
          <input class="input" id="trg-interval" type="number" min="1" max="10080" value="${Number(config.intervalMinutes || 60)}" />
        </div>`;
      default:
        return '<p class="field__hint">No additional configuration.</p>';
    }
  }

  function readTriggerConfig(root, type) {
    const value = (selector) => root.querySelector(selector)?.value ?? '';
    switch (type) {
      case 'command':
        return { command: value('#trg-command').trim().replace(/^\//, '').toLowerCase() };
      case 'keyword':
        return { keywords: value('#trg-keywords').split(',').map((k) => k.trim()).filter(Boolean), matchMode: 'contains' };
      case 'callback':
        return { data: value('#trg-data').trim(), matchAny: !value('#trg-data').trim() };
      case 'schedule':
        return { intervalMinutes: Number(value('#trg-interval')) || 60, timezone: 'UTC' };
      default:
        return {};
    }
  }

  renderInspector();

  return {
    getGraph: () => canvas.getGraph(),
    setGraph(nextGraph) {
      canvas.setGraph(nextGraph);
      selection = null;
      renderInspector();
      renderNodeList();
    },
    focusNode: (id) => canvas.focusNode(id),
    destroy: () => canvas.destroy(),
  };
}
