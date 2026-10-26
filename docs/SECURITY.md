# Security

## Threat model

The assets worth protecting are **bot tokens** (full control of a Telegram bot) and **user data**
(bot lists, workflows, execution transcripts). The adversaries considered: anonymous internet
users, a logged-in user trying to reach another account's data, and someone who obtains a copy of
the database.

## Token handling

- Tokens are accepted only over the connect/rotate endpoints, validated against `getMe` first, then
  encrypted with **AES-256-GCM** (`backend/src/services/token-vault.js`).
- The ciphertext lives in a separate collection (`botSecrets/{botId}`) from the bot record.
- The API returns only `tokenMask` (e.g. `1234…abcd`); no endpoint returns the plaintext.
- Decryption happens only in `getBotTelegramClient`, which first checks that the caller owns the bot.
- Envelopes carry a key version for rotation (`TOKEN_ENCRYPTION_KEY_Vx`).
- Tokens never reach logs, error messages, execution records or the browser.

## Authorization

- Every request authenticates (`authenticate`) and every bot-scoped router mounts `loadBot`, which
  resolves the bot **for the current uid** before any handler runs.
- All data paths include the uid (`users/{uid}/bots/{botId}/...`), so a wrong id returns 404 rather
  than another account's record. Integration tests assert cross-account access returns 404.
- The public webhook does not authenticate a session; it authenticates the **bot** via an
  unguessable capability key (hash stored) plus Telegram's `secret_token` header comparison.
- Admin-only surfaces do not exist: there is no superuser role.

## Abuse controls

- Rate limits: general (120/min), sensitive operations (connect, webhook, live test, simulate),
  per-IP by default with `TRUST_PROXY` honoured behind a proxy.
- Body limit 256 KB, strict JSON, HTTPS-only Telegram API base URL.
- Webhook updates are claimed atomically per `update_id`, so replays and Telegram retries cannot
  execute a workflow twice.
- Workflow HTTP nodes are disabled unless `HTTP_ACTION_ALLOWED_HOSTS` lists the host; URLs must be
  HTTPS, must not resolve to private/loopback/link-local ranges, and responses are size-capped.
- The workflow engine never uses `eval`; expressions are a fixed operator set.
- Destructive actions (delete bot, revoke, delete workflow, delete log) require explicit
  confirmation; deletes of bots and logs require `confirm: true` in the body.
- The live test lab refuses to send without `confirm: true` and a numeric chat id.

## Deployment checklist

- [ ] `NODE_ENV=production`
- [ ] `AUTH_MODE=firebase` (local auth is refused in production)
- [ ] Fresh `TOKEN_ENCRYPTION_KEY`, stored in a secret manager, backed up offline
- [ ] Firebase service-account key only in server env (never in the frontend)
- [ ] Firestore rules deny all client access (committed)
- [ ] Storage rules deny all client access (committed)
- [ ] Realtime Database rules reviewed — the committed `true/true` default is open by design; it
      holds no BotForge data, but change it before storing anything there
- [ ] `ALLOWED_ORIGINS` set to the exact production origin
- [ ] `TRUST_PROXY` matches the proxy hops
- [ ] HTTPS enforced at the edge; `upgrade-insecure-requests` is on in production
- [ ] Rate limits reviewed for your traffic
- [ ] Logs shipped somewhere private; verify they contain no tokens
- [ ] Backups enabled for Firestore **and** the vault key

## Known limitations

- The runtime queue and scheduler are in-process; multi-replica deployments need a shared queue.
- Execution transcripts store message text (potentially user PII) until pruned.
- No outbound IP allowlist for HTTP nodes; the host allowlist is the only restriction.
- `poll-dev.js` is development-only and refuses production.
