/**
 * Wraps a live transport with bounded retries for transient Telegram failures.
 *
 * Only retryable conditions are retried (rate limits, timeouts, network
 * errors). Telegram's `retry_after` is honoured but clamped so a single update
 * can never block a worker for an unbounded amount of time.
 */
const RETRYABLE = new Set(['rate_limited', 'timeout', 'network', 'server_error']);

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createRetryingTransport(transport, { maxAttempts = 2, maxDelayMs = 5000, sleep = defaultSleep } = {}) {
  let retries = 0;

  async function withRetry(fn) {
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        return await fn();
      } catch (err) {
        attempt += 1;
        const retryable = RETRYABLE.has(err?.code);
        if (!retryable || attempt >= maxAttempts) throw err;
        retries += 1;
        const requested = Number(err.retryAfter) > 0 ? Number(err.retryAfter) * 1000 : 250 * 2 ** (attempt - 1);
        await sleep(Math.min(requested, maxDelayMs));
      }
    }
  }

  return {
    kind: transport.kind || 'live',
    retries: () => retries,
    sendMessage: (payload) => withRetry(() => transport.sendMessage(payload)),
    sendKeyboard: (payload) => withRetry(() => (transport.sendKeyboard || transport.sendMessage)(payload)),
    sendPhoto: (payload) => withRetry(() => transport.sendPhoto(payload)),
    sendDocument: (payload) => withRetry(() => transport.sendDocument(payload)),
    sendMedia: (payload) => withRetry(() => transport.sendMedia(payload)),
    editMessage: (payload) => withRetry(() => transport.editMessage(payload)),
    answerCallback: (payload) => withRetry(() => transport.answerCallback(payload)),
  };
}
