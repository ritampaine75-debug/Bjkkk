/** Automations list: create, publish, pause, duplicate, export and delete workflows. */
import { escapeHtml, relativeTime } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { api } from '../api-client.js';
import { loadBot } from '../services/bot-context.js';
import { renderBotHeader, bindBotHeader } from '../components/bot-header.js';
import { skeletonPage, renderPageError } from '../components/states.js';
import { confirmDialog, promptDialog } from '../components/modal.js';
import { toastSuccess, toastError } from '../components/toast.js';

const STATUS_TONE = { published: 'success', paused: 'warning', draft: 'neutral', archived: 'neutral' };

export default async function mountWorkflows(container, { params }) {
  container.innerHTML = skeletonPage();
  let data;
  let workflows;
  try {
    data = await loadBot(params.botId);
    const res = await api.get(`/bots/${encodeURIComponent(params.botId)}/workflows`);
    workflows = res.workflows;
  } catch (err) {
    renderPageError(container, {
      title: 'Could not load automations',
      message: err.message,
      retry: () => mountWorkflows(container, { params }),
    });
    return;
  }
  const bot = data.bot;
  const reload = () => mountWorkflows(container, { params });
  const botId = bot.id;

  container.innerHTML = `
    <div class="page">
      ${renderBotHeader(bot, 'workflows')}

      <div class="row-between">
        <div>
          <h2 style="font-size:var(--fs-lg)">Automations</h2>
          <p class="small muted" style="margin:2px 0 0">
            ${workflows.length} workflow${workflows.length === 1 ? '' : 's'} ·
            ${workflows.filter((wf) => wf.status === 'published').length} live
          </p>
        </div>
        <div class="row">
          <a class="btn btn--ghost btn--sm" href="#/bots/${encodeURIComponent(params.botId)}/schedules">${icon('clock')} Schedules</a>
          <button class="btn btn--secondary btn--sm" type="button" id="import-workflow">${icon('upload')} Import JSON</button>
          <button class="btn btn--primary btn--sm" type="button" id="new-workflow">${icon('plus')} New workflow</button>
        </div>
      </div>

      ${
        workflows.length === 0
          ? `<section class="card"><div class="card__body">
              <div class="empty">
                <div class="empty__icon">${icon('workflow')}</div>
                <h3>No automations yet</h3>
                <p class="secondary">A workflow connects a trigger (like <code>/start</code>) to actions such as messages,
                inline keyboards and conditions. Build one in the form editor and test it in the simulator before publishing.</p>
                <div class="empty__actions">
                  <button class="btn btn--primary" type="button" id="empty-new">${icon('plus')} Create your first workflow</button>
                  <button class="btn btn--secondary" type="button" id="empty-template">${icon('zap')} Start from the welcome template</button>
                </div>
              </div>
            </div></section>`
          : `<div class="stack">${workflows.map((workflow) => workflowCard(workflow)).join('')}</div>`
      }

      <div class="alert alert--info small">
        ${icon('info')}
        <div class="alert__body"><div class="alert__text">
          Publishing snapshots an immutable version and activates the workflow for live updates.
          Pausing stops new executions but keeps the published version and history.
        </div></div>
      </div>
    </div>`;

  bindBotHeader(container, {
    bot,
    onRefresh: async () => {
      try {
        await api.post(`/bots/${encodeURIComponent(botId)}/validate`);
        toastSuccess('Connection revalidated.');
      } catch (err) {
        toastError(err.message);
      }
      reload();
    },
  });

  async function createWorkflow(template) {
    const name = await promptDialog({
      title: template === 'welcome' ? 'New workflow from template' : 'New workflow',
      label: 'Workflow name',
      value: template === 'welcome' ? 'Welcome workflow' : 'Untitled workflow',
      maxLength: 80,
      description:
        template === 'welcome'
          ? 'Creates a /start trigger with a welcome message and inline keyboard.'
          : 'You can add triggers and steps right after creating it.',
    });
    if (name === null) return;
    try {
      const res = await api.post(`/bots/${encodeURIComponent(botId)}/workflows`, { template, name });
      toastSuccess('Workflow created.');
      window.location.hash = `#/bots/${encodeURIComponent(botId)}/workflows/${encodeURIComponent(res.workflow.id)}`;
    } catch (err) {
      toastError(err.message);
    }
  }

  container.querySelector('#new-workflow')?.addEventListener('click', () => createWorkflow('blank'));
  container.querySelector('#empty-new')?.addEventListener('click', () => createWorkflow('blank'));
  container.querySelector('#empty-template')?.addEventListener('click', () => createWorkflow('welcome'));

  container.querySelector('#import-workflow')?.addEventListener('click', () => openImportDialog());

  function openImportDialog() {
    const dialog = document.createElement('dialog');
    dialog.className = 'modal';
    dialog.innerHTML = `
      <div class="modal__header">
        <div>
          <h2 class="card__title">Import a workflow</h2>
          <p class="card__subtitle">The file is validated against the workflow schema before anything is stored.</p>
        </div>
        <button class="icon-btn" type="button" data-close aria-label="Close">${icon('x')}</button>
      </div>
      <div class="modal__body stack">
        <div class="field" style="margin:0">
          <label class="field__label" for="import-file">Workflow JSON file</label>
          <input class="input" type="file" id="import-file" accept="application/json,.json" />
        </div>
        <div class="field" style="margin:0">
          <label class="field__label" for="import-text">…or paste JSON</label>
          <textarea class="textarea" id="import-text" rows="8" placeholder='{"schemaVersion":1,"name":"Imported","triggers":[…]}'></textarea>
        </div>
        <div id="import-feedback" role="alert" aria-live="assertive"></div>
      </div>
      <div class="modal__footer">
        <button class="btn btn--secondary" type="button" data-close>Cancel</button>
        <button class="btn btn--primary" type="button" id="import-confirm">${icon('upload')} Validate and import</button>
      </div>`;
    document.body.appendChild(dialog);
    const close = () => {
      dialog.close();
      dialog.remove();
    };
    dialog.querySelectorAll('[data-close]').forEach((btn) => btn.addEventListener('click', close));
    dialog.addEventListener('cancel', () => dialog.remove());

    const fileInput = dialog.querySelector('#import-file');
    const textArea = dialog.querySelector('#import-text');
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      if (file.size > 512 * 1024) {
        dialog.querySelector('#import-feedback').innerHTML = feedback('danger', 'The file is larger than 512 KB.');
        return;
      }
      textArea.value = await file.text();
    });

    dialog.querySelector('#import-confirm').addEventListener('click', async () => {
      const feedbackBox = dialog.querySelector('#import-feedback');
      feedbackBox.innerHTML = '';
      let document_;
      try {
        document_ = JSON.parse(textArea.value);
      } catch {
        feedbackBox.innerHTML = feedback('danger', 'That is not valid JSON.');
        return;
      }
      try {
        const res = await api.post(`/bots/${encodeURIComponent(botId)}/workflows/import`, { document: document_ });
        close();
        toastSuccess(`Imported "${res.workflow.name}".`);
        window.location.hash = `#/bots/${encodeURIComponent(botId)}/workflows/${encodeURIComponent(res.workflow.id)}`;
      } catch (err) {
        const details = err.details?.length
          ? `<ul style="margin:var(--space-1) 0 0;padding-left:1.1rem">${err.details.map((d) => `<li>${escapeHtml(d.field)}: ${escapeHtml(d.message)}</li>`).join('')}</ul>`
          : '';
        feedbackBox.innerHTML = feedback('danger', `${escapeHtml(err.message)}${details}`);
      }
    });
    dialog.showModal();
  }

  container.querySelectorAll('[data-open]').forEach((link) =>
    link.addEventListener('click', () => {
      window.location.hash = `#/bots/${encodeURIComponent(botId)}/workflows/${encodeURIComponent(link.dataset.open)}`;
    }),
  );

  container.querySelectorAll('[data-publish]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const confirmed = await confirmDialog({
        title: 'Publish this workflow?',
        message: 'A validated snapshot becomes the live version for this bot.',
        confirmLabel: 'Publish',
      });
      if (!confirmed) return;
      try {
        const id = btn.dataset.publish;
        await api.post(`/bots/${encodeURIComponent(botId)}/workflows/${encodeURIComponent(id)}/publish`, {});
        toastSuccess('Workflow published.');
        reload();
      } catch (err) {
        if (err.code === 'production_confirmation_required') {
          const ok = await confirmDialog({
            title: 'Production bot',
            message: 'This bot is marked as production. Publish the workflow anyway?',
            confirmLabel: 'Publish to production',
            tone: 'danger',
          });
          if (!ok) return;
          try {
            await api.post(`/bots/${encodeURIComponent(botId)}/workflows/${encodeURIComponent(btn.dataset.publish)}/publish`, {
              confirmProduction: true,
            });
            toastSuccess('Workflow published.');
            reload();
          } catch (inner) {
            toastError(inner.message);
          }
          return;
        }
        if (err.code === 'validation_failed') {
          toastError(`Cannot publish: ${err.details?.[0]?.message || err.message}`);
        } else {
          toastError(err.message);
        }
      }
    }),
  );

  container.querySelectorAll('[data-pause]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const confirmed = await confirmDialog({
        title: 'Pause this workflow?',
        message: 'New Telegram updates will stop executing it. The published version and history are kept.',
        confirmLabel: 'Pause workflow',
        tone: 'danger',
      });
      if (!confirmed) return;
      try {
        await api.post(`/bots/${encodeURIComponent(botId)}/workflows/${encodeURIComponent(btn.dataset.pause)}/pause`, {});
        toastSuccess('Workflow paused.');
        reload();
      } catch (err) {
        toastError(err.message);
      }
    }),
  );

  container.querySelectorAll('[data-resume]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      try {
        await api.post(`/bots/${encodeURIComponent(botId)}/workflows/${encodeURIComponent(btn.dataset.resume)}/resume`, {});
        toastSuccess('Workflow resumed.');
        reload();
      } catch (err) {
        toastError(err.message);
      }
    }),
  );

  container.querySelectorAll('[data-duplicate]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      try {
        await api.post(`/bots/${encodeURIComponent(botId)}/workflows/${encodeURIComponent(btn.dataset.duplicate)}/duplicate`, {});
        toastSuccess('Workflow duplicated as a draft.');
        reload();
      } catch (err) {
        toastError(err.message);
      }
    }),
  );

  container.querySelectorAll('[data-delete]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const workflow = workflows.find((wf) => wf.id === btn.dataset.delete);
      const confirmed = await confirmDialog({
        title: `Delete "${workflow.name}"?`,
        message: 'The workflow, its drafts and version history are removed permanently.',
        confirmLabel: 'Delete workflow',
        tone: 'danger',
        requireText: workflow.name,
      });
      if (!confirmed) return;
      try {
        await api.delete(`/bots/${encodeURIComponent(botId)}/workflows/${encodeURIComponent(workflow.id)}`);
        toastSuccess('Workflow deleted.');
        reload();
      } catch (err) {
        toastError(err.message);
      }
    }),
  );

  container.querySelectorAll('[data-export]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      try {
        const payload = await api.get(`/bots/${encodeURIComponent(botId)}/workflows/${encodeURIComponent(btn.dataset.export)}/export`);
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${(payload.workflow.name || 'workflow').replace(/[^A-Za-z0-9-_ ]/g, '')}.json`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        toastSuccess('Workflow exported.');
      } catch (err) {
        toastError(err.message);
      }
    }),
  );
}

function workflowCard(workflow) {
  const statusTone = STATUS_TONE[workflow.status] || 'neutral';
  return `<article class="card">
    <div class="card__body">
      <div class="row-between" style="align-items:flex-start">
        <div style="min-width:0">
          <div class="row" style="gap:var(--space-2)">
            <h3 class="card__title truncate">${escapeHtml(workflow.name)}</h3>
            <span class="badge badge--${statusTone}">${escapeHtml(workflow.status)}</span>
            ${workflow.hasDraftChanges ? '<span class="badge badge--warning">draft changes</span>' : ''}
          </div>
          <p class="small secondary" style="margin:4px 0 0">${escapeHtml(workflow.summary?.triggerSummary || 'No trigger')}</p>
          <p class="tiny muted" style="margin:2px 0 0">
            ${workflow.summary?.nodeCount || 0} nodes · updated ${escapeHtml(relativeTime(workflow.updatedAt))}
            ${workflow.publishedVersion ? ` · v${workflow.publishedVersion} published ${escapeHtml(relativeTime(workflow.publishedAt))}` : ' · never published'}
          </p>
        </div>
      </div>
    </div>
    <div class="card__footer">
      <div class="row">
        <button class="btn btn--secondary btn--sm" type="button" data-open="${escapeHtml(workflow.id)}">${icon('edit')} Edit</button>
        <a class="btn btn--ghost btn--sm" href="#/bots/${encodeURIComponent(workflow.botId || '')}/simulator?workflow=${encodeURIComponent(workflow.id)}">${icon('flask')} Simulate</a>
      </div>
      <div class="row">
        ${
          workflow.status === 'published'
            ? `<button class="btn btn--ghost btn--sm" type="button" data-pause="${escapeHtml(workflow.id)}">${icon('pause')} Pause</button>`
            : workflow.status === 'paused'
              ? `<button class="btn btn--ghost btn--sm" type="button" data-resume="${escapeHtml(workflow.id)}">${icon('play')} Resume</button>`
              : `<button class="btn btn--ghost btn--sm" type="button" data-publish="${escapeHtml(workflow.id)}">${icon('send')} Publish</button>`
        }
        <button class="btn btn--ghost btn--sm btn--icon" type="button" data-duplicate="${escapeHtml(workflow.id)}" aria-label="Duplicate workflow">${icon('copy')}</button>
        <button class="btn btn--ghost btn--sm btn--icon" type="button" data-export="${escapeHtml(workflow.id)}" aria-label="Export workflow">${icon('download')}</button>
        <button class="btn btn--ghost btn--sm btn--icon" type="button" data-delete="${escapeHtml(workflow.id)}" aria-label="Delete workflow">${icon('trash')}</button>
      </div>
    </div>
  </article>`;
}

function feedback(tone, html) {
  return `<div class="alert alert--${tone} small">
    ${icon(tone === 'danger' ? 'alert' : 'info')}
    <div class="alert__body"><div class="alert__text">${html}</div></div>
  </div>`;
}
