/**
 * Browser-ish environment for UI tests: jsdom + a real HTTP server + a fetch
 * wrapper that resolves relative URLs against the served app.
 */
import http from 'node:http';
import { JSDOM } from 'jsdom';

export async function startTestServer(app) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

export async function createDom(baseUrl) {
  const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', {
    url: `${baseUrl}/`,
    pretendToBeVisual: true,
  });
  const { window } = dom;

  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return false;
    },
  });

  const realFetch = globalThis.fetch;
  const fetchImpl = (input, init) => {
    const url = typeof input === 'string' && input.startsWith('/') ? `${baseUrl}${input}` : input;
    return realFetch(url, init);
  };

  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    navigator: globalThis.navigator,
    fetch: globalThis.fetch,
    localStorage: globalThis.localStorage,
    HTMLElement: globalThis.HTMLElement,
    Event: globalThis.Event,
    CustomEvent: globalThis.CustomEvent,
    Node: globalThis.Node,
  };

  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Node = window.Node;
  globalThis.Event = window.Event;
  globalThis.CustomEvent = window.CustomEvent;
  globalThis.fetch = fetchImpl;
  Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
  Object.defineProperty(globalThis, 'localStorage', { value: window.localStorage, configurable: true });

  // jsdom lacks these dialog APIs; emulate them for the modal component.
  if (!window.HTMLDialogElement?.prototype?.showModal) {
    const proto = window.HTMLDialogElement?.prototype;
    if (proto) {
      proto.showModal = function showModal() {
        this.open = true;
        this.setAttribute('open', '');
      };
      proto.close = function close() {
        this.open = false;
        this.removeAttribute('open');
      };
    }
  }

  return {
    window,
    document: window.document,
    cleanup() {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete globalThis[key];
        else if (key === 'navigator' || key === 'localStorage') {
          Object.defineProperty(globalThis, key, { value, configurable: true });
        } else globalThis[key] = value;
      }
      globalThis.fetch = previous.fetch || realFetch;
      dom.window.close();
    },
  };
}

export function waitFor(predicate, { timeout = 4000, interval = 20, label = 'condition' } = {}) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      try {
        const result = predicate();
        if (result) return resolve(result);
      } catch (err) {
        return reject(err);
      }
      if (Date.now() - started > timeout) return reject(new Error(`Timed out waiting for ${label}`));
      setTimeout(tick, interval);
    };
    tick();
  });
}

export function text(document) {
  return document.body.textContent.replace(/\s+/g, ' ').trim();
}

export function submit(form) {
  form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
}
