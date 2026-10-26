import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUpdate, extractCommand, toEngineEvent } from '../../backend/src/services/update-parser.js';

test('extracts commands with and without a bot mention', () => {
  assert.deepEqual(extractCommand('/start'), { command: 'start', mention: null });
  assert.deepEqual(extractCommand('/help@my_bot extra'), { command: 'help', mention: 'my_bot' });
  assert.equal(extractCommand('hello'), null);
  assert.equal(extractCommand('not /start'), null);
  assert.equal(extractCommand(undefined), null);
});

test('parses a text message update', () => {
  const parsed = parseUpdate({
    update_id: 101,
    message: {
      message_id: 5,
      text: 'Hello bot',
      chat: { id: -1001, type: 'group', title: 'Group' },
      from: { id: 7, first_name: 'Ada', username: 'ada' },
    },
  });
  assert.equal(parsed.kind, 'message');
  assert.equal(parsed.updateId, '101');
  assert.equal(parsed.text, 'Hello bot');
  assert.equal(parsed.command, null);
  assert.equal(parsed.chat.id, '-1001');
  assert.equal(parsed.user.firstName, 'Ada');
});

test('parses commands, callbacks and new members', () => {
  const command = parseUpdate({ update_id: 1, message: { message_id: 1, text: '/start', chat: { id: 1 }, from: { id: 2 } } });
  assert.equal(command.command, 'start');

  const callback = parseUpdate({
    update_id: 2,
    callback_query: { id: 'cb1', data: 'help', from: { id: 2, username: 'ada' }, message: { message_id: 9, chat: { id: 3 } } },
  });
  assert.equal(callback.kind, 'callback');
  assert.equal(callback.callbackData, 'help');
  assert.equal(callback.callbackQueryId, 'cb1');
  assert.equal(callback.messageId, 9);

  const joined = parseUpdate({
    update_id: 3,
    message: { message_id: 2, chat: { id: -5 }, new_chat_members: [{ id: 11, first_name: 'New' }] },
  });
  assert.equal(joined.kind, 'newMember');
  assert.equal(joined.members.length, 1);
});

test('unknown and malformed updates are reported, never thrown', () => {
  assert.equal(parseUpdate({ update_id: 4, poll: {} }).kind, 'unsupported');
  assert.equal(parseUpdate(null).kind, 'unsupported');
  assert.equal(parseUpdate({ update_id: 5 }).kind, 'unsupported');
});

test('engine events expose both flat and nested user fields', () => {
  const event = toEngineEvent(
    parseUpdate({ update_id: 6, message: { message_id: 1, text: '/start', chat: { id: 10 }, from: { id: 20, username: 'u', first_name: 'U' } } }),
  );
  assert.equal(event.type, 'command');
  assert.equal(event.command, 'start');
  assert.equal(event.chatId, '10');
  assert.equal(event.username, 'u');
  assert.equal(event.user.firstName, 'U');
  assert.equal(event.chat.id, '10');
});
