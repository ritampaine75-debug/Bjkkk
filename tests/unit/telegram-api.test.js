import test from 'node:test';
import assert from 'node:assert/strict';
import '../helpers/test-env.js';
import {
  createTelegramClient,
  isPlausibleBotToken,
  parseBotIdentity,
  TelegramError,
} from '../../backend/src/services/telegram-api.js';

function fakeFetch(status, body, { delay = 0, throws = null } = {}) {
  return async (_url, init = {}) => {
    if (delay) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, delay);
        init.signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        });
      });
    }
    if (throws) throw Object.assign(new Error(throws), { name: throws });
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
}

test('token format validation', () => {
  assert.equal(isPlausibleBotToken('123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw'), true);
  assert.equal(isPlausibleBotToken('1234:short'), false);
  assert.equal(isPlausibleBotToken('abcdef:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw'), false);
  assert.equal(isPlausibleBotToken(''), false);
});

test('successful calls return the result and latency', async () => {
  const client = createTelegramClient({
    token: '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw',
    fetchImpl: fakeFetch(200, { ok: true, result: { id: 5, is_bot: true, username: 'demo' } }),
  });
  const { result, latencyMs } = await client.getMe();
  assert.equal(result.username, 'demo');
  assert.equal(typeof latencyMs, 'number');
});

test('401 maps to invalid_token and is not retryable', async () => {
  const client = createTelegramClient({
    token: '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw',
    fetchImpl: fakeFetch(401, { ok: false, description: 'Unauthorized' }),
  });
  await assert.rejects(client.getMe(), (err) => {
    assert.ok(err instanceof TelegramError);
    assert.equal(err.code, 'invalid_token');
    assert.equal(err.retryable, false);
    assert.match(err.message, /Generate a new token/);
    return true;
  });
});

test('429 exposes retry_after and is retryable', async () => {
  const client = createTelegramClient({
    token: '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw',
    fetchImpl: fakeFetch(429, { ok: false, description: 'Too Many Requests', parameters: { retry_after: 7 } }),
  });
  await assert.rejects(client.getMe(), (err) => {
    assert.equal(err.code, 'rate_limited');
    assert.equal(err.retryAfter, 7);
    assert.equal(err.retryable, true);
    return true;
  });
});

test('500 is retryable while 400 is not', async () => {
  const base = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';
  const serverError = createTelegramClient({ token: base, fetchImpl: fakeFetch(500, { ok: false, description: 'Internal' }) });
  await assert.rejects(serverError.getMe(), (err) => err.retryable === true);

  const badRequest = createTelegramClient({ token: base, fetchImpl: fakeFetch(400, { ok: false, description: 'Bad Request: chat not found' }) });
  await assert.rejects(badRequest.sendMessage({ chat_id: 1, text: 'x' }), (err) => {
    assert.equal(err.code, 'chat_not_found');
    assert.equal(err.retryable, false);
    return true;
  });
});

test('403 blocked users are reported distinctly', async () => {
  const client = createTelegramClient({
    token: '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw',
    fetchImpl: fakeFetch(403, { ok: false, description: 'Forbidden: bot was blocked by the user' }),
  });
  await assert.rejects(client.sendMessage({ chat_id: 1, text: 'x' }), (err) => err.code === 'blocked');
});

test('network failures and timeouts are mapped safely', async () => {
  const base = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';
  const network = createTelegramClient({ token: base, fetchImpl: fakeFetch(200, {}, { throws: 'TypeError' }) });
  await assert.rejects(network.getMe(), (err) => err.code === 'network' && err.retryable === true);

  const slow = createTelegramClient({ token: base, fetchImpl: fakeFetch(200, { ok: true, result: {} }, { delay: 100 }), timeoutMs: 10 });
  await assert.rejects(slow.getMe(), (err) => err.code === 'timeout');
});

test('plaintext bot tokens never appear in error objects', async () => {
  const token = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';
  const client = createTelegramClient({ token, fetchImpl: fakeFetch(401, { ok: false, description: 'Unauthorized' }) });
  try {
    await client.getMe();
  } catch (err) {
    const serialised = JSON.stringify(err.toJSON());
    assert.equal(serialised.includes('AAHdqTcv'), false);
    assert.equal(err.message.includes(token), false);
  }
});

test('getMe payload validation rejects unexpected shapes', () => {
  assert.throws(() => parseBotIdentity(null), /unexpected bot profile/);
  assert.throws(() => parseBotIdentity({ id: 1 }), /unexpected bot profile/);
  const identity = parseBotIdentity({ id: 12, is_bot: true, username: 'x_bot', first_name: 'X' });
  assert.deepEqual(identity.id, '12');
  assert.equal(identity.username, 'x_bot');
  assert.equal(identity.canJoinGroups, null);
});

test('non-HTTPS API base URLs are refused', () => {
  assert.throws(
    () => createTelegramClient({ token: '1:abc', baseUrl: 'http://api.telegram.org' }),
    /must use HTTPS/,
  );
});
