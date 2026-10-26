/**
 * The CLI helpers must fail loudly with actionable messages instead of doing
 * something surprising (and must never print a bot token).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function run(script, args = []) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [path.join(repoRoot, script), ...args],
      { cwd: repoRoot, timeout: 20_000, env: { ...process.env, BOTFORGE_SKIP_DOTENV: '1', NODE_ENV: 'test' } },
      (error, stdout, stderr) => resolve({ code: error?.code ?? 0, stdout, stderr }),
    );
  });
}

test('register-webhook explains how to resolve the owner', async () => {
  const result = await run('backend/scripts/register-webhook.js', ['--bot', 'bot_missing']);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /--uid|--email|TELEGRAM_WEBHOOK_BASE_URL/);
  assert.doesNotMatch(result.stdout + result.stderr, /\d{5,15}:[A-Za-z0-9_-]{20,}/, 'no token is echoed');
});

test('poll-dev requires uid and bot arguments', async () => {
  const result = await run('backend/scripts/poll-dev.js', []);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /Usage/);
});

test('poll-dev refuses to run in production', async () => {
  const result = await new Promise((resolve) => {
    execFile(
      process.execPath,
      [path.join(repoRoot, 'backend/scripts/poll-dev.js'), '--uid', 'u1', '--bot', 'b1'],
      { cwd: repoRoot, timeout: 20_000, env: { ...process.env, BOTFORGE_SKIP_DOTENV: '1', NODE_ENV: 'production' } },
      (error, stdout, stderr) => resolve({ code: error?.code ?? 0, stdout, stderr }),
    );
  });
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /production|config|NODE_ENV/i);
});
