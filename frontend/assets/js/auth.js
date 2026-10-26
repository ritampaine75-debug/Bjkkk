/**
 * Authentication controller.
 *
 * AUTH_MODE=local    -> email/password against the BotForge API.
 * AUTH_MODE=firebase -> Firebase Authentication web SDK (loaded on demand).
 *
 * In both modes the session is a server-issued/verified credential; bot tokens
 * never touch the browser storage.
 */
import { authApi, setSessionToken, clearSessionToken, setUnauthorizedHandler } from './api-client.js';
import { setState, getState } from './state.js';

let firebaseAuth = null;
let firebaseConfig = null;
let currentUser = null;
let readyPromise = null;

export function getCurrentUser() {
  return currentUser;
}

export async function initAuth() {
  if (readyPromise) return readyPromise;
  readyPromise = (async () => {
    const config = await authApi.config().catch(() => ({ mode: 'local', allowSignup: true }));
    setState({ authMode: config.mode });
    firebaseConfig = config.firebase;

    setUnauthorizedHandler(() => {
      currentUser = null;
      setState({ user: null });
      clearSessionToken();
      window.dispatchEvent(new CustomEvent('botforge:unauthorized'));
    });

    if (config.mode === 'firebase' && firebaseConfig?.apiKey) {
      await initFirebase(firebaseConfig);
      return { mode: 'firebase', config };
    }

    try {
      const { user } = await authApi.me();
      currentUser = user;
      setState({ user });
    } catch {
      currentUser = null;
      setState({ user: null });
    }
    return { mode: 'local', config };
  })();
  setState({ authReady: false });
  const result = await readyPromise;
  setState({ authReady: true });
  return result;
}

async function initFirebase(config) {
  const [{ initializeApp }, { getAuth, onAuthStateChanged }] = await Promise.all([
    import('https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js'),
  ]);
  const app = initializeApp(config);
  firebaseAuth = getAuth(app);
  onAuthStateChanged(firebaseAuth, async (fbUser) => {
    if (!fbUser) {
      currentUser = null;
      setSessionToken(null);
      setState({ user: null });
      return;
    }
    const idToken = await fbUser.getIdToken();
    setSessionToken(idToken);
    const { user } = await authApi.me();
    currentUser = user;
    setState({ user });
    window.dispatchEvent(new CustomEvent('botforge:signed-in', { detail: user }));
  });

  // Synchronously restore an existing Firebase session when possible.
  await firebaseAuth.authStateReady?.();
  if (firebaseAuth.currentUser) {
    const idToken = await firebaseAuth.currentUser.getIdToken();
    setSessionToken(idToken);
    try {
      const { user } = await authApi.me();
      currentUser = user;
      setState({ user });
    } catch {
      currentUser = null;
      setState({ user: null });
    }
  }
}

export async function signIn({ email, password }) {
  if (getState().authMode === 'firebase') {
    if (!firebaseAuth) throw new Error('Firebase authentication is not available.');
    const { signInWithEmailAndPassword } = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js');
    const cred = await signInWithEmailAndPassword(firebaseAuth, email, password);
    const idToken = await cred.user.getIdToken();
    setSessionToken(idToken);
    const { user } = await authApi.me();
    currentUser = user;
    setState({ user });
    return user;
  }
  const { token, user } = await authApi.login({ email, password });
  setSessionToken(token);
  currentUser = user;
  setState({ user });
  return user;
}

export async function signUp({ email, password, displayName }) {
  if (getState().authMode === 'firebase') {
    if (!firebaseAuth) throw new Error('Firebase authentication is not available.');
    const { createUserWithEmailAndPassword, updateProfile } =
      await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js');
    const cred = await createUserWithEmailAndPassword(firebaseAuth, email, password);
    if (displayName) await updateProfile(cred.user, { displayName });
    const idToken = await cred.user.getIdToken();
    setSessionToken(idToken);
    const { user } = await authApi.me();
    currentUser = user;
    setState({ user });
    return user;
  }
  const { token, user } = await authApi.register({ email, password, displayName });
  setSessionToken(token);
  currentUser = user;
  setState({ user });
  return user;
}

export async function signOut() {
  if (getState().authMode === 'firebase' && firebaseAuth) {
    const { signOut: fbSignOut } = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js');
    await fbSignOut(firebaseAuth).catch(() => {});
  } else {
    await authApi.logout().catch(() => {});
  }
  clearSessionToken();
  currentUser = null;
  setState({ user: null, dashboard: null });
}

export async function refreshUser() {
  try {
    const { user } = await authApi.me();
    currentUser = user;
    setState({ user });
    return user;
  } catch {
    return null;
  }
}

/** Only used by automated tests: reset module state between cases. */
export function __resetAuthForTests() {
  readyPromise = null;
  currentUser = null;
  firebaseAuth = null;
}
