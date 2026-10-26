import { icon } from '../utils/icons.js';
import { escapeHtml } from '../utils/dom.js';

let region = null;

function ensureRegion() {
  if (region && document.body.contains(region)) return region;
  region = document.createElement('div');
  region.className = 'toast-region';
  region.setAttribute('role', 'status');
  region.setAttribute('aria-live', 'polite');
  document.body.appendChild(region);
  return region;
}

const ICONS = { success: 'checkCircle', error: 'xCircle', warning: 'alert', info: 'info' };

/**
 * Show a transient message. Never pass secret material as the message body.
 */
export function toast(message, { type = 'info', timeout = 5000 } = {}) {
  const container = ensureRegion();
  const node = document.createElement('div');
  node.className = `toast toast--${type}`;
  node.innerHTML = `${icon(ICONS[type] || 'info')}
    <span class="toast__message">${escapeHtml(message)}</span>
    <button class="toast__close" type="button" aria-label="Dismiss notification">${icon('x', { size: 14 })}</button>`;

  const remove = () => {
    node.remove();
    if (container.childElementCount === 0) container.remove();
  };
  node.querySelector('.toast__close').addEventListener('click', remove);
  container.appendChild(node);
  if (timeout > 0) setTimeout(remove, timeout);
  return remove;
}

export const toastSuccess = (message) => toast(message, { type: 'success' });
export const toastError = (message) => toast(message, { type: 'error', timeout: 7000 });
export const toastWarning = (message) => toast(message, { type: 'warning', timeout: 6500 });
