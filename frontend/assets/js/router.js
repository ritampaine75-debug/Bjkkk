/**
 * Hash based router. Hash routing keeps the app deployable on any static host
 * (Firebase Hosting, GitHub Pages, plain S3) with no rewrite rules.
 */
import { getState } from './state.js';

const routes = [];
let notFoundHandler = null;
let currentPath = null;

export function route(pattern, handler, options = {}) {
  routes.push({ pattern, handler, ...options });
}

export function setNotFound(handler) {
  notFoundHandler = handler;
}

function matchRoute(path) {
  const segments = path.split('/').filter(Boolean);
  for (const entry of routes) {
    const patternSegments = entry.pattern.split('/').filter(Boolean);
    if (patternSegments.length !== segments.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < patternSegments.length; i += 1) {
      const p = patternSegments[i];
      const s = segments[i];
      if (p.startsWith(':')) {
        params[p.slice(1)] = decodeURIComponent(s);
      } else if (p !== s) {
        ok = false;
        break;
      }
    }
    if (ok) return { entry, params };
  }
  return null;
}

export function currentRoute() {
  return currentPath;
}

export function navigate(path, { replace = false } = {}) {
  const target = path.startsWith('#') ? path : `#${path}`;
  if (replace) window.location.replace(target);
  else window.location.hash = target;
}

export async function handleRoute({ container, onBeforeRender } = {}) {
  const raw = window.location.hash.replace(/^#/, '') || '/dashboard';
  const [pathPart, queryPart] = raw.split('?');
  const path = pathPart.startsWith('/') ? pathPart : `/${pathPart}`;
  const query = Object.fromEntries(new URLSearchParams(queryPart || ''));

  if (path === currentPath && container?.dataset.rendered === 'true') return;
  currentPath = path;

  const match = matchRoute(path);
  if (!match) {
    if (notFoundHandler) await notFoundHandler({ container, path });
    return;
  }
  if (match.entry.requiresAuth && !getState().user) {
    navigate('/login', { replace: true });
    return;
  }
  try {
    if (onBeforeRender) onBeforeRender(path);
    await match.entry.handler({ container, params: match.params, query, path });
    if (container) container.dataset.rendered = 'true';
  } catch (err) {
    console.error('route handler failed', err);
    if (container) {
      const { renderErrorState } = await import('./components/states.js');
      renderErrorState(container, err);
    }
  }
}

export function startRouter(options) {
  window.addEventListener('hashchange', () => handleRoute(options));
  return handleRoute(options);
}
