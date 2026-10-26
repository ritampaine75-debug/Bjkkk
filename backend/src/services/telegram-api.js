/**
 * Minimal, dependency-free Telegram Bot API client.
 *
 * - Never logs or echoes the bot token (requests are built from a token that is
 *   only interpolated into the URL, and errors are mapped to safe summaries).
 * - Every call has a timeout so a hung connection cannot stall a worker.
 * - Transient failures (429, network, 5xx) are surfaced with retry metadata so
 *   callers can decide whether a retry is appropriate.
 */
import config from '../config.js';
import { AppError } from '../utils/errors.js';

export class TelegramError extends Error {
  constructor(message, { code = 'telegram_error', status = 0, retryAfter = null, method = null, retryable = false } = {}) {
    super(message);
    this.name = 'TelegramError';
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
    this.method = method;
    this.retryable = retryable;
  }

  /** Safe serialisable form for logs and API responses. */
  toJSON() {
    return {
      code: this.code,
      message: this.message,
      method: this.method,
      status: this.status || undefined,
      retryAfter: this.retryAfter || undefined,
    };
  }
}

const SAFE_MESSAGES = {
  invalid_token: 'Telegram rejected the bot token. Generate a new token in BotFather and connect again.',
  unauthorized: 'Telegram rejected the bot token. Generate a new token in BotFather and connect again.',
  not_found: 'Telegram could not find that chat or message.',
  forbidden: 'The bot is not allowed to perform this action. Check that it is a member of the chat and has permission.',
  chat_not_found: 'The chat was not found. Verify the chat ID and make sure the user has started the bot.',
  blocked: 'The user has blocked this bot, so the message could not be delivered.',
  rate_limited: 'Telegram is rate limiting this bot. The request will be retried later.',
  bad_payload: 'Telegram rejected the request payload. Check the message content and formatting.',
  network: 'Could not reach the Telegram Bot API. Check the server network connection.',
  timeout: 'The Telegram Bot API did not respond in time.',
  api_error: 'The Telegram Bot API returned an error.',
  disabled: 'This bot connection has been revoked. Reconnect the bot to continue.',
};

function mapErrorStatus(status, description = '') {
  const text = String(description).toLowerCase();
  if (status === 401) return 'invalid_token';
  if (status === 403) {
    if (text.includes('blocked')) return 'blocked';
    if (text.includes('chat not found')) return 'chat_not_found';
    return 'forbidden';
  }
  if (status === 400) {
    if (text.includes('chat not found')) return 'chat_not_found';
    if (text.includes('message is not modified')) return 'not_modified';
    return 'bad_payload';
  }
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'api_error';
  return 'api_error';
}

let transport = (url, init) => globalThis.fetch(url, init);

/**
 * Override the HTTP transport used for every Telegram call. Used by automated
 * tests and by the simulator - never by the browser.
 */
export function setTelegramTransport(next) {
  transport = typeof next === 'function' ? next : (url, init) => globalThis.fetch(url, init);
}

export function getTelegramTransport() {
  return transport;
}

export function createTelegramClient({
  token,
  fetchImpl = transport,
  baseUrl = config.telegram.apiBaseUrl,
  timeoutMs = config.telegram.timeoutMs,
  userAgent = 'BotForgeStudio/1.0',
} = {}) {
  if (!token) throw new TelegramError('A bot token is required.', { code: 'invalid_token' });
  if (!/^https:\/\//.test(baseUrl)) {
    throw new TelegramError('The Telegram API base URL must use HTTPS.', { code: 'insecure_endpoint' });
  }

  const endpoint = (method) => `${baseUrl}/bot${token}/${method}`;

  async function call(method, payload = {}, { timeout = timeoutMs } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const startedAt = Date.now();
    let response;
    try {
      response = await fetchImpl(endpoint(method), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': userAgent },
        body: JSON.stringify(payload ?? {}),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') {
        throw new TelegramError(SAFE_MESSAGES.timeout, {
          code: 'timeout',
          method,
          retryable: true,
        });
      }
      throw new TelegramError(SAFE_MESSAGES.network, { code: 'network', method, retryable: true });
    }
    clearTimeout(timer);

    let body = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }

    if (!response.ok || body?.ok === false) {
      const code = mapErrorStatus(response.status, body?.description);
      const retryAfter = body?.parameters?.retry_after ?? null;
      throw new TelegramError(SAFE_MESSAGES[code] || SAFE_MESSAGES.api_error, {
        code,
        status: response.status,
        retryAfter,
        method,
        retryable: code === 'rate_limited' || response.status >= 500,
      });
    }

    return { result: body?.result, latencyMs: Date.now() - startedAt };
  }

  return {
    call,
    getMe: () => call('getMe'),
    getWebhookInfo: () => call('getWebhookInfo'),
    setWebhook: (url, options = {}) => call('setWebhook', { url, ...options }),
    deleteWebhook: () => call('deleteWebhook', { drop_pending_updates: false }),
    getMyCommands: (scope) => call('getMyCommands', scope ? { scope } : {}),
    setMyCommands: (commands, scope) => call('setMyCommands', scope ? { commands, scope } : { commands }),
    deleteMyCommands: (scope) => call('deleteMyCommands', scope ? { scope } : {}),
    sendMessage: (payload) => call('sendMessage', payload),
    sendPhoto: (payload) => call('sendPhoto', payload),
    sendDocument: (payload) => call('sendDocument', payload),
    editMessageText: (payload) => call('editMessageText', payload),
    answerCallbackQuery: (payload) => call('answerCallbackQuery', payload),
    getChat: (chatId) => call('getChat', { chat_id: chatId }),
    getUpdates: (options = {}) => call('getUpdates', options),
    getChatMember: (chatId, userId) => call('getChatMember', { chat_id: chatId, user_id: userId }),
    // The token is intentionally not exposed on the returned object.
  };
}

/** True when a token string matches Telegram's documented format. */
export function isPlausibleBotToken(token) {
  return typeof token === 'string' && /^\d{5,15}:[A-Za-z0-9_-]{20,64}$/.test(token.trim());
}

/** Validate the shape of a getMe result before trusting it. */
export function parseBotIdentity(result) {
  if (!result || typeof result !== 'object' || result.is_bot !== true || result.id === undefined) {
    throw new TelegramError('Telegram returned an unexpected bot profile.', { code: 'api_error' });
  }
  return {
    id: String(result.id),
    username: result.username || null,
    firstName: result.first_name || null,
    lastName: result.last_name || null,
    canJoinGroups: result.can_join_groups ?? null,
    canReadAllGroupMessages: result.can_read_all_group_messages ?? null,
    supportsInlineQueries: result.supports_inline_queries ?? null,
    canConnectToBusiness: result.can_connect_to_business ?? null,
    hasMainWebApp: result.has_main_web_app ?? null,
  };
}

/**
 * Convert a TelegramError into a safe AppError for API responses.
 * Status codes are chosen so clients can distinguish retryable failures.
 */
export function telegramErrorToAppError(err, { fallbackStatus = 502 } = {}) {
  if (!(err instanceof TelegramError)) return err;
  const status =
    err.code === 'invalid_token'
      ? 422
      : err.code === 'rate_limited'
        ? 429
        : err.code === 'chat_not_found' || err.code === 'bad_payload' || err.code === 'blocked' || err.code === 'forbidden'
          ? 422
          : fallbackStatus;
  const appError = new AppError(err.message, { status, code: err.code, details: err.retryAfter ? { retryAfter: err.retryAfter } : null });
  appError.telegramMethod = err.method;
  return appError;
}
