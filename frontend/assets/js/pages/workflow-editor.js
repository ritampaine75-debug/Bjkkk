/**
 * Workflow editor host: one workflow, two editing modes, shared draft state.
 *
 * - Easy Mode (form editor) and Advanced Mode (visual canvas) both read and
 *   write the identical graph document.
 * - Undo/redo operate on graph snapshots taken by this host.
 * - Saving persists the draft; publishing snapshots an immutable version.
 */
import { escapeHtml, relativeTime, debounce } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { api } from '../api-client.js';
import { loadBot } from '../services/bot-context.js';
import { skeletonPage, renderPageError } from '../components/states.js';
import { confirmDialog } from '../components/modal.js';
import { toastSuccess, toastError, toastWarning } from '../components/toast.js';
import { createFormEditor } from '../editors/form-editor.js';
import { createVisualEditor } from '../editors/visual-editor.js';
import { validateWorkflow, workflowFingerprint } from '../../../../shared/workflow-schema.js';
import { canEditInForm } from '../../../../shared/workflow-form-model.js';

const MODE_KEY = 'botforge.editorMode';

export default async function mountWorkflowEditor(container, { params, query }) {
  container.innerHTML = skeletonPage();
  let botData;
  let workflow;
  let catalog;
  try {
    botData = await loadBot(params.botId);
    const res = await api.get(`/bots/${encodeURIComponent(params.botId)}/workflows/${encodeURIComponent(params.workflowId)}`);
    workflow = res.workflow;
    catalog = await api.get(`/bots/${encodeURIComponent(params.botId)}/workflows/catalog`);
  } catch (err) {
    renderPageError(container, {
      title: 'Could not open this workflow',
      message: err.message,
      retry: () => mountWorkflowEditor(container, { params, query }),
    });
    return;
  }

  const bot = botData.bot;
  let graph = structuredClone(workflow.draft || { triggers: [], nodes: [], edges: [] });
  let name = workflow.name;
  let description = workflow.description;
  let mode = query?.mode === 'advanced' || query?.mode === 'easy' ? query.mode : readStoredMode();
  let dirty = false;
  let saving = false;
  let editor = null;
  const history = { past: [], future: [] };
  let lastValidation = validateWorkflow(graph, { allowHttp: catalog.httpActionsEnabled, allowedHosts: catalog.httpAllowedHosts });
  let selectedRef = null;

  const reload = () => mountWorkflowEditor(container, { params, query });

  container.innerHTML = `
    <div class="page" style="gap:var(--space-4)">
      <header class="page-header" style="align-items:center">
        <div class="page-header__text" style="flex:1 1 320px;min-width:0">
          <div class="row small muted" style="gap:var(--space-2);margin-bottom:2px">
            <a href="#/bots/${encodeURIComponent(bot.id)}/workflows" style="color:inherit">Automations</a>
            <span>/</span>
            <span class="truncate">${escapeHtml(workflow.name)}</span>
          </div>
          <div class="row" style="gap:var(--space-2);align-items:center">
            <input class="input" id="wf-name" value="${escapeHtml(name)}" maxlength="80" aria-label="Workflow name"
              style="font-size:var(--fs-lg);font-weight:650;border-color:transparent;background:transparent;padding-left:0;max-width:420px" />
            <span id="wf-status-badge"></span>
          </div>
          <div class="row small muted" style="gap:var(--space-2)">
            <span id="wf-save-state">Saved</span>
            <span>·</span>
            <span>Updated ${escapeHtml(relativeTime(workflow.updatedAt))}</span>
            <span>·</span>
            <button class="btn btn--ghost btn--sm" type="button" id="wf-versions">${icon('clock')} Versions (${workflow.version || 0})</button>
          </div>
        </div>
        <div class="page-header__actions">
          <div class="segmented" role="group" aria-label="Editing mode">
            <button type="button" data-mode="easy" aria-pressed="${mode === 'easy'}">Easy</button>
            <button type="button" data-mode="advanced" aria-pressed="${mode === 'advanced'}">Advanced</button>
          </div>
          <button class="btn btn--ghost btn--icon" type="button" id="wf-undo" aria-label="Undo" disabled>${icon('undo')}</button>
          <button class="btn btn--ghost btn--icon" type="button" id="wf-redo" aria-label="Redo" disabled>${icon('redo')}</button>
          <a class="btn btn--ghost" href="#/bots/${encodeURIComponent(params.botId)}/simulator?workflow=${encodeURIComponent(params.workflowId)}&source=draft">${icon('flask')} Test</a>
          <button class="btn btn--secondary" type="button" id="wf-validate">${icon('checkCircle')} Validate</button>
          <button class="btn btn--secondary" type="button" id="wf-save">${icon('save')} Save draft</button>
          <button class="btn btn--primary" type="button" id="wf-publish">${icon('send')} Publish</button>
        </div>
      </header>

      <div id="wf-notice"></div>
      <div id="wf-editor"></div>
      <div id="wf-validation"></div>
    </div>`;

  const editorHost = container.querySelector('#wf-editor');
  const noticeHost = container.querySelector('#wf-notice');
  const validationHost = container.querySelector('#wf-validation');
  const saveState = container.querySelector('#wf-save-state');
  const undoBtn = container.querySelector('#wf-undo');
  const redoBtn = container.querySelector('#wf-redo');
  const nameInput = container.querySelector('#wf-name');

  function readStoredMode() {
    try {
      const stored = localStorage.getItem(MODE_KEY);
      return stored === 'advanced' ? 'advanced' : 'easy';
    } catch {
      return 'easy';
    }
  }

  function storeMode(nextMode) {
    try {
      localStorage.setItem(MODE_KEY, nextMode);
    } catch {
      /* ignore */
    }
  }

  function setDirty(next) {
    dirty = next;
    saveState.textContent = next ? 'Unsaved changes' : 'Saved';
    saveState.className = next ? 'text-warning' : 'muted';
  }

  /** Remember the state we are leaving so undo can return to it. */
  function pushHistory(previousGraph) {
    if (history.past.length > 0) {
      const last = history.past[history.past.length - 1];
      if (workflowFingerprint(last) === workflowFingerprint(previousGraph)) {
        history.future.length = 0;
        updateHistoryButtons();
        return;
      }
    }
    history.past.push(structuredClone(previousGraph));
    if (history.past.length > 50) history.past.shift();
    history.future.length = 0;
    updateHistoryButtons();
  }

  function updateHistoryButtons() {
    if (undoBtn) undoBtn.disabled = history.past.length === 0;
    if (redoBtn) redoBtn.disabled = history.future.length === 0;
  }

  function handleGraphChange(nextGraph) {
    const previous = graph;
    graph = nextGraph;
    pushHistory(previous);
    setDirty(true);
    revalidate();
  }

  function revalidate() {
    lastValidation = validateWorkflow(graph, {
      allowHttp: catalog.httpActionsEnabled,
      allowedHosts: catalog.httpAllowedHosts,
    });
    renderValidation();
    renderStatus();
  }

  function mountEditor() {
    editor?.destroy?.();
    editorHost.innerHTML = '';
    if (mode === 'easy') {
      editor = createFormEditor({
        container: editorHost,
        graph,
        onChange: handleGraphChange,
        onNotice: (notice) => {
          if (notice === 'switch-advanced') switchMode('advanced');
        },
      });
    } else {
      editor = createVisualEditor({
        container: editorHost,
        graph,
        onChange: handleGraphChange,
        onToast: (message, tone) => (tone === 'error' ? toastError(message) : toastSuccess(message)),
        onSelect: (selection) => {
          selectedRef = selection;
        },
      });
    }
    renderValidation();
    renderStatus();
  }

  function switchMode(nextMode) {
    if (nextMode === mode) return;
    mode = nextMode;
    storeMode(mode);
    container.querySelectorAll('[data-mode]').forEach((btn) =>
      btn.setAttribute('aria-pressed', String(btn.dataset.mode === mode)),
    );
    const check = canEditInForm(graph);
    if (mode === 'easy' && !check.editable) {
      noticeHost.innerHTML = `<div class="alert alert--warning">
        ${icon('alert')}
        <div class="alert__body">
          <div class="alert__title">This workflow cannot be edited in Easy Mode</div>
          <div class="alert__text">${escapeHtml(check.reasons.join(' '))} Nothing has been changed - your graph is intact.</div>
        </div>
      </div>`;
    } else {
      noticeHost.innerHTML = '';
    }
    mountEditor();
  }

  function renderStatus() {
    const badge = container.querySelector('#wf-status-badge');
    const status = workflow.status;
    const tone = status === 'published' ? 'success' : status === 'paused' ? 'warning' : 'neutral';
    badge.innerHTML = `<span class="badge badge--${tone}">${escapeHtml(status)}</span>`;
  }

  function renderValidation() {
    const errors = lastValidation.errors || [];
    const warnings = lastValidation.warnings || [];
    if (errors.length === 0 && warnings.length === 0) {
      validationHost.innerHTML = `<div class="alert alert--success small">
        ${icon('checkCircle')}
        <div class="alert__body"><div class="alert__text">Validation passed. This workflow is ready to publish.</div></div>
      </div>`;
      return;
    }
    validationHost.innerHTML = `
      <div class="card">
        <div class="card__header">
          <div>
            <h2 class="card__title">${icon(errors.length ? 'alert' : 'info')} Validation</h2>
            <p class="card__subtitle">${errors.length} error${errors.length === 1 ? '' : 's'} · ${warnings.length} warning${warnings.length === 1 ? '' : 's'}</p>
          </div>
          <span class="badge badge--${errors.length ? 'danger' : 'warning'}">${errors.length ? 'Cannot publish yet' : 'Publishable'}</span>
        </div>
        <div class="card__body">
          <ul class="stack-sm small" style="margin:0;padding-left:1.1rem">
            ${errors.map((error) => `<li><strong>${escapeHtml(error.field)}</strong> — ${escapeHtml(error.message)}</li>`).join('')}
            ${warnings.map((warning) => `<li class="muted">${escapeHtml(warning.message)}</li>`).join('')}
          </ul>
        </div>
      </div>`;
  }

  /* ------------------------------------------------------------- controls */
  container.querySelectorAll('[data-mode]').forEach((btn) =>
    btn.addEventListener('click', () => switchMode(btn.dataset.mode)),
  );

  nameInput.addEventListener('input', () => {
    name = nameInput.value;
    setDirty(true);
  });

  undoBtn.addEventListener('click', () => {
    const previous = history.past.pop();
    if (!previous) return;
    history.future.push(structuredClone(graph));
    graph = previous;
    setDirty(true);
    revalidate();
    editor?.setGraph?.(graph);
    updateHistoryButtons();
  });

  redoBtn.addEventListener('click', () => {
    const next = history.future.pop();
    if (!next) return;
    history.past.push(structuredClone(graph));
    graph = next;
    setDirty(true);
    revalidate();
    editor?.setGraph?.(graph);
    updateHistoryButtons();
  });

  container.querySelector('#wf-validate').addEventListener('click', () => {
    revalidate();
    if (lastValidation.valid) toastSuccess('Validation passed.');
    else toastError(`Validation found ${lastValidation.errors.length} problem(s).`);
  });

  async function save({ silent = false } = {}) {
    if (saving) return false;
    saving = true;
    saveState.textContent = 'Saving…';
    try {
      const payload = { ...graph, name: name.trim() || 'Untitled workflow', description };
      const res = await api.put(`/bots/${encodeURIComponent(bot.id)}/workflows/${encodeURIComponent(workflow.id)}`, {
        workflow: payload,
      });
      workflow = res.workflow;
      graph = structuredClone(res.workflow.draft);
      lastValidation = { ...lastValidation, errors: res.errors || [], warnings: res.warnings || [], valid: res.valid };
      setDirty(false);
      renderValidation();
      renderStatus();
      if (!silent) {
        if (res.valid) toastSuccess('Draft saved.');
        else toastWarning('Draft saved with validation errors - fix them before publishing.');
      }
      return true;
    } catch (err) {
      setDirty(true);
      saveState.textContent = 'Save failed';
      toastError(err.message || 'Could not save the workflow.');
      return false;
    } finally {
      saving = false;
    }
  }

  container.querySelector('#wf-save').addEventListener('click', () => save());

  container.querySelector('#wf-publish').addEventListener('click', async () => {
    revalidate();
    if (!lastValidation.valid) {
      toastError('Fix the validation errors before publishing.');
      return;
    }
    if (dirty && !(await save({ silent: true }))) return;
    const confirmed = await confirmDialog({
      title: 'Publish this workflow?',
      message:
        'Publishing creates an immutable version and activates the workflow for live Telegram updates. A published workflow keeps serving the last published version until you publish again.',
      confirmLabel: 'Publish',
      tone: 'primary',
    });
    if (!confirmed) return;
    try {
      const res = await api.post(`/bots/${encodeURIComponent(bot.id)}/workflows/${encodeURIComponent(workflow.id)}/publish`, {});
      toastSuccess(`Published version ${res.version}.`);
      reload();
    } catch (err) {
      if (err.code === 'production_confirmation_required') {
        const ok = await confirmDialog({
          title: 'Production bot',
          message: 'This bot is marked as production. Publishing will make the workflow live. Continue?',
          confirmLabel: 'Publish to production',
          tone: 'danger',
        });
        if (!ok) return;
        try {
          const res = await api.post(`/bots/${encodeURIComponent(bot.id)}/workflows/${encodeURIComponent(workflow.id)}/publish`, {
            confirmProduction: true,
          });
          toastSuccess(`Published version ${res.version}.`);
          reload();
        } catch (inner) {
          toastError(inner.message);
        }
        return;
      }
      toastError(err.message || 'Could not publish.');
    }
  });

  container.querySelector('#wf-versions').addEventListener('click', async () => {
    try {
      const { versions } = await api.get(`/bots/${encodeURIComponent(bot.id)}/workflows/${encodeURIComponent(workflow.id)}/versions`);
      const dialog = document.createElement('dialog');
      dialog.className = 'modal';
      dialog.innerHTML = `
        <div class="modal__header">
          <div>
            <h2 class="card__title">Version history</h2>
            <p class="card__subtitle">Published versions are immutable snapshots.</p>
          </div>
          <button class="icon-btn" type="button" data-close aria-label="Close">${icon('x')}</button>
        </div>
        <div class="modal__body">
          ${
            versions.length === 0
              ? '<p class="small secondary">No published versions yet. Publish the workflow to create version 1.</p>'
              : `<div class="list" style="border:1px solid var(--border);border-radius:var(--radius-md);overflow:hidden">
                  ${versions
                    .map(
                      (version) => `<div class="list__item">
                        <div class="list__main">
                          <div class="list__title">Version ${version.version}${version.version === workflow.publishedVersion ? ' · current' : ''}</div>
                          <div class="list__meta">${escapeHtml(version.name || '')} · ${escapeHtml(relativeTime(version.publishedAt))} · ${version.nodeCount} nodes</div>
                        </div>
                        <button class="btn btn--secondary btn--sm" type="button" data-restore="${escapeHtml(version.id)}">Restore to draft</button>
                      </div>`,
                    )
                    .join('')}
                </div>`
          }
        </div>
        <div class="modal__footer"><button class="btn btn--secondary" type="button" data-close>Close</button></div>`;
      document.body.appendChild(dialog);
      dialog.querySelectorAll('[data-close]').forEach((btn) =>
        btn.addEventListener('click', () => {
          dialog.close();
          dialog.remove();
        }),
      );
      dialog.querySelectorAll('[data-restore]').forEach((btn) =>
        btn.addEventListener('click', async () => {
          const confirmed = await confirmDialog({
            title: 'Restore this version?',
            message: 'The version is copied into your draft. Published history is not modified and nothing goes live until you publish again.',
            confirmLabel: 'Restore to draft',
          });
          if (!confirmed) return;
          try {
            await api.post(
              `/bots/${encodeURIComponent(bot.id)}/workflows/${encodeURIComponent(workflow.id)}/versions/${encodeURIComponent(btn.dataset.restore)}/restore`,
            );
            toastSuccess('Version restored into the draft.');
            dialog.close();
            reload();
          } catch (err) {
            toastError(err.message);
          }
        }),
      );
      dialog.addEventListener('cancel', () => dialog.remove());
      dialog.showModal();
    } catch (err) {
      toastError(err.message);
    }
  });

  // Warn before losing unsaved edits.
  const beforeUnload = (event) => {
    if (!dirty) return undefined;
    event.preventDefault();
    event.returnValue = '';
    return '';
  };
  window.addEventListener('beforeunload', beforeUnload);
  const cleanup = () => window.removeEventListener('beforeunload', beforeUnload);
  window.addEventListener('hashchange', cleanup, { once: true });

  // Autosave drafts every 45s when there are changes, matching the "persist
  // drafts without losing work" requirement. Disabled for automated UI tests.
  const autosaveEnabled = query?.autosave !== 'off';
  const autosave = autosaveEnabled
    ? setInterval(() => {
        if (dirty && !saving) save({ silent: true });
      }, 45000)
    : null;
  window.addEventListener('hashchange', () => autosave && clearInterval(autosave), { once: true });

  updateHistoryButtons();
  mountEditor();
  renderStatus();
}
