/**
 * Easy Mode: a step-by-step form editor for workflows.
 *
 * It projects the shared graph into ordered steps (shared/workflow-form-model),
 * lets a beginner edit without seeing nodes or edges, and projects the result
 * back into the same graph schema. Workflow shapes Easy Mode cannot represent
 * are reported explicitly and left in Advanced Mode.
 */
import { escapeHtml } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import {
  buildFormModel,
  applyFormModel,
  canEditInForm,
  createFormStep,
} from '../../../../shared/workflow-form-model.js';
import { NODE_DEFINITIONS, TRIGGER_DEFINITIONS } from '../../../../shared/workflow-schema.js';
import { CONDITION_OPERATORS, CONDITION_SUBJECTS, WORKFLOW_LIMITS } from '../../../../shared/constants.js';

const STEP_CHOICES = [
  { type: 'sendMessage', label: 'Send a text message' },
  { type: 'sendKeyboard', label: 'Send a message with buttons' },
  { type: 'condition', label: 'Check a condition (branch)' },
  { type: 'setVariable', label: 'Remember a value' },
  { type: 'delay', label: 'Wait a moment' },
  { type: 'answerCallback', label: 'Answer a button tap' },
  { type: 'sendPhoto', label: 'Send a photo' },
  { type: 'sendDocument', label: 'Send a document' },
  { type: 'httpRequest', label: 'Call an HTTP API' },
  { type: 'logEvent', label: 'Log an event' },
  { type: 'end', label: 'End the workflow' },
];

export function createFormEditor({ container, graph, onChange, onNotice }) {
  const check = canEditInForm(graph);

  if (!check.editable) {
    container.innerHTML = `
      <div class="stack">
        <div class="alert alert--warning">
          ${icon('alert')}
          <div class="alert__body">
            <div class="alert__title">Easy Mode cannot show this workflow</div>
            <div class="alert__text">The stored graph is kept exactly as it is. Switch to Advanced Mode to edit it.</div>
          </div>
        </div>
        <div class="card">
          <div class="card__body">
            <ul class="small secondary stack-sm" style="margin:0;padding-left:1.1rem">
              ${check.reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join('')}
            </ul>
            <button class="btn btn--primary btn--sm" type="button" data-switch-advanced style="margin-top:var(--space-3)">
              ${icon('canvas')} Open Advanced Mode
            </button>
          </div>
        </div>
      </div>`;
    container.querySelector('[data-switch-advanced]')?.addEventListener('click', () => onNotice?.('switch-advanced'));
    return { destroy() {} };
  }

  let model = buildFormModel(graph);

  const commit = (nextModel) => {
    model = nextModel;
    const nextGraph = applyFormModel(model, graph);
    onChange?.(nextGraph, model);
    render();
  };

  function render() {
    container.innerHTML = `
      <div class="stack">
        <section class="card">
          <div class="card__header">
            <div>
              <h2 class="card__title">${icon('zap')} Trigger</h2>
              <p class="card__subtitle">What starts this workflow</p>
            </div>
          </div>
          <div class="card__body">
            <div class="field">
              <label class="field__label" for="easy-trigger-type">When this happens</label>
              <div class="select-wrap">
                <select class="select" id="easy-trigger-type">
                  ${Object.entries(TRIGGER_DEFINITIONS)
                    .map(
                      ([type, definition]) =>
                        `<option value="${type}" ${model.trigger?.type === type ? 'selected' : ''}>${escapeHtml(definition.label)}</option>`,
                    )
                    .join('')}
                </select>
              </div>
              <p class="field__hint">${escapeHtml(TRIGGER_DEFINITIONS[model.trigger?.type]?.description || '')}</p>
            </div>
            ${renderTriggerFields(model.trigger)}
          </div>
        </section>

        <section class="card">
          <div class="card__header">
            <div>
              <h2 class="card__title">${icon('list')} Steps</h2>
              <p class="card__subtitle">Runs top to bottom: ${model.steps.length} step${model.steps.length === 1 ? '' : 's'}</p>
            </div>
          </div>
          <div class="card__body">
            ${model.steps.length === 0 ? '<p class="field__hint">No steps yet. Add the first step below.</p>' : ''}
            ${renderSteps(model.steps, [])}
            <div class="row" style="margin-top:var(--space-3)">
              <div class="select-wrap" style="flex:1 1 220px">
                <select class="select" id="step-type" aria-label="Step type">
                  ${STEP_CHOICES.map((choice) => `<option value="${choice.type}">${escapeHtml(choice.label)}</option>`).join('')}
                </select>
              </div>
              <button class="btn btn--secondary" type="button" data-add-step="root">${icon('plus')} Add step</button>
            </div>
          </div>
        </section>
      </div>`;

    bind();
  }

  function renderTriggerFields(trigger) {
    if (!trigger) return '';
    switch (trigger.type) {
      case 'command':
        return `<div class="field">
          <label class="field__label" for="easy-command">Command</label>
          <div class="input-group">
            <span class="input" style="flex:none;display:flex;align-items:center;background:var(--bg-inset);color:var(--text-muted)">/</span>
            <input class="input input--mono" id="easy-command" value="${escapeHtml(trigger.config.command || '')}"
              maxlength="32" pattern="[a-z0-9_]{1,32}" autocomplete="off" spellcheck="false" placeholder="start" />
          </div>
        </div>`;
      case 'keyword':
        return `<div class="field">
          <label class="field__label" for="easy-keywords">Keywords (comma separated)</label>
          <input class="input" id="easy-keywords" value="${escapeHtml((trigger.config.keywords || []).join(', '))}" placeholder="help, support" />
        </div>`;
      case 'callback':
        return `<label class="checkbox" for="easy-callback-any">
          <input type="checkbox" id="easy-callback-any" ${trigger.config.matchAny !== false ? 'checked' : ''} />
          <span class="checkbox__text">Run for every button tap</span>
        </label>
        <div class="field" style="margin-top:var(--space-3)">
          <label class="field__label" for="easy-callback-data">Callback data (when not matching every button)</label>
          <input class="input input--mono" id="easy-callback-data" value="${escapeHtml(trigger.config.data || '')}" maxlength="64" />
        </div>`;
      case 'schedule':
        return `<div class="field">
          <label class="field__label" for="easy-interval">Run every (minutes)</label>
          <input class="input" id="easy-interval" type="number" min="1" max="10080" value="${Number(trigger.config.intervalMinutes || 60)}" />
        </div>`;
      default:
        return '<p class="field__hint">This trigger has no additional settings.</p>';
    }
  }

  function renderSteps(steps, path) {
    if (steps.length === 0) {
      return '<p class="field__hint">No steps in this branch yet.</p>';
    }
    return steps
      .map((step, index) => {
        const definition = NODE_DEFINITIONS[step.type] || { label: step.type };
        return `<div class="form-step">
          ${index > 0 ? '<span class="form-step__rail"></span>' : ''}
          <div class="form-step__header">
            <span class="form-step__index">${index + 1}</span>
            <span class="form-step__title">${escapeHtml(definition.label)}</span>
            <div class="row" style="gap:2px;flex-wrap:nowrap">
              <button class="icon-btn" type="button" data-step-edit="${path.join('.')}:${index}" aria-label="Edit step ${index + 1}">${icon('edit', { size: 15 })}</button>
              <button class="icon-btn" type="button" data-step-up="${path.join('.')}:${index}" aria-label="Move step ${index + 1} up" ${index === 0 ? 'disabled' : ''}>${icon('chevronLeft', { size: 15 })}</button>
              <button class="icon-btn" type="button" data-step-down="${path.join('.')}:${index}" aria-label="Move step ${index + 1} down" ${index === steps.length - 1 ? 'disabled' : ''}>${icon('chevronRight', { size: 15 })}</button>
              <button class="icon-btn" type="button" data-step-delete="${path.join('.')}:${index}" aria-label="Delete step ${index + 1}">${icon('trash', { size: 15 })}</button>
            </div>
          </div>
          <div class="form-step__body">
            <div class="small secondary">${escapeHtml(stepSummary(step))}</div>
            ${
              step.type === 'condition'
                ? `<div class="form-branch">
                    <div class="form-branch__label">If true</div>
                    ${renderSteps(step.branches?.true || [], [...path, index, 'true'])}
                    <button class="btn btn--ghost btn--sm" type="button" data-add-step="${[...path, index, 'true'].join('.')}">${icon('plus')} Add step to true branch</button>
                  </div>
                  <div class="form-branch">
                    <div class="form-branch__label">If false</div>
                    ${renderSteps(step.branches?.false || [], [...path, index, 'false'])}
                    <button class="btn btn--ghost btn--sm" type="button" data-add-step="${[...path, index, 'false'].join('.')}">${icon('plus')} Add step to false branch</button>
                  </div>`
                : ''
            }
          </div>
        </div>`;
      })
      .join('');
  }

  function stepSummary(step) {
    const config = step.config || {};
    switch (step.type) {
      case 'sendMessage':
      case 'editMessage':
        return truncate(config.text, 120) || 'No text yet';
      case 'sendKeyboard': {
        const buttons = (config.keyboard?.rows || []).flat();
        return `${truncate(config.text, 80) || 'No text yet'} · ${buttons.length} button${buttons.length === 1 ? '' : 's'}`;
      }
      case 'condition':
        return `${config.subject} ${config.operator} ${truncate(config.value, 40)}`;
      case 'setVariable':
        return `${config.name} = ${truncate(config.value, 40)}`;
      case 'delay':
        return `Wait ${(Number(config.ms) || 0) / 1000} seconds`;
      case 'answerCallback':
        return config.text ? truncate(config.text, 80) : 'Answer silently';
      case 'sendPhoto':
        return truncate(config.photo, 100) || 'No photo configured';
      case 'sendDocument':
        return truncate(config.document, 100) || 'No document configured';
      case 'httpRequest':
        return `${config.method} ${truncate(config.url, 80)}`;
      case 'logEvent':
        return truncate(config.message, 100);
      case 'end':
        return `End (${config.reason || 'completed'})`;
      default:
        return '';
    }
  }

  function truncate(value, max) {
    const text = String(value || '');
    return text.length > max ? `${text.slice(0, max)}…` : text;
  }

  /* --------------------------------------------------------- path helpers */
  function resolvePathIn(modelValue, parts) {
    let list = modelValue.steps;
    for (let i = 0; i < parts.length; i += 2) {
      const index = parts[i];
      const branch = parts[i + 1];
      const step = list[index];
      if (!step?.branches) throw new Error('Invalid branch path');
      list = step.branches[branch];
    }
    return { list };
  }

  function bind() {
    container.querySelector('#easy-trigger-type')?.addEventListener('change', (event) => {
      const next = structuredClone(model);
      const type = event.target.value;
      const baseConfig = { command: 'start' };
      next.trigger = { ...(next.trigger || {}), type, config: type === next.trigger?.type ? next.trigger.config : baseConfig };
      commit(next);
    });

    const bindTriggerInput = (selector, apply) => {
      const el = container.querySelector(selector);
      el?.addEventListener('input', () => {
        const next = structuredClone(model);
        next.trigger = next.trigger || { type: 'command', config: {} };
        apply(next.trigger, el);
        commit(next);
      });
    };
    bindTriggerInput('#easy-command', (trigger, el) => {
      trigger.config.command = el.value.trim().toLowerCase().replace(/^\//, '');
    });
    bindTriggerInput('#easy-keywords', (trigger, el) => {
      trigger.config.keywords = el.value.split(',').map((k) => k.trim()).filter(Boolean);
    });
    bindTriggerInput('#easy-callback-data', (trigger, el) => {
      trigger.config.data = el.value;
    });
    bindTriggerInput('#easy-callback-any', (trigger, el) => {
      trigger.config.matchAny = el.checked;
    });
    bindTriggerInput('#easy-interval', (trigger, el) => {
      trigger.config.intervalMinutes = Number(el.value) || 60;
    });

    container.querySelectorAll('[data-add-step]').forEach((button) =>
      button.addEventListener('click', () => {
        const type = container.querySelector('#step-type').value;
        const step = createFormStep(type);
        openStepDialog(type, step, button.dataset.addStep, true);
      }),
    );

    container.querySelectorAll('[data-step-edit]').forEach((button) =>
      button.addEventListener('click', () => {
        const [pathString, indexString] = splitRef(button.dataset.stepEdit);
        const step = getStepAt(pathString, Number(indexString));
        if (step) openStepDialog(step.type, step, pathString, false, Number(indexString));
      }),
    );

    container.querySelectorAll('[data-step-delete]').forEach((button) =>
      button.addEventListener('click', () => {
        const [pathString, indexString] = splitRef(button.dataset.stepDelete);
        const next = structuredClone(model);
        const { list } = pathString === '' ? { list: next.steps } : resolvePathIn(next, pathString.split('.').map(toPart));
        list.splice(Number(indexString), 1);
        commit(next);
      }),
    );

    container.querySelectorAll('[data-step-up]').forEach((button) =>
      button.addEventListener('click', () => moveStep(button.dataset.stepUp, -1)),
    );
    container.querySelectorAll('[data-step-down]').forEach((button) =>
      button.addEventListener('click', () => moveStep(button.dataset.stepDown, 1)),
    );
  }

  function moveStep(ref, delta) {
    const [pathString, indexString] = splitRef(ref);
    const index = Number(indexString);
    const next = structuredClone(model);
    const { list } = pathString === '' ? { list: next.steps } : resolvePathIn(next, pathString.split('.').map(toPart));
    const target = index + delta;
    if (target < 0 || target >= list.length) return;
    [list[index], list[target]] = [list[target], list[index]];
    commit(next);
  }

  function splitRef(ref) {
    const parts = ref.split(':');
    return [parts[0], parts[1]];
  }

  function toPart(value) {
    return value === 'true' || value === 'false' ? value : Number(value);
  }

  function getStepAt(pathString, index) {
    if (pathString === '') return model.steps[index];
    let list = model.steps;
    const parts = pathString.split('.');
    for (let i = 0; i < parts.length - 1; i += 2) {
      const step = list[Number(parts[i])];
      if (!step?.branches) return null;
      list = step.branches[parts[i + 1]];
      if (!list) return null;
    }
    return list ? list[index] : null;
  }

  /* ------------------------------------------------------------ step modal */
  function openStepDialog(type, step, pathString, isNew) {
    const dialog = document.createElement('dialog');
    dialog.className = 'modal';
    dialog.style.width = 'min(620px, calc(100vw - 2 * var(--space-4)))';
    document.body.appendChild(dialog);
    let draft = structuredClone(step);
    let keyboardRows = structuredClone(draft.config?.keyboard?.rows || []);

    const draw = () => {
      dialog.innerHTML = `
        <form method="dialog" id="step-form" novalidate>
          <div class="modal__header">
            <div>
              <h2 class="card__title">${escapeHtml(NODE_DEFINITIONS[draft.type]?.label || draft.type)}</h2>
              <p class="card__subtitle">Step settings are saved into the same workflow graph as Advanced Mode.</p>
            </div>
            <button class="icon-btn" type="button" data-close aria-label="Close">${icon('x')}</button>
          </div>
          <div class="modal__body">
            <div class="field">
              <label class="field__label" for="step-type-select">Step type</label>
              <div class="select-wrap">
                <select class="select" id="step-type-select">
                  ${STEP_CHOICES.map(
                    (choice) => `<option value="${choice.type}" ${choice.type === draft.type ? 'selected' : ''}>${escapeHtml(choice.label)}</option>`,
                  ).join('')}
                </select>
              </div>
            </div>
            ${stepFields(draft, keyboardRows)}
            <div id="step-errors" role="alert" aria-live="assertive"></div>
          </div>
          <div class="modal__footer">
            <button class="btn btn--secondary" type="button" data-close>Cancel</button>
            <button class="btn btn--primary" type="submit">Save step</button>
          </div>
        </form>`;

      dialog.querySelectorAll('[data-close]').forEach((btn) =>
        btn.addEventListener('click', () => {
          dialog.close();
          dialog.remove();
        }),
      );
      dialog.querySelector('#step-type-select').addEventListener('change', (event) => {
        draft = createFormStep(event.target.value);
        keyboardRows = structuredClone(draft.config?.keyboard?.rows || []);
        draw();
      });
      bindStepFields(dialog, draft, keyboardRows, () => draw());
      dialog.querySelector('#step-form').addEventListener('submit', (event) => {
        event.preventDefault();
        const config = readStepFields(dialog, draft, keyboardRows);
        const nextDraft = { ...draft, config };
        if (isNew) {
          const next = structuredClone(model);
          if (pathString === 'root') next.steps.push(nextDraft);
          else {
            const { list } = resolvePathIn(next, pathString.split('.').map(toPart));
            list.push(nextDraft);
          }
          commit(next);
        } else {
          const next = structuredClone(model);
          const { list } = pathString === '' ? { list: next.steps } : resolvePathIn(next, pathString.split('.').map(toPart));
          const index = list.findIndex((item) => item.id === step.id);
          if (index >= 0) list[index] = nextDraft;
          commit(next);
        }
        dialog.close();
        dialog.remove();
      });
    };

    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      dialog.close();
      dialog.remove();
    });
    draw();
    dialog.showModal();
  }

  render();
  return {
    getModel: () => structuredClone(model),
    setGraph(nextGraph) {
      const nextCheck = canEditInForm(nextGraph);
      if (nextCheck.editable) {
        model = buildFormModel(nextGraph);
        render();
      }
    },
    destroy() {},
  };
}

/* ----------------------------------------------------------- field markup */
function stepFields(step, keyboardRows) {
  const config = step.config || {};
  switch (step.type) {
    case 'sendMessage':
    case 'editMessage':
      return `
        <div class="field">
          <label class="field__label" for="f-text">Message text</label>
          <textarea class="textarea" id="f-text" rows="5" maxlength="${WORKFLOW_LIMITS.TEXT_MAX}">${escapeHtml(config.text || '')}</textarea>
          <p class="field__hint">Variables like <code>{{first_name}}</code> are replaced at run time.</p>
        </div>`;
    case 'sendKeyboard':
      return `
        <div class="field">
          <label class="field__label" for="f-text">Message text</label>
          <textarea class="textarea" id="f-text" rows="4" maxlength="${WORKFLOW_LIMITS.TEXT_MAX}">${escapeHtml(config.text || '')}</textarea>
        </div>
        <fieldset class="field" style="border:1px solid var(--border);border-radius:var(--radius-md);padding:var(--space-3)">
          <legend class="field__label">Buttons</legend>
          <div id="f-keyboard" class="stack-sm">
            ${
              keyboardRows.length === 0
                ? '<p class="field__hint">No buttons yet.</p>'
                : keyboardRows.map((row, rowIndex) => keyboardRowEditor(row, rowIndex)).join('')
            }
          </div>
          <button class="btn btn--secondary btn--sm" type="button" id="f-add-row" style="margin-top:var(--space-2)">${icon('plus')} Add row</button>
          <p class="field__hint">Callback buttons send their value to BotForge when tapped.</p>
        </fieldset>`;
    case 'condition':
      return `
        <div class="field">
          <label class="field__label" for="f-subject">Check</label>
          <div class="select-wrap">
            <select class="select" id="f-subject">
              ${CONDITION_SUBJECTS.map((subject) => `<option value="${subject}" ${config.subject === subject ? 'selected' : ''}>${subject}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="field" id="f-variable-wrap" ${config.subject === 'variable' ? '' : 'hidden'}>
          <label class="field__label" for="f-variable">Variable name</label>
          <input class="input input--mono" id="f-variable" value="${escapeHtml(config.variableName || '')}" maxlength="40" />
        </div>
        <div class="field">
          <label class="field__label" for="f-operator">Operator</label>
          <div class="select-wrap">
            <select class="select" id="f-operator">
              ${CONDITION_OPERATORS.map((operator) => `<option value="${operator}" ${config.operator === operator ? 'selected' : ''}>${operator}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="field">
          <label class="field__label" for="f-value">Value</label>
          <input class="input" id="f-value" value="${escapeHtml(config.value || '')}" maxlength="500" />
          <p class="field__hint">Branches are added automatically: "If true" and "If false".</p>
        </div>`;
    case 'setVariable':
      return `
        <div class="field">
          <label class="field__label" for="f-name">Variable name</label>
          <input class="input input--mono" id="f-name" value="${escapeHtml(config.name || '')}" maxlength="40" />
        </div>
        <div class="field">
          <label class="field__label" for="f-varvalue">Value</label>
          <input class="input" id="f-varvalue" value="${escapeHtml(config.value || '')}" maxlength="${WORKFLOW_LIMITS.VARIABLE_VALUE_MAX}" />
        </div>`;
    case 'delay':
      return `<div class="field">
        <label class="field__label" for="f-seconds">Wait (seconds)</label>
        <input class="input" id="f-seconds" type="number" min="0" max="${WORKFLOW_LIMITS.DELAY_MAX_MS / 1000}" value="${(Number(config.ms) || 0) / 1000}" />
        <p class="field__hint">Maximum ${WORKFLOW_LIMITS.DELAY_MAX_MS / 1000} seconds per delay.</p>
      </div>`;
    case 'answerCallback':
      return `
        <div class="field">
          <label class="field__label" for="f-text">Toast text</label>
          <input class="input" id="f-text" value="${escapeHtml(config.text || '')}" maxlength="200" />
        </div>
        <label class="checkbox" for="f-alert">
          <input type="checkbox" id="f-alert" ${config.showAlert ? 'checked' : ''} />
          <span class="checkbox__text">Show as an alert dialog instead of a toast</span>
        </label>`;
    case 'sendPhoto':
    case 'sendDocument': {
      const key = step.type === 'sendPhoto' ? 'photo' : 'document';
      return `
        <div class="field">
          <label class="field__label" for="f-source">${step.type === 'sendPhoto' ? 'Photo' : 'Document'} URL or file_id</label>
          <input class="input input--mono" id="f-source" value="${escapeHtml(config[key] || '')}" placeholder="https://… or a Telegram file_id" />
          <p class="field__hint">Telegram fetches the file from the URL, so it must be publicly reachable.</p>
        </div>
        <div class="field">
          <label class="field__label" for="f-caption">Caption (optional)</label>
          <input class="input" id="f-caption" value="${escapeHtml(config.caption || '')}" maxlength="1024" />
        </div>`;
    }
    case 'sendMedia':
      return `
        <div class="field">
          <label class="field__label" for="f-mediatype">Media type</label>
          <div class="select-wrap">
            <select class="select" id="f-mediatype">
              ${['audio', 'video', 'animation', 'voice']
                .map((type) => `<option value="${type}" ${config.mediaType === type ? 'selected' : ''}>${type}</option>`)
                .join('')}
            </select>
          </div>
        </div>
        <div class="field">
          <label class="field__label" for="f-source">File URL or file_id</label>
          <input class="input input--mono" id="f-source" value="${escapeHtml(config.file || '')}" />
        </div>`;
    case 'httpRequest':
      return `
        <div class="field">
          <label class="field__label" for="f-url">HTTPS URL</label>
          <input class="input input--mono" id="f-url" value="${escapeHtml(config.url || '')}" placeholder="https://api.example.com/hook" />
          <p class="field__hint">External calls must be enabled on the server and their host allowlisted.</p>
        </div>
        <div class="field">
          <label class="field__label" for="f-method">Method</label>
          <div class="select-wrap">
            <select class="select" id="f-method">
              <option value="GET" ${config.method === 'GET' ? 'selected' : ''}>GET</option>
              <option value="POST" ${config.method === 'POST' ? 'selected' : ''}>POST</option>
            </select>
          </div>
        </div>
        <div class="field">
          <label class="field__label" for="f-body">Request body (JSON, optional)</label>
          <textarea class="textarea" id="f-body" rows="3">${escapeHtml(config.body || '')}</textarea>
        </div>`;
    case 'logEvent':
      return `<div class="field">
        <label class="field__label" for="f-text">Log message</label>
        <input class="input" id="f-text" value="${escapeHtml(config.message || '')}" maxlength="500" />
      </div>`;
    case 'end':
      return `<div class="field">
        <label class="field__label" for="f-reason">Reason</label>
        <input class="input" id="f-reason" value="${escapeHtml(config.reason || 'completed')}" maxlength="200" />
      </div>`;
    default:
      return '<p class="field__hint">This step has no settings.</p>';
  }
}

function keyboardRowEditor(row, rowIndex) {
  return `<div style="border:1px solid var(--border);border-radius:var(--radius-sm);padding:var(--space-2);background:var(--bg-inset)">
    <div class="row-between" style="margin-bottom:var(--space-2)">
      <span class="tiny muted">Row ${rowIndex + 1}</span>
      <div class="row">
        <button class="btn btn--ghost btn--sm" type="button" data-kb-add="${rowIndex}">${icon('plus')} Button</button>
        <button class="btn btn--ghost btn--sm" type="button" data-kb-remove-row="${rowIndex}" aria-label="Remove row ${rowIndex + 1}">${icon('trash')}</button>
      </div>
    </div>
    <div class="stack-sm">
      ${row
        .map(
          (button, buttonIndex) => `<div class="row" style="gap:var(--space-2);flex-wrap:nowrap">
            <input class="input" placeholder="Label" value="${escapeHtml(button.text || '')}"
              data-kb="text" data-row="${rowIndex}" data-button="${buttonIndex}" aria-label="Button label" />
            <input class="input input--mono" placeholder="callback data" value="${escapeHtml(button.value || '')}"
              data-kb="value" data-row="${rowIndex}" data-button="${buttonIndex}" aria-label="Button callback data" />
            <button class="icon-btn" type="button" data-kb-remove-button="${rowIndex}:${buttonIndex}" aria-label="Remove button">${icon('x')}</button>
          </div>`,
        )
        .join('')}
    </div>
  </div>`;
}

function bindStepFields(dialog, draft, keyboardRows, redraw) {
  const subject = dialog.querySelector('#f-subject');
  subject?.addEventListener('change', () => {
    const wrap = dialog.querySelector('#f-variable-wrap');
    if (wrap) wrap.hidden = subject.value !== 'variable';
  });

  dialog.querySelector('#f-add-row')?.addEventListener('click', () => {
    keyboardRows.push([{ text: '', type: 'callback', value: '' }]);
    redraw();
  });

  dialog.addEventListener('click', (event) => {
    const addButton = event.target.closest('[data-kb-add]');
    if (addButton) {
      keyboardRows[Number(addButton.dataset.kbAdd)]?.push({ text: '', type: 'callback', value: '' });
      redraw();
      return;
    }
    const removeRow = event.target.closest('[data-kb-remove-row]');
    if (removeRow) {
      keyboardRows.splice(Number(removeRow.dataset.kbRemoveRow), 1);
      redraw();
      return;
    }
    const removeButton = event.target.closest('[data-kb-remove-button]');
    if (removeButton) {
      const [rowIndex, buttonIndex] = removeButton.dataset.kbRemoveButton.split(':').map(Number);
      keyboardRows[rowIndex]?.splice(buttonIndex, 1);
      if (keyboardRows[rowIndex]?.length === 0) keyboardRows.splice(rowIndex, 1);
      redraw();
    }
  });

  dialog.addEventListener('input', (event) => {
    const field = event.target.dataset?.kb;
    if (!field) return;
    const rowIndex = Number(event.target.dataset.row);
    const buttonIndex = Number(event.target.dataset.button);
    const button = keyboardRows[rowIndex]?.[buttonIndex];
    if (!button) return;
    button[field] = event.target.value;
  });
}

function readStepFields(dialog, draft, keyboardRows) {
  const value = (selector) => dialog.querySelector(selector)?.value ?? '';
  const checked = (selector) => Boolean(dialog.querySelector(selector)?.checked);
  const config = { ...draft.config };
  switch (draft.type) {
    case 'sendMessage':
    case 'editMessage':
      return { ...config, text: value('#f-text') };
    case 'sendKeyboard':
      return {
        ...config,
        text: value('#f-text'),
        keyboard: {
          rows: keyboardRows
            .map((row) =>
              row
                .filter((button) => button.text?.trim() && button.value?.trim())
                .map((button) => ({ text: button.text.trim(), type: 'callback', value: button.value.trim() })),
            )
            .filter((row) => row.length > 0),
        },
      };
    case 'condition':
      return {
        ...config,
        subject: value('#f-subject'),
        operator: value('#f-operator'),
        value: value('#f-value'),
        variableName: value('#f-variable'),
      };
    case 'setVariable':
      return { ...config, name: value('#f-name'), value: value('#f-varvalue') };
    case 'delay':
      return { ...config, ms: Math.round(Number(value('#f-seconds') || 0) * 1000) };
    case 'answerCallback':
      return { ...config, text: value('#f-text'), showAlert: checked('#f-alert') };
    case 'sendPhoto':
      return { ...config, photo: value('#f-source'), caption: value('#f-caption') };
    case 'sendDocument':
      return { ...config, document: value('#f-source'), caption: value('#f-caption') };
    case 'sendMedia':
      return { ...config, mediaType: value('#f-mediatype'), file: value('#f-source') };
    case 'httpRequest':
      return { ...config, url: value('#f-url'), method: value('#f-method'), body: value('#f-body') };
    case 'logEvent':
      return { ...config, message: value('#f-text') };
    case 'end':
      return { ...config, reason: value('#f-reason') };
    default:
      return config;
  }
}

/* Shared with Advanced Mode's inspector. */
export { stepFields, bindStepFields, readStepFields, STEP_CHOICES };
