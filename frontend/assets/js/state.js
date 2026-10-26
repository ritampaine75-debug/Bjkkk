/** Tiny observable application store. */
const listeners = new Set();

const state = {
  user: null,
  authMode: 'local',
  authReady: false,
  theme: 'system',
  bots: [],
  activeBotId: null,
  dashboard: null,
  online: navigator.onLine,
};

export function getState() {
  return state;
}

export function setState(patch) {
  let changed = false;
  for (const [key, value] of Object.entries(patch)) {
    if (state[key] !== value) {
      state[key] = value;
      changed = true;
    }
  }
  if (changed) emit();
  return state;
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit() {
  for (const listener of listeners) {
    try {
      listener(state);
    } catch (err) {
      console.error('state listener failed', err);
    }
  }
}

/* Theme ------------------------------------------------------------------ */
export function resolveTheme(preference) {
  if (preference === 'light' || preference === 'dark') return preference;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(preference) {
  const resolved = resolveTheme(preference);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themePreference = preference;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', resolved === 'dark' ? '#0d1117' : '#f6f7fb');
  return resolved;
}

export function initTheme() {
  let preference = 'system';
  try {
    preference = localStorage.getItem('botforge.theme') || 'system';
  } catch {
    /* ignore */
  }
  state.theme = preference;
  applyTheme(preference);
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
    if (state.theme === 'system') applyTheme('system');
  });
}

export function setThemePreference(preference) {
  state.theme = preference;
  try {
    localStorage.setItem('botforge.theme', preference);
  } catch {
    /* ignore */
  }
  applyTheme(preference);
  emit();
}

window.addEventListener('online', () => setState({ online: true }));
window.addEventListener('offline', () => setState({ online: false }));
