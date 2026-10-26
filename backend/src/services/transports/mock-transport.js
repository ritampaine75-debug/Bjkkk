/**
 * In-memory Telegram transport used by the simulator.
 * It records every outbound operation as a simulated Telegram message so the
 * UI can render a conversation. Nothing here touches the network.
 */
import { newId, nowIso } from '../../utils/ids.js';

export function createMockTransport({ botUsername = 'botforge_demo_bot' } = {}) {
  const messages = [];
  const operations = [];
  let messageCounter = 500;

  const record = (method, payload, extra = {}) => {
    operations.push({ method, payload, at: nowIso() });
    return extra;
  };

  const pushMessage = (message) => {
    messages.push(message);
    return message;
  };

  const nextId = () => {
    messageCounter += 1;
    return messageCounter;
  };

  const transport = {
    kind: 'mock',
    botUsername,
    messages,
    operations,
    async sendMessage(payload) {
      const message = {
        messageId: nextId(),
        direction: 'out',
        kind: 'text',
        text: payload.text ?? '',
        parseMode: payload.parse_mode || 'plain',
        keyboard: payload.reply_markup?.inline_keyboard || [],
        simulated: true,
        at: nowIso(),
      };
      record('sendMessage', payload);
      return pushMessage(message);
    },
    async sendKeyboard(payload) {
      return transport.sendMessage(payload);
    },
    async sendPhoto(payload) {
      const message = {
        messageId: nextId(),
        direction: 'out',
        kind: 'photo',
        text: payload.caption || '',
        photo: payload.photo,
        keyboard: payload.reply_markup?.inline_keyboard || [],
        simulated: true,
        at: nowIso(),
      };
      record('sendPhoto', payload);
      return pushMessage(message);
    },
    async sendDocument(payload) {
      const message = {
        messageId: nextId(),
        direction: 'out',
        kind: 'document',
        text: payload.caption || '',
        document: payload.document,
        simulated: true,
        at: nowIso(),
      };
      record('sendDocument', payload);
      return pushMessage(message);
    },
    async sendMedia(payload) {
      const message = {
        messageId: nextId(),
        direction: 'out',
        kind: 'media',
        text: payload.caption || '',
        media: payload.media,
        simulated: true,
        at: nowIso(),
      };
      record('sendMedia', payload);
      return pushMessage(message);
    },
    async editMessage(payload) {
      const target =
        messages.find((message) => message.messageId === Number(payload.message_id)) || messages[messages.length - 1];
      if (target) {
        target.text = payload.text;
        target.edited = true;
      }
      record('editMessage', payload);
      return target || { messageId: payload.message_id, text: payload.text, simulated: true, edited: true };
    },
    async answerCallback(payload) {
      record('answerCallback', payload);
      return { ok: true, text: payload.text || '', alert: payload.show_alert === true };
    },
    /** Records an inbound simulated user message so the transcript is complete. */
    addIncoming(message) {
      const incoming = {
        id: newId('sim'),
        messageId: nextId(),
        direction: 'in',
        kind: message.kind || 'text',
        text: message.text ?? '',
        command: message.command || null,
        callbackData: message.callbackData || null,
        simulated: true,
        at: nowIso(),
      };
      messages.push(incoming);
      return incoming;
    },
    lastMessageId() {
      return messages.length > 0 ? messages[messages.length - 1].messageId : null;
    },
    transcript() {
      return messages.map((message) => ({ ...message }));
    },
  };

  return transport;
}

/** Adapter that forwards engine actions to a real Telegram client. */
export function createTelegramTransport(client) {
  const operations = [];
  const transport = {
    kind: 'live',
    operations,
    async sendMessage(payload) {
      const { result } = await client.sendMessage(payload);
      operations.push({ method: 'sendMessage', at: nowIso() });
      return { messageId: result?.message_id ?? null, at: nowIso() };
    },
    async sendKeyboard(payload) {
      return transport.sendMessage(payload);
    },
    async sendPhoto(payload) {
      const { result } = await client.sendPhoto(payload);
      operations.push({ method: 'sendPhoto', at: nowIso() });
      return { messageId: result?.message_id ?? null };
    },
    async sendDocument(payload) {
      const { result } = await client.sendDocument(payload);
      operations.push({ method: 'sendDocument', at: nowIso() });
      return { messageId: result?.message_id ?? null };
    },
    async sendMedia(payload) {
      const method = { audio: 'sendAudio', video: 'sendVideo', animation: 'sendAnimation', voice: 'sendVoice' }[
        payload.mediaType
      ] || 'sendDocument';
      const { result } = await client.call(method, payload.payload);
      operations.push({ method, at: nowIso() });
      return { messageId: result?.message_id ?? null };
    },
    async editMessage(payload) {
      const { result } = await client.editMessageText(payload);
      operations.push({ method: 'editMessageText', at: nowIso() });
      return { messageId: result?.message_id ?? null };
    },
    async answerCallback(payload) {
      await client.answerCallbackQuery(payload);
      operations.push({ method: 'answerCallbackQuery', at: nowIso() });
      return { ok: true };
    },
  };
  return transport;
}
