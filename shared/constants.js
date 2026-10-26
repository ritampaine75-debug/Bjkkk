/**
 * Values shared by the backend runtime, the workflow engine, the simulator and
 * the browser bundle. Must stay dependency-free so it can be loaded anywhere.
 */

export const APP_NAME = 'BotForge Studio';
export const API_PREFIX = '/api/v1';

/** Current workflow document schema version. */
export const WORKFLOW_SCHEMA_VERSION = 1;

export const WORKFLOW_STATUS = Object.freeze({
  DRAFT: 'draft',
  PUBLISHED: 'published',
  PAUSED: 'paused',
  ARCHIVED: 'archived',
});

export const EXECUTION_MODE = Object.freeze({
  SIMULATION: 'simulation',
  LIVE: 'live',
  TEST: 'test',
});

export const EXECUTION_STATUS = Object.freeze({
  RUNNING: 'running',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  SKIPPED: 'skipped',
  TIMEOUT: 'timeout',
  CANCELLED: 'cancelled',
});

export const BOT_ENVIRONMENT = Object.freeze({
  DEVELOPMENT: 'development',
  PRODUCTION: 'production',
});

export const BOT_CONNECTION_STATE = Object.freeze({
  CONNECTED: 'connected',
  INVALID_TOKEN: 'invalid_token',
  REVOKED: 'revoked',
  ERROR: 'error',
  UNKNOWN: 'unknown',
});

/** Limits enforced by the workflow engine and validators. */
export const WORKFLOW_LIMITS = Object.freeze({
  MAX_NODES: 60,
  MAX_EDGES: 120,
  MAX_STEPS: 60,
  MAX_DEPTH: 24,
  MAX_VARIABLES: 50,
  VARIABLE_NAME_MAX: 40,
  VARIABLE_VALUE_MAX: 2000,
  TEXT_MAX: 4096,
  BUTTON_LABEL_MAX: 64,
  BUTTONS_MAX: 24,
  BUTTONS_PER_ROW_MAX: 8,
  NAME_MAX: 80,
  DELAY_MAX_MS: 5 * 60 * 1000,
  HTTP_TIMEOUT_MS: 10000,
  HTTP_RESPONSE_BYTES: 256 * 1024,
  EXPORT_BYTES: 512 * 1024,
});

/** Telegram command rules (BotFather/Bot API). */
export const COMMAND_LIMITS = Object.freeze({
  NAME_MAX: 32,
  DESCRIPTION_MAX: 256,
  MAX_COMMANDS: 100,
  COMMAND_NAME_PATTERN: /^[a-z0-9_]{1,32}$/,
});

export const BUTTON_ACTION = Object.freeze({
  CALLBACK: 'callback',
  URL: 'url',
});

export const TRIGGER_TYPES = Object.freeze([
  'command',
  'text',
  'callback',
  'newMember',
  'keyword',
  'schedule',
  'manual',
]);

export const NODE_TYPES = Object.freeze([
  // actions
  'sendMessage',
  'sendPhoto',
  'sendDocument',
  'sendMedia',
  'sendKeyboard',
  'editMessage',
  'answerCallback',
  'setVariable',
  'delay',
  'httpRequest',
  'logEvent',
  'end',
  // conditions
  'condition',
]);

export const CONDITION_OPERATORS = Object.freeze([
  'equals',
  'notEquals',
  'contains',
  'notContains',
  'startsWith',
  'endsWith',
  'regex',
  'gt',
  'gte',
  'lt',
  'lte',
  'isEmpty',
  'isNotEmpty',
]);

export const CONDITION_SUBJECTS = Object.freeze([
  'text',
  'command',
  'userId',
  'username',
  'chatId',
  'callbackData',
  'variable',
  'boolean',
]);

export const EXECUTION_LOG_RETENTION_DEFAULT_DAYS = 30;
