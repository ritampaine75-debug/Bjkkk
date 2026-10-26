# Deployment guide

The app is a single Node process that serves the API and the static frontend on one port. That
keeps CORS, cookies and the webhook URL simple, and it fits free tiers.

## Recommended: Render (free tier) or Fly.io / Cloud Run / Railway

Committed helpers: `Dockerfile`, `.dockerignore`, `render.yaml`.

### Render

1. Push the repo to GitHub, then Render → **New → Blueprint** → pick the repo (`render.yaml`).
2. Fill the secret environment variables (marked `sync: false`):
   `TELEGRAM_WEBHOOK_BASE_URL`, `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`,
   `FIREBASE_PRIVATE_KEY`, `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `TOKEN_ENCRYPTION_KEY`.
3. Deploy. Health check: `/api/health`.
4. Set `TELEGRAM_WEBHOOK_BASE_URL=https://<service>.onrender.com` and redeploy.
5. Bot settings → **Register webhook**, then follow [`TELEGRAM-SETUP.md`](TELEGRAM-SETUP.md) §5.

> Free instances sleep after inactivity. Telegram delivers one webhook at a time and retries, so a
> cold start delays but does not lose an update — however **timers do not run while the instance is
> asleep**, so interval schedules are unreliable on a sleeping free tier. Use a paid always-on plan,
> or a separate always-on worker, if schedules matter.

### Docker (any host)

```bash
docker build -t botforge-studio .
docker run -p 8080:8080 --env-file .env botforge-studio
```

Set `NODE_ENV=production`, `AUTH_MODE=firebase`, `DB_MODE=firestore`. The JSON store is mounted only
as a development convenience; in the image it lives in `backend/.data` and is not persisted.

### Cloud Run

```bash
gcloud run deploy botforge-studio --source . --region <region> --allow-unauthenticated \
  --set-env-vars NODE_ENV=production,AUTH_MODE=firebase,DB_MODE=firestore,SCHEDULER_ENABLED=true
```

Use Secret Manager for `FIREBASE_PRIVATE_KEY` and `TOKEN_ENCRYPTION_KEY`
(`--set-secrets TOKEN_ENCRYPTION_KEY=botforge-vault:latest`). Set the min instance count to 1 if you
rely on schedules.

## Environment checklist (production)

- [ ] `NODE_ENV=production`
- [ ] `AUTH_MODE=firebase` (local auth is refused in production)
- [ ] `DB_MODE=firestore` with Admin credentials
- [ ] `TOKEN_ENCRYPTION_KEY` set **and backed up** (losing it makes bot tokens unrecoverable)
- [ ] `TELEGRAM_WEBHOOK_BASE_URL` = public HTTPS URL
- [ ] `ALLOWED_ORIGINS` = your exact https origin (empty means same-origin only)
- [ ] `TRUST_PROXY=1` (or your proxy hop count) so rate limiting sees real client IPs
- [ ] `SCHEDULER_ENABLED=true` only on an always-on instance
- [ ] Firestore/Storage/Rules deployed (`firebase deploy --only firestore:rules,...`)

## Operational notes

- **Single-instance assumption.** The live-runtime queue and the scheduler are in-process. Running
  several replicas means each replica polls the same schedule table: jobs are claimed by writing
  execution records but there is no distributed lock, so a schedule could run once per replica.
  Keep the scheduler on one replica, or move the queue to a managed service.
- **Webhook authenticity** is per bot (capability key + `secret_token`), so it works behind any
  proxy. Do not put the webhook path behind a shared-secret reverse proxy rule.
- **Backups.** Firestore: enable scheduled managed backups or run
  `gcloud firestore export gs://<bucket>/<prefix>`. The JSON store: copy `backend/.data/db.json`.
  The vault key must be backed up separately — an encrypted backup without the key is useless.
- **Restore.** Import the Firestore export into a project with the **same** `TOKEN_ENCRYPTION_KEY`
  (or supply the old key as `TOKEN_ENCRYPTION_KEY_V2` and rotate). Bots will work again without
  re-entering tokens only if the key matches.
- **Rotation.** Add `TOKEN_ENCRYPTION_KEY_V2`, set `TOKEN_ENCRYPTION_KEY_VERSION=2`, restart; new
  writes use v2 while v1 envelopes stay readable. Re-saving a bot token re-encrypts it.
- **Logs** never contain tokens; only error codes and ids.
- **Retention.** Execution records include transcripts. Prune with
  `pruneExecutions(uid, botId)` (in `simulation-service.js`) or a Firestore TTL policy on
  `startedAt` for `EXECUTION_RETENTION_DAYS`.

## Scaling checklist

If you outgrow one instance: move the queue to Cloud Tasks/PubSub, run the scheduler as a single
Cloud Scheduler → HTTPS job hitting `/api/v1/.../schedules` internals (or a dedicated worker),
and keep webhook handling stateless.
