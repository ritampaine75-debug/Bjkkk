/**
 * Normalises a raw Telegram update into the shape the workflow engine expects.
 *
 * The parser never throws on unexpected payloads: unknown updates are reported
 * as `{ kind: 'unsupported' }` so the runtime can log and ignore them.
 */

function pickUser(from) {
  return {
    id: from?.id !== undefined ? String(from.id) : '',
    username: from?.username || '',
    firstName: from?.first_name || '',
    lastName: from?.last_name || '',
    languageCode: from?.language_code || '',
    isBot: from?.is_bot === true,
  };
}

function pickChat(chat) {
  return {
    id: chat?.id !== undefined ? String(chat.id) : '',
    type: chat?.type || 'private',
    title: chat?.title || '',
    username: chat?.username || '',
  };
}

/** Extract the bot command (without the slash) from a message, if any. */
export function extractCommand(text) {
  if (typeof text !== 'string') return null;
  const match = /^\/([A-Za-z0-9_]{1,32})(?:@([A-Za-z0-9_]+))?(?:\s|$)/.exec(text.trim());
  if (!match) return null;
  return { command: match[1].toLowerCase(), mention: match[2] || null };
}

export function parseUpdate(update) {
  const updateId = update?.update_id !== undefined ? String(update.update_id) : null;
  if (!update || typeof update !== 'object') return { updateId, kind: 'unsupported', reason: 'malformed_update' };

  if (update.callback_query) {
    const query = update.callback_query;
    return {
      updateId,
      kind: 'callback',
      chat: pickChat(query.message?.chat || { id: query.from?.id }),
      user: pickUser(query.from),
      messageId: query.message?.message_id ?? null,
      callbackQueryId: query.id || null,
      callbackData: typeof query.data === 'string' ? query.data.slice(0, 64) : null,
      text: '',
      command: null,
      raw: update,
    };
  }

  const message = update.message || update.edited_message;
  if (message) {
    if (Array.isArray(message.new_chat_members) && message.new_chat_members.length > 0) {
      return {
        updateId,
        kind: 'newMember',
        chat: pickChat(message.chat),
        user: pickUser(message.new_chat_members[0]),
        members: message.new_chat_members.map(pickUser),
        messageId: message.message_id ?? null,
        text: '',
        command: null,
        edited: Boolean(update.edited_message),
        raw: update,
      };
    }
    const commandInfo = extractCommand(message.text);
    return {
      updateId,
      kind: 'message',
      chat: pickChat(message.chat),
      user: pickUser(message.from),
      messageId: message.message_id ?? null,
      text: typeof message.text === 'string' ? message.text.slice(0, 4096) : '',
      command: commandInfo?.command || null,
      commandMention: commandInfo?.mention || null,
      edited: Boolean(update.edited_message),
      raw: update,
    };
  }

  const kind = Object.keys(update).find((key) => key !== 'update_id') || 'unknown';
  return { updateId, kind: 'unsupported', reason: `unsupported_update:${kind}` };
}

/** Shape passed to `executeWorkflow` as `event`. */
export function toEngineEvent(parsed) {
  return {
    type: parsed.kind === 'message' ? (parsed.command ? 'command' : 'text') : parsed.kind,
    text: parsed.text || '',
    command: parsed.command || null,
    callbackData: parsed.callbackData || null,
    callbackQueryId: parsed.callbackQueryId || null,
    messageId: parsed.messageId ?? null,
    chat: parsed.chat,
    user: parsed.user,
    chatId: parsed.chat?.id || '',
    userId: parsed.user?.id || '',
    username: parsed.user?.username || '',
    firstName: parsed.user?.firstName || '',
    members: parsed.members || [],
    updateId: parsed.updateId,
  };
}
