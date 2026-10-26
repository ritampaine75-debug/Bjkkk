/** Shared loader for a bot workspace page. */
import { api } from '../api-client.js';
import { setState, getState } from '../state.js';

export async function loadBot(botId) {
  if (!botId) {
    const error = new Error('No bot was specified.');
    error.code = 'missing_bot';
    throw error;
  }
  const data = await api.get(`/bots/${encodeURIComponent(botId)}`);
  if (getState().activeBotId !== data.bot.id) setState({ activeBotId: data.bot.id });
  return data;
}

export async function listBots() {
  const { bots } = await api.get('/bots');
  setState({ bots });
  return bots;
}

export function botStateMessage(bot) {
  const state = bot?.connection?.state;
  if (state === 'revoked') {
    return {
      tone: 'warning',
      title: 'Connection revoked',
      text: 'The stored bot token was deleted. Reconnect the bot to run workflows again.',
    };
  }
  if (state === 'invalid_token') {
    return {
      tone: 'danger',
      title: 'Token rejected by Telegram',
      text: bot.connection?.lastError?.message || 'Generate a new token in BotFather and replace the stored token.',
    };
  }
  if (state === 'error') {
    return {
      tone: 'danger',
      title: 'Connection check failed',
      text: bot.connection?.lastError?.message || 'The last connection check did not succeed.',
    };
  }
  if (state === 'unknown') {
    return {
      tone: 'neutral',
      title: 'Connection state unknown',
      text: 'Run a connection check to determine the current state. Status is not assumed.',
    };
  }
  return null;
}
