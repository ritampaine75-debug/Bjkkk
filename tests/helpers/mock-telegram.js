/**
 * In-process mock of the Telegram Bot API. Records every call so tests can
 * assert on payloads without any real network access.
 */
import { setTelegramTransport } from '../../backend/src/services/telegram-api.js';

export const MOCK_TOKEN = '7654321:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';
export const MOCK_BOT = {
  id: 7654321,
  is_bot: true,
  first_name: 'Mock Bot',
  username: 'mock_bot',
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
};

export function createMockTelegram(options = {}) {
  const calls = [];
  const state = {
    bot: { ...MOCK_BOT, ...(options.bot || {}) },
    validTokens: new Set(options.validTokens || [MOCK_TOKEN]),
    webhookUrl: options.webhookUrl || '',
    commands: [],
    sentMessages: [],
    failNext: null, // { method, status, description }
    latencyMs: options.latencyMs || 0,
  };

  async function transport(url, init = {}) {
    const match = /\/bot([^/]+)\/([A-Za-z]+)(?:\?|$)/.exec(url);
    if (!match) throw new Error(`Unexpected Telegram URL: ${url}`);
    const [, token, method] = match;
    const payload = init.body ? JSON.parse(init.body) : {};
    calls.push({ method, payload, token });

    if (state.latencyMs) await new Promise((r) => setTimeout(r, state.latencyMs));

    if (state.failNext && state.failNext.method === method) {
      const failure = state.failNext;
      state.failNext = null;
      return respond(failure.status || 400, {
        ok: false,
        description: failure.description || 'Bad Request',
        error_code: failure.status || 400,
        ...(failure.retryAfter ? { parameters: { retry_after: failure.retryAfter } } : {}),
      });
    }

    if (!state.validTokens.has(token)) {
      return respond(401, { ok: false, error_code: 401, description: 'Unauthorized' });
    }

    switch (method) {
      case 'getMe':
        return respond(200, { ok: true, result: state.bot });
      case 'getWebhookInfo':
        return respond(200, {
          ok: true,
          result: { url: state.webhookUrl, pending_update_count: 0, has_custom_certificate: false },
        });
      case 'setWebhook':
        state.webhookUrl = payload.url;
        return respond(200, { ok: true, result: true });
      case 'deleteWebhook':
        state.webhookUrl = '';
        return respond(200, { ok: true, result: true });
      case 'setMyCommands':
        state.commands = payload.commands || [];
        return respond(200, { ok: true, result: true });
      case 'getMyCommands':
        return respond(200, { ok: true, result: state.commands });
      case 'deleteMyCommands':
        state.commands = [];
        return respond(200, { ok: true, result: true });
      case 'sendMessage':
      case 'sendPhoto':
      case 'sendDocument': {
        if (payload.chat_id === undefined) {
          return respond(400, { ok: false, error_code: 400, description: 'Bad Request: chat_id is empty' });
        }
        const messageId = state.sentMessages.length + 100;
        const message = {
          message_id: messageId,
          date: Math.floor(Date.now() / 1000),
          chat: { id: payload.chat_id, type: 'private' },
          from: { id: state.bot.id, is_bot: true, username: state.bot.username },
          text: payload.text ?? payload.caption ?? null,
          photo: payload.photo ? [{ file_id: 'photo-mock' }] : undefined,
          document: payload.document ? { file_id: 'doc-mock' } : undefined,
          reply_markup: payload.reply_markup,
        };
        state.sentMessages.push({ method, payload, message });
        return respond(200, { ok: true, result: message });
      }
      case 'editMessageText':
        return respond(200, { ok: true, result: { message_id: payload.message_id || 1, chat: { id: payload.chat_id }, text: payload.text } });
      case 'answerCallbackQuery':
        return respond(200, { ok: true, result: true });
      case 'getChat':
        if (String(payload.chat_id).startsWith('0')) {
          return respond(400, { ok: false, error_code: 400, description: 'Bad Request: chat not found' });
        }
        return respond(200, { ok: true, result: { id: payload.chat_id, type: 'private' } });
      case 'getChatMember':
        return respond(200, { ok: true, result: { status: 'member', user: { id: payload.user_id } } });
      case 'getUpdates':
        return respond(200, { ok: true, result: [] });
      default:
        return respond(404, { ok: false, error_code: 404, description: 'Not Found' });
    }
  }

  function respond(status, body) {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  }

  setTelegramTransport(transport);

  return {
    calls,
    state,
    transport,
    reset() {
      calls.length = 0;
      state.sentMessages.length = 0;
      state.failNext = null;
    },
    callsFor(method) {
      return calls.filter((c) => c.method === method);
    },
    restore() {
      setTelegramTransport(null);
    },
  };
}
