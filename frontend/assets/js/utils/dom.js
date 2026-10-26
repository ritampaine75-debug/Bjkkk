/** Small DOM helpers shared by every page. No framework required. */

export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Tagged template that escapes every interpolated value unless wrapped in raw(). */
export function html(strings, ...values) {
  return strings.reduce((out, str, i) => {
    const value = values[i - 1];
    const rendered = value && value.__raw ? value.value : Array.isArray(value) ? value.map(render).join('') : render(value);
    return out + rendered + str;
  });
}

function render(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object' && value.__raw) return value.value;
  if (Array.isArray(value)) return value.map(render).join('');
  return escapeHtml(value);
}

export function raw(value) {
  return { __raw: true, value: value == null ? '' : String(value) };
}

export function qs(selector, root = document) {
  return root.querySelector(selector);
}

export function qsa(selector, root = document) {
  return [...root.querySelectorAll(selector)];
}

export function on(target, event, selectorOrHandler, maybeHandler) {
  const handler = typeof selectorOrHandler === 'function' ? selectorOrHandler : maybeHandler;
  const selector = typeof selectorOrHandler === 'string' ? selectorOrHandler : null;
  target.addEventListener(event, (e) => {
    if (!selector) return handler(e);
    const match = e.target.closest(selector);
    if (match && target.contains(match)) handler(e, match);
  });
}

export function setHtml(node, markup) {
  if (!node) return;
  node.innerHTML = markup;
}

export function formatDate(iso, { withTime = true } = {}) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const opts = withTime
    ? { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { year: 'numeric', month: 'short', day: 'numeric' };
  return date.toLocaleString(undefined, opts);
}

export function relativeTime(iso) {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const diff = Date.now() - then;
  const abs = Math.abs(diff);
  const units = [
    ['year', 31536000000],
    ['month', 2592000000],
    ['day', 86400000],
    ['hour', 3600000],
    ['minute', 60000],
    ['second', 1000],
  ];
  for (const [unit, ms] of units) {
    if (abs >= ms || unit === 'second') {
      const value = Math.round(diff / ms);
      const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
      return rtf.format(-value, unit);
    }
  }
  return '—';
}

export function formatDuration(ms) {
  if (ms === null || ms === undefined || Number.isNaN(Number(ms))) return '—';
  const value = Number(ms);
  if (value < 1000) return `${Math.round(value)} ms`;
  if (value < 60000) return `${(value / 1000).toFixed(1)} s`;
  return `${Math.floor(value / 60000)}m ${Math.round((value % 60000) / 1000)}s`;
}

export function debounce(fn, wait = 250) {
  let timer = null;
  const debounced = (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, wait);
  };
  debounced.cancel = () => timer && clearTimeout(timer);
  return debounced;
}

export function truncate(text, max = 80) {
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function initials(name) {
  if (!name) return '?';
  const parts = String(name).trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() || '').join('') || '?';
}

export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
