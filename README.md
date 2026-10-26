# BotForge Studio

Telegram bot management and visual automation IDE: connect a bot, describe what it should do
with commands and workflows, test it in a virtual Telegram simulator, then publish it to run
against real Telegram updates.

Built as a single Node 22 + Express service with a dependency-free ES-module frontend. Data
lives in Firestore (production) or a local JSON file (development). Bot tokens are encrypted at
rest with AES-256-GCM and are never returned to the browser.

---

## What is implemented

| Area | Status |
| --- | --- |
| Email/password auth (local dev) + Firebase Auth ID-token auth (production) | implemented, tested |
| Bot connect via BotFather token, server-side validation, encrypted vault, revoke/rotate | implemented, tested |
| Commands editor, Telegram command sync (429-aware), import | implemented, tested |
| Workflow schema, validation, versioning, publish/pause/resume/duplicate/export/import | implemented, tested |
| Dual editors: Easy Mode (forms) and Advanced Mode (visual canvas) | implemented, tested |
| Workflow engine (real interpreter, conditions, variables, delays, HTTP allowlist) | implemented, tested |
| Virtual Telegram simulator (chat, inline keyboard taps, branch tracing, variables) | implemented, tested |
| Live runtime: webhook, dedupe, queue, retries, real Telegram sends | implemented, tested |
| Execution logs + analytics | implemented, tested |
| Interval schedules (in-process scheduler) | implemented, tested |
| User restrictions (allow/block lists, per command) | implemented, tested |
| Automated tests: unit, integration, end-to-end (jsdom) | 217 tests |

See [`docs/FEATURE-MATRIX.md`](docs/FEATURE-MATRIX.md) for the honest, item-by-item matrix
(implemented / partially implemented / unavailable) — that file, not this table, is the
authoritative statement of what works.

## What is **not** verified

No real Telegram bot, no real Firebase project and no hosting provider were reachable from the
environment where this was built. Everything is verified against an in-process Telegram API mock
and jsdom. **You must run the first live check yourself** — the "Live test" screen and
`npm run check:firebase` exist exactly for that. Do not assume live connectivity works until you
have seen it work.

---

## Quick start (local)

```bash
git clone <your-repo> botforge && cd botforge
npm install
cp .env.example .env          # then set TOKEN_ENCRYPTION_KEY (see below)
npm start                     # http://localhost:8080
```

Generate the vault key (required — the server refuses to start without it):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Put the value in `.env` as `TOKEN_ENCRYPTION_KEY=...`. Keep a backup: if the key is lost, stored
bot tokens cannot be decrypted and bots must be reconnected.

Development defaults: `AUTH_MODE=local`, `DB_MODE=json`, data in `backend/.data/db.json`.
Registration is open in local mode; the first account you create can connect a bot.

Then open <http://localhost:8080>, register, and follow
[`docs/TELEGRAM-SETUP.md`](docs/TELEGRAM-SETUP.md) to connect a real bot.

### Useful scripts

| Command | Purpose |
| --- | --- |
| `npm start` | run the app (API + static frontend, one port) |
| `npm run dev` | same, with `--watch` |
| `npm run test:all` | unit + integration + end-to-end (jsdom) |
| `npm run check:firebase` | verify Firebase credentials and a Firestore round-trip |
| `npm run webhook:register -- --uid <uid> --bot <botId>` | register/rotate a Telegram webhook |
| `npm run poll -- --uid <uid> --bot <botId>` | development long-polling (refuses if a webhook is active) |

## Documentation

| Document | Contents |
| --- | --- |
| [`docs/SETUP.md`](docs/SETUP.md) | local development, environment variables, project layout |
| [`docs/FIREBASE-SETUP.md`](docs/FIREBASE-SETUP.md) | Firebase project, Admin SDK, rules (Firestore, Storage, Realtime Database), auth |
| [`docs/TELEGRAM-SETUP.md`](docs/TELEGRAM-SETUP.md) | BotFather, token, webhook, finding your chat id, live test |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Docker/Render/Fly/Cloud Run, scheduler caveats, first-run checklist |
| [`docs/SECURITY.md`](docs/SECURITY.md) | threat model, vault, webhook authenticity, checklists |
| [`docs/LIMITATIONS.md`](docs/LIMITATIONS.md) | free-tier limits and alternatives |
| [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) | symptoms → causes → fixes |
| [`docs/FEATURE-MATRIX.md`](docs/FEATURE-MATRIX.md) | implemented / partial / unavailable, with test evidence |

## Architecture

```
frontend/            static ES-module SPA (no build step)
  assets/js/pages/         screens: welcome, dashboard, bots, commands, workflows,
                           workflow-editor, simulator, live-test, executions, schedules, settings
  assets/js/editors/       Easy Mode form editor + Advanced Mode canvas editor
shared/              schema + validation used by BOTH backend and frontend
  workflow-schema.js       node/trigger definitions, validation, fingerprints
  workflow-form-model.js   graph <-> form-step translation
  command-schema.js        command validation + Telegram reply markup
backend/src/
  routes/                 auth, dashboard, bots, commands, workflows, simulator,
                          executions, schedules, analytics, webhook (public)
  services/               bot-connection, token-vault, telegram-api, command-service,
                          workflow-service, workflow-engine, expression, simulation-service,
                          live-runtime, queue, scheduler, analytics, webhook-service
  services/transports/    mock transport (simulator) + live transport + retrying wrapper
  repositories/           ownership-scoped data access
tests/                unit, integration, e2e (jsdom against a real HTTP server)
firebase/            Firestore / Storage / Realtime Database rules + indexes
```

Design rules that the code follows:

- Every privileged read/write goes through `repositories/` with the `uid` in the path, so a
  missing ownership check cannot leak another account's data.
- The same `shared/` validation is used by the editors and the API, so the UI never proposes
  something the server rejects for a different reason.
- Simulation and live execution share one engine; only the transport differs. A simulator run
  can therefore never "pass" logic that live would fail.
- Nothing is faked: when a feature cannot run (no public HTTPS URL, scheduler disabled, no
  executions yet) the API and UI say so explicitly.

## Licence / ownership

Private project. Connecting a bot requires confirming that you own or administer it.
