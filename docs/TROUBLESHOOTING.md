# Troubleshooting

## The server will not start

| Message | Cause | Fix |
| --- | --- | --- |
| `TOKEN_ENCRYPTION_KEY is required` | vault key missing | generate one: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `AUTH_MODE=local ... refused when NODE_ENV=production` | production with dev auth | set `AUTH_MODE=firebase` and Admin credentials |
| `DB_MODE=firestore requires Firebase Admin credentials` | incomplete Admin env | set project id, client email, private key |
| `LOCAL_AUTH_SECRET must be at least 32 characters` | short secret | use a long random string |
| `Port 8080 is already in use` | previous instance running | stop it or set `PORT` |

## Connecting a bot

- **`invalid_token_format`** — the token was truncated or has spaces. Copy it again from BotFather;
  format is `123456789:AA…`.
- **`401 Unauthorized` from Telegram** — the token was revoked in BotFather. Create a new token.
- **`409 This bot is already connected`** — the response includes `details.existingBotId`. Open that
  workspace instead of connecting a duplicate.
- **`token_identity_mismatch` on rotate** — you pasted a different bot's token. Use *Connect bot*.

## Live updates do not arrive

1. **Is a workflow published?** Drafts and paused workflows never receive updates.
2. **Is the webhook registered?** Bot settings → Live runtime should show `active`.
   `https://api.telegram.org/bot<TOKEN>/getWebhookInfo` shows what Telegram actually has.
3. **`webhook_base_url_missing`** — set `TELEGRAM_WEBHOOK_BASE_URL` to the public HTTPS URL.
4. **`webhook_requires_https`** — Telegram refuses plain HTTP. Use a tunnel
   (`cloudflared tunnel --url http://localhost:8080`) for local testing.
5. **Webhook registered but nothing happens** — check Diagnostics → pending updates. A growing count
   means the URL is unreachable (proxy, cold start, firewall, wrong host).
6. **Development with no public URL** — use `npm run poll -- --uid <uid> --bot <botId>`. Make sure the
   webhook is removed first (the script refuses otherwise).
7. **User not allowed** — Bot settings → User restrictions. `allowlist` blocks everyone not listed;
   the runtime records a `restricted_user` event instead of pretending to run.

## The simulator says "no trigger matches"

The input you typed does not match any trigger in the selected workflow. The error lists the
triggers that exist. Common cases:

- the workflow listens for `/start` but you typed `hello`;
- a `keyword` trigger has no keywords;
- a `callback` trigger has `matchAny = false` and a specific `data` value, and you tapped another
  button;
- you are simulating the *published* version while editing the draft — switch the version selector.

## Workflow will not publish

Validation errors are shown on the editor's validation card and returned by the API (`422`):

- an unconnected trigger or an unreachable node,
- a condition that lacks a `true` or `false` branch,
- a cycle (loops are not allowed),
- a delay above 10 minutes,
- a regex that does not compile,
- an HTTP node without an allowlisted host.

Warnings (unreachable nodes) do not block publishing.

## A run failed

Open Executions → the row → detail. Each step shows its status, duration and error code.

| Code | Meaning |
| --- | --- |
| `blocked` | the user blocked the bot, or Telegram refused the send |
| `chat_not_found` | wrong chat id, or the bot was never started in that chat |
| `rate_limited` | Telegram 429; the runtime retried per `retry_after` |
| `timeout` / `step_limit` | workflow exceeded the limits (`EXECUTION_TIMEOUT_MS`, `EXECUTION_MAX_STEPS`) |
| `blocked_host` / `host_not_allowed` / `insecure_url` | HTTP node target rejected by policy |
| `no_steps` | the trigger has no connected node |

## Schedules do not run

`SCHEDULER_ENABLED` defaults to **false**. The Schedules page says so. Either set it to `true` and run
an always-on instance, or press **Run now**. Free tiers that sleep will not fire timers.

## Analytics are empty

Analytics are computed from stored executions only. Nothing is estimated; an empty chart means no
runs in the selected window (or the runs are older than the retention window).

## Tests fail locally

- `node --test tests/unit` (bare directory) is not supported on Node 22 — use the npm scripts.
- E2E tests need no browser, but jsdom needs Node 20+. 
- If a suite hangs, a page probably holds an interval: use the `?autosave=off` query the editor
  supports, and check for duplicate `setInterval` calls after a re-render.
