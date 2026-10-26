# Telegram setup

## 1. Create the bot

1. Open Telegram, start a chat with **@BotFather**.
2. `/newbot`, choose a display name and a username ending in `bot`.
3. BotFather replies with a token like `123456789:AA...`. Treat it as a password.

## 2. Connect it in BotForge

Bots → **Connect bot** → paste the token → tick the ownership confirmation → Connect.

The server calls `getMe`, stores the token **encrypted** (AES-256-GCM), keeps only a mask for
display, and returns the bot's public profile. If the same Telegram bot is already linked to your
account, you get a `409` naming the existing workspace instead of a duplicate.

Rotate the token later under Bot settings → Token & security. Revoking deletes the ciphertext and
removes the webhook.

## 3. Register the webhook

Telegram must be able to reach your server over **HTTPS**:

1. Deploy or tunnel the app (see [`DEPLOYMENT.md`](DEPLOYMENT.md)); note the public URL.
2. Set `TELEGRAM_WEBHOOK_BASE_URL=https://your-host` (or rely on `APP_BASE_URL`).
3. Restart, then Bot settings → **Live runtime** → **Register webhook**.

The app generates a random per-bot capability key, sends it to Telegram as `secret_token`, stores
only its SHA-256 hash, and registers
`https://your-host/api/v1/telegram/webhook/<botId>/<key>`. Telegram echoes the key in the
`X-Telegram-Bot-Api-Secret-Token` header on every delivery and the endpoint rejects anything else.
Registering again rotates the key.

You can also do it from the CLI:

```bash
npm run webhook:register -- --uid <uid> --bot <botId>
```

## 4. Publish a workflow

Workflows → open a workflow → **Publish**. Only published workflows receive live updates.
Pausing stops them immediately, and removes any interval schedule.

## 5. Verify it really works

1. **Simulator** — free, no Telegram involved: send `/start`, tap inline buttons, inspect steps.
2. **Bot settings → Live runtime → Test routing** — feeds a synthetic `/start` through the real
   runtime path with a dry-run client. No message leaves the server.
3. **Live test** — send one real message. You need your numeric chat id:
   - send any message to your bot,
   - open `https://api.telegram.org/bot<TOKEN>/getUpdates`,
   - read `message.chat.id` (negative for groups).
   Tick the confirmation box, send, and Telegram's response is shown (or its error code).
4. Finally message the bot from your own Telegram client and check **Executions** for a `live` row.

If step 4 shows nothing, the webhook is not reaching you: check
`https://api.telegram.org/bot<TOKEN>/getWebhookInfo` and the Diagnostics panel.

## 6. Development without a public URL

```bash
npm run poll -- --uid <uid> --bot <botId>
```

Long polling runs the same runtime path (dedupe, matching, execution records). It refuses to start
while a webhook is active — Telegram allows only one consumer per bot — and refuses to run with
`NODE_ENV=production`. Pass `--drop-webhook` to remove the webhook first.
