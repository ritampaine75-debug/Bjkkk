/**
 * Command schema shared by the API, the editors and the live runtime.
 * Validates and normalises everything a command can contain before it is
 * persisted or published to Telegram.
 */
import { COMMAND_LIMITS, WORKFLOW_LIMITS } from './constants.js';

const PARSE_MODES = ['plain', 'HTML', 'MarkdownV2'];

export function normalizeCommandName(raw) {
  if (typeof raw !== 'string') return '';
  return raw.trim().replace(/^\//, '').toLowerCase();
}

export function validateCommand(input, { existingNames = [] } = {}) {
  const errors = [];
  const command = input || {};
  const name = normalizeCommandName(command.name);

  if (!name) {
    errors.push({ field: 'name', message: 'A command name is required (for example: start).' });
  } else if (name.length > COMMAND_LIMITS.NAME_MAX) {
    errors.push({ field: 'name', message: `Command names must be ${COMMAND_LIMITS.NAME_MAX} characters or fewer.` });
  } else if (!COMMAND_LIMITS.COMMAND_NAME_PATTERN.test(name)) {
    errors.push({
      field: 'name',
      message: 'Telegram command names may only contain lowercase letters, digits and underscores.',
    });
  } else if (existingNames.includes(name)) {
    errors.push({ field: 'name', message: `A command named /${name} already exists.` });
  }

  const description = typeof command.description === 'string' ? command.description.trim() : '';
  if (description.length > COMMAND_LIMITS.DESCRIPTION_MAX) {
    errors.push({
      field: 'description',
      message: `Descriptions must be ${COMMAND_LIMITS.DESCRIPTION_MAX} characters or fewer (Telegram limit).`,
    });
  }

  const reply = command.reply || {};
  const text = typeof reply.text === 'string' ? reply.text : '';
  if (text.length > WORKFLOW_LIMITS.TEXT_MAX) {
    errors.push({ field: 'reply.text', message: `Reply text must be ${WORKFLOW_LIMITS.TEXT_MAX} characters or fewer.` });
  }
  if (reply.parseMode !== undefined && !PARSE_MODES.includes(reply.parseMode)) {
    errors.push({ field: 'reply.parseMode', message: `parseMode must be one of: ${PARSE_MODES.join(', ')}.` });
  }

  const keyboard = normalizeKeyboard(command.keyboard, errors);
  if (keyboard.rows.length > WORKFLOW_LIMITS.BUTTONS_MAX) {
    errors.push({ field: 'keyboard', message: `A keyboard can hold at most ${WORKFLOW_LIMITS.BUTTONS_MAX} buttons.` });
  }

  if (command.workflowId !== undefined && command.workflowId !== null) {
    if (typeof command.workflowId !== 'string' || command.workflowId.length > 64) {
      errors.push({ field: 'workflowId', message: 'workflowId has an invalid format.' });
    }
  }

  const access = command.access || {};
  const restrictedToUserIds = normalizeIdList(access.restrictedToUserIds);
  const blockedUserIds = normalizeIdList(access.blockedUserIds);
  if (restrictedToUserIds === null) {
    errors.push({ field: 'access.restrictedToUserIds', message: 'Restricted user IDs must be numeric Telegram user IDs.' });
  }
  if (blockedUserIds === null) {
    errors.push({ field: 'access.blockedUserIds', message: 'Blocked user IDs must be numeric Telegram user IDs.' });
  }

  return {
    valid: errors.length === 0,
    errors,
    command: {
      id: typeof command.id === 'string' ? command.id : undefined,
      name,
      description,
      enabled: command.enabled !== false,
      reply: {
        text,
        parseMode: PARSE_MODES.includes(reply.parseMode) ? reply.parseMode : 'plain',
        disablePreview: reply.disablePreview === true,
      },
      keyboard,
      workflowId: command.workflowId || null,
      access: {
        restrictedToUserIds: restrictedToUserIds || [],
        blockedUserIds: blockedUserIds || [],
      },
      order: Number.isInteger(command.order) ? command.order : 0,
    },
  };
}

function normalizeIdList(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  const out = [];
  for (const item of value) {
    const asString = String(item).trim();
    if (!/^\d{1,20}$/.test(asString)) return null;
    if (!out.includes(asString)) out.push(asString);
  }
  return out;
}

/**
 * Inline keyboard model: { rows: [ [ { text, type, value } ] ] }.
 * `type` is "callback" (callback_data) or "url". Telegram limits callback_data
 * to 64 bytes and labels to 64 characters.
 */
export function normalizeKeyboard(keyboard, errors = []) {
  if (!keyboard) return { rows: [] };
  const rows = Array.isArray(keyboard) ? keyboard : keyboard.rows;
  if (!Array.isArray(rows)) {
    errors.push({ field: 'keyboard', message: 'Keyboard must be an array of button rows.' });
    return { rows: [] };
  }
  const normalized = [];
  rows.forEach((row, rowIndex) => {
    if (!Array.isArray(row)) {
      errors.push({ field: `keyboard[${rowIndex}]`, message: 'Each keyboard row must be an array of buttons.' });
      return;
    }
    if (row.length === 0) return;
    if (row.length > WORKFLOW_LIMITS.BUTTONS_PER_ROW_MAX) {
      errors.push({
        field: `keyboard[${rowIndex}]`,
        message: `A row can hold at most ${WORKFLOW_LIMITS.BUTTONS_PER_ROW_MAX} buttons.`,
      });
    }
    const buttons = [];
    row.forEach((button, buttonIndex) => {
      const label = typeof button?.text === 'string' ? button.text.trim() : '';
      const type = button?.type === 'url' ? 'url' : 'callback';
      const value = typeof button?.value === 'string' ? button.value.trim() : '';
      const field = `keyboard[${rowIndex}][${buttonIndex}]`;
      if (!label) {
        errors.push({ field: `${field}.text`, message: 'Every button needs a label.' });
        return;
      }
      if (label.length > WORKFLOW_LIMITS.BUTTON_LABEL_MAX) {
        errors.push({ field: `${field}.text`, message: `Button labels must be ${WORKFLOW_LIMITS.BUTTON_LABEL_MAX} characters or fewer.` });
      }
      if (!value) {
        errors.push({ field: `${field}.value`, message: 'Every button needs a callback value or URL.' });
        return;
      }
      if (type === 'url') {
        try {
          const url = new URL(value);
          if (!['http:', 'https:'].includes(url.protocol)) throw new Error('protocol');
        } catch {
          errors.push({ field: `${field}.value`, message: 'Button URLs must be valid http or https links.' });
          return;
        }
      } else if (Buffer.byteLength(value, 'utf8') > 64) {
        errors.push({ field: `${field}.value`, message: 'Callback data must be 64 bytes or fewer (Telegram limit).' });
        return;
      }
      buttons.push({ text: label, type, value });
    });
    if (buttons.length > 0) normalized.push(buttons);
  });
  return { rows: normalized };
}

/** Convert the stored keyboard model into Telegram's reply_markup shape. */
export function toTelegramReplyMarkup(keyboard) {
  if (!keyboard || !Array.isArray(keyboard.rows) || keyboard.rows.length === 0) return undefined;
  return {
    inline_keyboard: keyboard.rows.map((row) =>
      row.map((button) =>
        button.type === 'url' ? { text: button.text, url: button.value } : { text: button.text, callback_data: button.value },
      ),
    ),
  };
}

/** Convert Telegram's getMyCommands result into BotForge command stubs. */
export function fromTelegramCommands(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((item) => item && typeof item.command === 'string')
    .map((item) => ({
      name: normalizeCommandName(item.command),
      description: typeof item.description === 'string' ? item.description : '',
    }));
}

export function commandSlash(name) {
  return `/${normalizeCommandName(name)}`;
}
