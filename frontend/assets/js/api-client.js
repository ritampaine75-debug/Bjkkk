/**
 * API client for the BotForge backend.
 *
 * Security notes:
 *  - The session token is held in memory and mirrored to localStorage; it is an
 *    application session token, never a Telegram bot token.
 *  - Bot tokens are only ever sent from the connect form directly to the API and
 *    are never stored client side.
 */

const BASE = '/api/v1';
const SESSION_KEY = 'botforge.session';

export class ApiError extends Error {
  constructor(message, { status = 0, code = 'network_error', details = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let sessionToken = null;
let onUnauthorized = null;

export function setSessionToken(token) {
  sessionToken = token || null;
  try {
    if (token) localStorage.setItem(SESSION_KEY, token);
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* storage may be unavailable in private mode - in-memory token still works */
  }
}

export function getSessionToken() {
  if (sessionToken) return sessionToken;
  try {
    sessionToken = localStorage.getItem(SESSION_KEY);
  } catch {
    sessionToken = null;
  }
  return sessionToken;
}

export function clearSessionToken() {
  setSessionToken(null);
}

export function setUnauthorizedHandler(handler) {
  onUnauthorized = handler;
}

async function request(method, path, { body, query, signal, timeoutMs = 30000 } = {}) {
  const url = new URL(`${BASE}${path}`, window.location.origin);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true });

  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = getSessionToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(url.toString(), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
      credentials: 'omit',
      cache: 'no-store',
    });
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      throw new ApiError('The request timed out. Check your connection and try again.', {
        code: 'timeout',
      });
    }
    throw new ApiError('Network error. The server could not be reached.', { code: 'network_error' });
  }
  clearTimeout(timer);

  if (response.status === 204) return null;

  let payload = null;
  const text = await response.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    if (response.status === 401 && onUnauthorized) onUnauthorized();
    const error = payload?.error || {};
    throw new ApiError(error.message || `Request failed (${response.status}).`, {
      status: response.status,
      code: error.code || 'request_failed',
      details: error.details || null,
    });
  }
  return payload;
}

export const api = {
  get: (path, options) => request('GET', path, options),
  post: (path, body, options) => request('POST', path, { body, ...options }),
  put: (path, body, options) => request('PUT', path, { body, ...options }),
  patch: (path, body, options) => request('PATCH', path, { body, ...options }),
  delete: (path, options) => request('DELETE', path, options),
};

export const authApi = {
  config: () => api.get('/auth/config'),
  register: (payload) => api.post('/auth/register', payload),
  login: (payload) => api.post('/auth/login', payload),
  me: () => api.get('/auth/me'),
  updatePreferences: (payload) => api.patch('/auth/me/preferences', payload),
  logout: () => api.post('/auth/logout', {}),
};

export const dashboardApi = {
  summary: () => api.get('/dashboard/summary'),
};

/** Exposed for tests: perform an authenticated request without side effects. */
export { request as _request };
