import { icon } from '../utils/icons.js';
import { escapeHtml } from '../utils/dom.js';

function createDialog() {
  const dialog = document.createElement('dialog');
  dialog.className = 'modal';
  document.body.appendChild(dialog);
  return dialog;
}

/**
 * Promise-based confirmation dialog. Destructive actions must use this.
 * Resolves true when confirmed.
 */
export function confirmDialog({
  title = 'Are you sure?',
  message = '',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'primary', // 'primary' | 'danger'
  requireText = null,
} = {}) {
  return new Promise((resolve) => {
    const dialog = createDialog();
    dialog.innerHTML = `
      <form method="dialog">
        <div class="modal__header">
          <div>
            <h2 id="modal-title" class="card__title">${escapeHtml(title)}</h2>
          </div>
          <button class="icon-btn" type="button" data-close aria-label="Close dialog">${icon('x')}</button>
        </div>
        <div class="modal__body">
          <p class="secondary">${escapeHtml(message)}</p>
          ${
            requireText
              ? `<div class="field">
                   <label class="field__label" for="modal-confirm-text">Type <code>${escapeHtml(requireText)}</code> to confirm</label>
                   <input class="input" id="modal-confirm-text" autocomplete="off" spellcheck="false" />
                 </div>`
              : ''
          }
        </div>
        <div class="modal__footer">
          <button class="btn btn--secondary" value="cancel" type="button" data-close>${escapeHtml(cancelLabel)}</button>
          <button class="btn ${tone === 'danger' ? 'btn--danger' : 'btn--primary'}" id="modal-confirm" value="confirm" type="submit"
            ${requireText ? 'disabled' : ''}>${escapeHtml(confirmLabel)}</button>
        </div>
      </form>`;

    const confirmBtn = dialog.querySelector('#modal-confirm');
    const textInput = dialog.querySelector('#modal-confirm-text');

    if (textInput) {
      textInput.addEventListener('input', () => {
        confirmBtn.disabled = textInput.value.trim() !== requireText;
      });
    }

    const close = (result) => {
      dialog.close();
      dialog.remove();
      resolve(result);
    };

    dialog.querySelectorAll('[data-close]').forEach((btn) => btn.addEventListener('click', () => close(false)));
    dialog.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      close(true);
    });
    dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      close(false);
    });
    dialog.addEventListener('click', (e) => {
      // Backdrop click closes the dialog.
      if (e.target === dialog) close(false);
    });

    dialog.showModal();
    setTimeout(() => (textInput || confirmBtn).focus(), 50);
  });
}

/** Simple prompt dialog returning the entered string or null. */
export function promptDialog({ title = 'Enter a value', label = 'Value', value = '', maxLength = 200, description = '' } = {}) {
  return new Promise((resolve) => {
    const dialog = createDialog();
    dialog.innerHTML = `
      <form method="dialog">
        <div class="modal__header">
          <h2 class="card__title">${escapeHtml(title)}</h2>
          <button class="icon-btn" type="button" data-close aria-label="Close dialog">${icon('x')}</button>
        </div>
        <div class="modal__body">
          ${description ? `<p class="secondary small">${escapeHtml(description)}</p>` : ''}
          <div class="field">
            <label class="field__label" for="prompt-input">${escapeHtml(label)}</label>
            <input class="input" id="prompt-input" value="${escapeHtml(value)}" maxlength="${Number(maxLength)}" required />
          </div>
        </div>
        <div class="modal__footer">
          <button class="btn btn--secondary" type="button" data-close>Cancel</button>
          <button class="btn btn--primary" type="submit">Save</button>
        </div>
      </form>`;

    const input = dialog.querySelector('#prompt-input');
    const close = (result) => {
      dialog.close();
      dialog.remove();
      resolve(result);
    };
    dialog.querySelectorAll('[data-close]').forEach((btn) => btn.addEventListener('click', () => close(null)));
    dialog.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      const v = input.value.trim();
      close(v || null);
    });
    dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      close(null);
    });
    dialog.showModal();
    setTimeout(() => {
      input.focus();
      input.select();
    }, 50);
  });
}
