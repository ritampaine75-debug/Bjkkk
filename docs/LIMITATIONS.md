# Free-tier limits and alternatives

| Resource | Free-tier reality | What BotForge does about it | Alternative |
| --- | --- | --- | --- |
| Telegram Bot API | Free, rate limited (~30 msg/s, per-chat ~1/s) | retries `429` honouring `retry_after`, records the retry count on the execution | send fewer messages per workflow; batch with a delay node |
| Hosting (Render free) | Instance sleeps when idle | webhook acknowledges fast, Telegram retries; state is in Firestore | paid always-on instance, or Fly.io/Cloud Run min-instances=1 |
| Hosting (Vercel/Netlify) | Serverless; no long-lived timers | not supported as-is — the runtime needs a persistent process | deploy the Express app to Render/Fly/Cloud Run |
| Scheduler | In-process interval loop | `SCHEDULER_ENABLED=false` by default so nothing silently dies; UI shows the state | Cloud Scheduler → authenticated HTTP trigger of a small worker, or a cron job hitting a run endpoint |
| Firestore free tier | 1 GiB storage, 50k reads / 20k writes per day | execution transcripts are the biggest consumer | lower `EXECUTION_RETENTION_DAYS`, prune executions, store only summaries |
| Firebase Auth | 50k MAU on the free Spark plan | password auth only, no social providers needed | — |
| Realtime Database | not used | no cost, no dependency | — |
| Outbound HTTP nodes | no free egress proxy needed | disabled unless an allowlist is configured | your own API |
| File uploads | not implemented | no storage cost | use `sendPhoto` with a public HTTPS URL |

## Deliberately not implemented

These are **not** stubbed in the UI; the surfaces simply do not exist:

- Payments, subscriptions, team/workspace sharing, roles.
- Media upload/processing, Telegram payments, Telegram Web Apps, inline query answers.
- Multi-tenant admin console.
- Distributed queue / horizontal scheduler.

See [`FEATURE-MATRIX.md`](FEATURE-MATRIX.md) for the item-by-item state.
