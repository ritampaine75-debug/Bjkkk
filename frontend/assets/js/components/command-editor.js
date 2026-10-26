/**
 * Command editor dialog: name, description, reply text, inline keyboard builder
 * and a live preview of what Telegram will render.
 */
import { escapeHtml } from '../utils/dom.js';
import { icon } from '../utils/icons.js';
import { api } from '../api-client.js';
import { toastSuccess, toastError } from '../components/toast.js';

let dialog = null;

export function openCommandEditor({ botId, command = null, workflows = [], onSaved }) {
  if (dialog) {
    dialog.remove();
    dialog = null;
  }
  const state = {
    id: command?.id || undefined,
    name: command?.name || '',
    description: command?.description || '',
    enabled: command?.enabled ?? true,
    replyText: command?.reply?.text || '',
    parseMode: command?.reply?.parseMode || 'plain',
    disablePreview: command?.reply?.disablePreview === true,
    workflowId: command?.workflowId || '',
    rows: command?.keyboard?.rows?.length
      ? command.keyboard.rows.map((row) => row.map((b) => ({ ...b })))
      : [],
    restrictedToUserIds: (command?.access?.restrictedToUserIds || []).join(', '),
    blockedUserIds: (command?.access?.blockedUserIds || []).join(', '),
  };

  dialog = document.createElement('dialog');
  dialog.className = 'modal';
  dialog.style.width = 'min(760px, calc(100vw - 2 * var(--space-4)))';
  document.body.appendChild(dialog);

  const draw = () => {
    dialog.innerHTML = `
      <form method="dialog" id="command-form" novalidate>
        <div class="modal__header">
          <div>
            <h2 class="card__title">${state.id ? 'Edit command' : 'New command'}</h2>
            <p class="card__subtitle">Telegram command menus and BotForge replies are separate: saving here does not change Telegram until you sync.</p>
          </div>
          <button class="icon-btn" type="button" data-close aria-label="Close dialog">${icon('x')}</button>
        </div>
        <div class="modal__body">
          <div class="split-2" style="grid-template-columns:minmax(0,1fr);gap:var(--space-4)">
            <div>
              <div class="field">
                <label class="field__label" for="cmd-name">Command</label>
                <div class="input-group">
                  <span class="input" style="flex:none;display:flex;align-items:center;background:var(--bg-inset);color:var(--text-muted)">/</span>
                  <input class="input input--mono" id="cmd-name" value="${escapeHtml(state.name)}" maxlength="32"
                    pattern="[a-z0-9_]{1,32}" placeholder="start" autocomplete="off" spellcheck="false" />
                </div>
                <p class="field__hint">Lowercase letters, digits and underscores only. 1-32 characters.</p>
              </div>

              <div class="field">
                <label class="field__label" for="cmd-description">Menu description</label>
                <input class="input" id="cmd-description" maxlength="256" value="${escapeHtml(state.description)}"
                  placeholder="Show the welcome menu" />
                <p class="field__hint">Shown in Telegram's command menu. 256 character limit.</p>
              </div>

              <div class="field">
                <label class="field__label" for="cmd-reply">Reply text</label>
                <textarea class="textarea" id="cmd-reply" rows="5" maxlength="4096"
                  placeholder="Welcome to BotForge Demo Bot.">${escapeHtml(state.replyText)}</textarea>
                <p class="field__hint"><span id="reply-count">${state.replyText.length}</span>/4096 characters</p>
              </div>

              <div class="row" style="gap:var(--space-4)">
                <div class="field" style="flex:1 1 180px;margin-bottom:0">
                  <label class="field__label" for="cmd-parse">Formatting</label>
                  <div class="select-wrap">
                    <select class="select" id="cmd-parse">
                      <option value="plain" ${state.parseMode === 'plain' ? 'selected' : ''}>Plain text</option>
                      <option value="HTML" ${state.parseMode === 'HTML' ? 'selected' : ''}>HTML</option>
                      <option value="MarkdownV2" ${state.parseMode === 'MarkdownV2' ? 'selected' : ''}>MarkdownV2</option>
                    </select>
                  </div>
                </div>
                <label class="switch" style="margin-top:var(--space-5)">
                  <input type="checkbox" id="cmd-preview" ${state.disablePreview ? 'checked' : ''} />
                  <span class="switch__track"></span>
                  <span>Disable link preview</span>
                </label>
              </div>

              <div class="field" style="margin-top:var(--space-4)">
                <label class="field__label" for="cmd-workflow">Automation</label>
                <div class="select-wrap">
                  <select class="select" id="cmd-workflow">
                    <option value="">Respond with the reply text only</option>
                    ${workflows
                      .map(
                        (wf) =>
                          `<option value="${escapeHtml(wf.id)}" ${state.workflowId === wf.id ? 'selected' : ''}>Run workflow: ${escapeHtml(wf.name)}</option>`,
                      )
                      .join('')}
                  </select>
                </div>
                <p class="field__hint">When a workflow is linked, a matching update executes it instead of the static reply.</p>
              </div>

              <fieldset class="field" style="border:1px solid var(--border);border-radius:var(--radius-md);padding:var(--space-3)">
                <legend class="field__label">Inline keyboard</legend>
                <div id="keyboard-rows" class="stack-sm">
                  ${
                    state.rows.length === 0
                      ? '<p class="field__hint" id="keyboard-empty">No buttons yet. Add a row to build an inline keyboard.</p>'
                      : state.rows.map((row, rowIndex) => keyboardRow(row, rowIndex)).join('')
                  }
                </div>
                <div class="row" style="margin-top:var(--space-3)">
                  <button class="btn btn--secondary btn--sm" type="button" id="add-row">${icon('plus')} Add row</button>
                </div>
                <p class="field__hint">Callback buttons send their value to BotForge when tapped. URL buttons open a link.</p>
              </fieldset>

              <details class="card" style="box-shadow:none">
                <summary style="padding:var(--space-3);cursor:pointer;font-weight:600;font-size:var(--fs-sm)">Access restrictions (advanced)</summary>
                <div class="card__body stack-sm">
                  <div class="field" style="margin:0">
                    <label class="field__label" for="cmd-restricted">Only these Telegram user IDs</label>
                    <input class="input input--mono" id="cmd-restricted" value="${escapeHtml(state.restrictedToUserIds)}"
                      placeholder="123456789, 987654321" />
                    <p class="field__hint">Comma separated. Empty means everyone can use the command.</p>
                  </div>
                  <div class="field" style="margin:0">
                    <label class="field__label" for="cmd-blocked">Blocked Telegram user IDs</label>
                    <input class="input input--mono" id="cmd-blocked" value="${escapeHtml(state.blockedUserIds)}" placeholder="55555555" />
                  </div>
                </div>
              </details>

              <label class="checkbox" for="cmd-enabled" style="margin-top:var(--space-4)">
                <input type="checkbox" id="cmd-enabled" ${state.enabled ? 'checked' : ''} />
                <span class="checkbox__text">Command is enabled and answers updates</span>
              </label>
            </div>

            <aside>
              <div class="card" style="box-shadow:none;background:var(--bg-inset)">
                <div class="card__header" style="padding:var(--space-3) var(--space-3) 0">
                  <h3 class="card__title" style="font-size:var(--fs-sm)">${icon('message')} Telegram preview</h3>
                </div>
                <div class="card__body" style="padding:var(--space-3)">
                  <div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:12px;padding:var(--space-3);max-width:320px">
                    <div id="preview-text" style="white-space:pre-wrap;word-break:break-word;font-size:var(--fs-sm)">${
                      escapeHtml(state.replyText || 'Your reply text will appear here.')
                    }</div>
                    <div id="preview-keyboard" class="stack-sm" style="margin-top:var(--space-2)">
                      ${previewKeyboard(state.rows)}
                    </div>
                  </div>
                  <p class="field__hint" style="margin-top:var(--space-2)">Approximate rendering. Telegram applies its own styling.</p>
                </div>
              </div>
              <div id="command-errors" role="alert" aria-live="assertive" style="margin-top:var(--space-3)"></div>
            </aside>
          </div>
        </div>
        <div class="modal__footer">
          <button class="btn btn--secondary" type="button" data-close>Cancel</button>
          <button class="btn btn--primary" type="submit" id="save-command">${icon('save')} ${state.id ? 'Save changes' : 'Create command'}</button>
        </div>
      </form>`;

    bind();
  };

  function bind() {
    const nameInput = dialog.querySelector('#cmd-name');
    const reply = dialog.querySelector('#cmd-reply');
    const counter = dialog.querySelector('#reply-count');

    dialog.querySelectorAll('[data-close]').forEach((btn) => btn.addEventListener('click', () => close()));
    dialog.querySelector('#cmd-name').addEventListener('input', (e) => {
      state.name = e.target.value;
    });
    dialog.querySelector('#cmd-description').addEventListener('input', (e) => {
      state.description = e.target.value;
    });
    reply.addEventListener('input', (e) => {
      state.replyText = e.target.value;
      counter.textContent = String(e.target.value.length);
      updatePreview();
    });
    dialog.querySelector('#cmd-parse').addEventListener('change', (e) => {
      state.parseMode = e.target.value;
    });
    dialog.querySelector('#cmd-preview').addEventListener('change', (e) => {
      state.disablePreview = e.target.checked;
    });
    dialog.querySelector('#cmd-workflow').addEventListener('change', (e) => {
      state.workflowId = e.target.value;
    });
    dialog.querySelector('#cmd-enabled').addEventListener('change', (e) => {
      state.enabled = e.target.checked;
    });
    dialog.querySelector('#cmd-restricted').addEventListener('input', (e) => {
      state.restrictedToUserIds = e.target.value;
    });
    dialog.querySelector('#cmd-blocked').addEventListener('input', (e) => {
      state.blockedUserIds = e.target.value;
    });

    dialog.querySelector('#add-row').addEventListener('click', () => {
      state.rows.push([{ text: '', type: 'callback', value: '' }]);
      redrawRows();
    });

    // Delegated listeners for the keyboard builder rows, which are re-rendered
    // on every change. Attaching them once avoids duplicate handlers.
    dialog.addEventListener('click', (event) => {
      const removeRow = event.target.closest('[data-remove-row]');
      if (removeRow) {
        state.rows.splice(Number(removeRow.dataset.removeRow), 1);
        redrawRows();
        return;
      }
      const addButton = event.target.closest('[data-add-button]');
      if (addButton) {
        state.rows[Number(addButton.dataset.addButton)].push({ text: '', type: 'callback', value: '' });
        redrawRows();
        return;
      }
      const removeButton = event.target.closest('[data-remove-button]');
      if (removeButton) {
        const [rowIndex, buttonIndex] = removeButton.dataset.removeButton.split(':').map(Number);
        state.rows[rowIndex].splice(buttonIndex, 1);
        if (state.rows[rowIndex].length === 0) state.rows.splice(rowIndex, 1);
        redrawRows();
      }
    });
    dialog.addEventListener('input', (event) => {
      const field = event.target.dataset?.buttonField;
      if (!field) return;
      const [rowIndex, buttonIndex, key] = field.split(':');
      state.rows[Number(rowIndex)][Number(buttonIndex)][key] = event.target.value;
      updatePreview();
    });
    dialog.addEventListener('change', (event) => {
      const field = event.target.dataset?.buttonField;
      if (!field || !field.endsWith(':type')) return;
      const [rowIndex, buttonIndex, key] = field.split(':');
      state.rows[Number(rowIndex)][Number(buttonIndex)][key] = event.target.value;
      updatePreview();
    });

    dialog.querySelector('#command-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      await save();
    });
    nameInput.focus();
  }

  function redrawRows() {
    const container = dialog.querySelector('#keyboard-rows');
    container.innerHTML =
      state.rows.length === 0
        ? '<p class="field__hint" id="keyboard-empty">No buttons yet. Add a row to build an inline keyboard.</p>'
        : state.rows.map((row, index) => keyboardRow(row, index)).join('');
    updatePreview();
  }

  function updatePreview() {
    const text = dialog.querySelector('#preview-text');
    const keyboard = dialog.querySelector('#preview-keyboard');
    if (text) text.textContent = state.replyText || 'Your reply text will appear here.';
    if (keyboard) keyboard.innerHTML = previewKeyboard(state.rows);
  }

  function close() {
    dialog.close();
    dialog.remove();
    dialog = null;
  }

  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) close();
  });
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    close();
  });

  async function save() {
    const errorBox = dialog.querySelector('#command-errors');
    errorBox.innerHTML = '';
    const payload = {
      id: state.id,
      name: state.name.trim(),
      description: state.description.trim(),
      enabled: state.enabled,
      reply: {
        text: state.replyText,
        parseMode: state.parseMode,
        disablePreview: state.disablePreview,
      },
      workflowId: state.workflowId || null,
      keyboard: {
        rows: state.rows
          .filter((row) => row.length > 0)
          .map((row) =>
            row.filter((button) => button.text.trim() || button.value.trim()).map((button) => ({
              text: button.text.trim(),
              type: button.type === 'url' ? 'url' : 'callback',
              value: button.value.trim(),
            })),
          )
          .filter((row) => row.length > 0),
      },
      access: {
        restrictedToUserIds: splitIds(state.restrictedToUserIds),
        blockedUserIds: splitIds(state.blockedUserIds),
      },
    };

    if (!payload.name) {
      errorBox.innerHTML = errorHtml([{ message: 'A command name is required.' }]);
      return;
    }

    const button = dialog.querySelector('#save-command');
    button.disabled = true;
    button.innerHTML = `${icon('refresh')} Saving…`;
    try {
      const result = await api.post(`/bots/${encodeURIComponent(botId)}/commands`, payload);
      toastSuccess(`Saved /${result.command.name}.`);
      close();
      onSaved?.(result);
    } catch (err) {
      errorBox.innerHTML = errorHtml(err.details || [{ message: err.message }]);
      button.disabled = false;
      button.innerHTML = `${icon('save')} Save`;
    }
  }

  draw();
  dialog.showModal();
  return dialog;
}

function splitIds(value) {
  return String(value || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

function keyboardRow(row, rowIndex) {
  return `<div style="border:1px solid var(--border);border-radius:var(--radius-sm);padding:var(--space-2);background:var(--bg-inset)">
    <div class="row-between" style="margin-bottom:var(--space-2)">
      <span class="tiny muted">Row ${rowIndex + 1}</span>
      <div class="row">
        <button class="btn btn--ghost btn--sm" type="button" data-add-button="${rowIndex}">${icon('plus')} Button</button>
        <button class="btn btn--ghost btn--sm" type="button" data-remove-row="${rowIndex}" aria-label="Remove row ${rowIndex + 1}">${icon('trash')}</button>
      </div>
    </div>
    <div class="stack-sm">
      ${row
        .map(
          (button, buttonIndex) => `
        <div class="row" style="gap:var(--space-2);align-items:flex-start;flex-wrap:nowrap">
          <input class="input" style="flex:1 1 40%;min-width:0" placeholder="Label"
            value="${escapeHtml(button.text)}" aria-label="Button label"
            data-button-field="${rowIndex}:${buttonIndex}:text" />
          <div class="select-wrap" style="flex:0 0 110px">
            <select class="select" data-button-field="${rowIndex}:${buttonIndex}:type" aria-label="Button type">
              <option value="callback" ${button.type !== 'url' ? 'selected' : ''}>Callback</option>
              <option value="url" ${button.type === 'url' ? 'selected' : ''}>URL</option>
            </select>
          </div>
          <input class="input input--mono" style="flex:1 1 40%;min-width:0" placeholder="callback data or https://…"
            value="${escapeHtml(button.value)}" aria-label="Button value"
            data-button-field="${rowIndex}:${buttonIndex}:value" />
          <button class="icon-btn" type="button" data-remove-button="${rowIndex}:${buttonIndex}" aria-label="Remove button">${icon('x')}</button>
        </div>`,
        )
        .join('')}
    </div>
  </div>`;
}

function previewKeyboard(rows) {
  return rows
    .filter((row) => row.length > 0)
    .map(
      (row) =>
        `<div style="display:grid;grid-template-columns:repeat(${row.length},minmax(0,1fr));gap:4px">
          ${row
            .map(
              (button) =>
                `<span style="display:block;text-align:center;padding:6px 4px;border-radius:6px;background:var(--bg-sunken);
                  border:1px solid var(--border);font-size:var(--fs-xs);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                  ${escapeHtml(button.text || 'Button')}${button.type === 'url' ? ' ↗' : ''}</span>`,
            )
            .join('')}
        </div>`,
    )
    .join('');
}

function errorHtml(details) {
  return `<div class="alert alert--danger small">
    ${icon('alert')}
    <div class="alert__body">
      <div class="alert__title">Could not save the command</div>
      <ul style="margin:var(--space-1) 0 0;padding-left:1.1rem">
        ${details.map((d) => `<li>${escapeHtml(d.message)}</li>`).join('')}
      </ul>
    </div>
  </div>`;
}

export { toastError };
