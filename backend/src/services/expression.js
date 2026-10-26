/**
 * Variable interpolation and condition evaluation.
 *
 * Everything here is data-driven: no eval, no new Function, no template
 * compilation from untrusted input. Regex patterns come from the workflow
 * schema and are length-capped by the validator.
 */

/** Context keys available to templates and conditions. */
export function buildEvaluationContext({ event = {}, variables = {} }) {
  const user = event.user || {};
  const chat = event.chat || {};
  return {
    // Flattened shortcuts plus `user`/`chat` objects so both `{{firstName}}`
    // and `{{user.first_name}}` styles work in templates.
    user: {
      id: String(user.id ?? event.userId ?? ''),
      username: user.username ?? event.username ?? '',
      first_name: user.first_name ?? user.firstName ?? event.firstName ?? '',
      last_name: user.last_name ?? user.lastName ?? '',
    },
    chat: { id: String(chat.id ?? event.chatId ?? '') },
    text: event.text ?? '',
    command: event.command ?? '',
    callbackData: event.callbackData ?? '',
    chatId: String(chat.id ?? event.chatId ?? ''),
    userId: String(user.id ?? event.userId ?? ''),
    username: user.username ?? event.username ?? '',
    firstName: user.first_name ?? user.firstName ?? event.firstName ?? '',
    lastName: user.last_name ?? user.lastName ?? '',
    messageId: event.message_id ?? event.messageId ?? '',
    updateId: event.updateId ?? '',
    variables: { ...variables },
  };
}

/** Resolve `{{name}}`, `{{user.first_name}}`, `{{var.x}}` placeholders. */
export function interpolate(template, context) {
  if (typeof template !== 'string' || template.length === 0) return '';
  return template.replace(/\{\{\s*([A-Za-z0-9_.]{1,64})\s*\}\}/g, (match, key) => {
    const value = resolvePath(key, context);
    return value === undefined || value === null ? '' : String(value);
  });
}

function resolvePath(key, context) {
  const parts = String(key).split('.');
  let current = context;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = current[part];
  }
  return current;
}

/**
 * Evaluate a condition node's configuration against the current context.
 * Returns a boolean; unknown operators return false rather than throwing.
 */
export function evaluateCondition(config, context) {
  const subject = config.subject || 'text';
  const operator = config.operator || 'equals';
  const expected = config.value ?? '';

  let actual;
  switch (subject) {
    case 'text':
      actual = context.text;
      break;
    case 'command':
      actual = context.command;
      break;
    case 'userId':
      actual = context.userId;
      break;
    case 'username':
      actual = context.username;
      break;
    case 'chatId':
      actual = context.chatId;
      break;
    case 'callbackData':
      actual = context.callbackData;
      break;
    case 'variable':
      actual = context.variables?.[config.variableName] ?? '';
      break;
    case 'boolean':
      return truthy(expected);
    default:
      return false;
  }

  const left = actual === undefined || actual === null ? '' : String(actual);
  const right = String(expected);

  switch (operator) {
    case 'equals':
      return left === right;
    case 'notEquals':
      return left !== right;
    case 'contains':
      return right !== '' && left.includes(right);
    case 'notContains':
      return right !== '' && !left.includes(right);
    case 'startsWith':
      return right !== '' && left.startsWith(right);
    case 'endsWith':
      return right !== '' && left.endsWith(right);
    case 'regex': {
      if (right.length === 0 || right.length > 200) return false;
      try {
        // Patterns are user authored and validated; the cap prevents abuse.
        return new RegExp(right, 'i').test(left);
      } catch {
        return false;
      }
    }
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const a = Number(left);
      const b = Number(right);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
      if (operator === 'gt') return a > b;
      if (operator === 'gte') return a >= b;
      if (operator === 'lt') return a < b;
      return a <= b;
    }
    case 'isEmpty':
      return left.trim().length === 0;
    case 'isNotEmpty':
      return left.trim().length > 0;
    default:
      return false;
  }
}

export function truthy(value) {
  if (typeof value === 'boolean') return value;
  if (value === null || value === undefined) return false;
  const normalized = String(value).trim().toLowerCase();
  return ['true', '1', 'yes', 'on'].includes(normalized);
}

/** Substitute variables inside a parsed JSON body for HTTP actions. */
export function interpolateDeep(value, context) {
  if (typeof value === 'string') return interpolate(value, context);
  if (Array.isArray(value)) return value.map((item) => interpolateDeep(item, context));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = interpolateDeep(item, context);
    return out;
  }
  return value;
}
