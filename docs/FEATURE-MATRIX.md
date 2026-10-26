# Feature-completion matrix

Legend:

- **Implemented + tested** — code exists and automated tests assert the behaviour.
- **Implemented, untested at the edges** — code exists, covered only indirectly.
- **Partial** — works, with a stated limitation.
- **Unavailable** — not implemented; the UI has no fake control for it.

Test command: `npm run test:all` — **217 tests, 0 failing** (88 unit, 90 integration, 39 e2e).
Test files are named next to each row.

## Verification honesty statement

No real Telegram bot, no real Firebase project and no hosting provider were reachable from the
build environment. All Telegram interaction is verified against an in-process Bot API mock; all UI
is verified in jsdom against a real local HTTP server. **Live connectivity has not been verified by
the author** — the Live test screen, `Test routing`, `npm run check:firebase` and
`npm run webhook:register` exist so you can verify it yourself in minutes, and every failure path
reports a real code instead of pretending to succeed.

## Authentication and accounts

| Feature | Status | Evidence |
| --- | --- | --- |
| Registration + login (local dev auth, scrypt hashes, signed sessions) | Implemented + tested | `tests/integration/auth.test.js` |
| Firebase ID-token auth mode (server-side verification via Admin SDK) | Implemented, untested at the edges (no live Firebase project) | `backend/src/services/*auth*`, `docs/FIREBASE-SETUP.md` |
| Session expiry, logout, preferences (theme) | Implemented + tested | `tests/integration/auth.test.js` |
| Per-user data isolation | Implemented + tested | every integration suite has a cross-account 404 case |

## Bot connection and token vault

| Feature | Status | Evidence |
| --- | --- | --- |
| Connect by BotFather token, server-side `getMe` validation | Implemented + tested | `tests/integration/bots.test.js` |
| AES-256-GCM vault, per-bot secret collection, key versions | Implemented + tested | `tests/unit/token-vault.test.js` |
| Token never returned to the browser (mask only) | Implemented + tested | `tests/integration/bots.test.js` |
| Token rotation, revoke (deletes ciphertext + webhook), delete workspace | Implemented + tested | `tests/integration/bots.test.js` |
| Diagnostics (connection, webhook, pending updates, last execution) | Implemented + tested | `tests/integration/bots.test.js` |
| Duplicate bot detection per account | Implemented + tested | `tests/integration/bots.test.js` |

## Commands

| Feature | Status | Evidence |
| --- | --- | --- |
| Command editor (name, description, reply, parse mode, inline keyboard, access lists) | Implemented + tested | `tests/e2e/commands-ui.test.js` |
| Bulk replace + delete | Implemented + tested | `tests/integration/commands.test.js` |
| Sync to Telegram (`setMyCommands`), 429 surfaced as `rate_limited` | Implemented + tested | `tests/integration/commands.test.js` |
| Import existing Telegram commands | Implemented + tested | `tests/integration/commands.test.js` |
| Stored replies answer live updates when no workflow owns the command | Implemented + tested | `tests/integration/command-replies.test.js` |

## Workflows

| Feature | Status | Evidence |
| --- | --- | --- |
| Shared schema + validation used by API and editors | Implemented + tested | `tests/unit/workflow-schema.test.js` |
| Create from `blank` / `welcome` template | Implemented + tested | `tests/integration/workflows.test.js` |
| Save draft, validation errors/warnings, unchanged detection | Implemented + tested | `tests/integration/workflows.test.js` |
| Publish with immutable version, production confirmation, 422/409 paths | Implemented + tested | `tests/integration/workflows.test.js` |
| Pause / resume / duplicate / delete | Implemented + tested | `tests/integration/workflows.test.js` |
| Version history + restore to draft | Implemented + tested | `tests/integration/workflows.test.js` |
| Import / export JSON | Implemented + tested | `tests/integration/workflows.test.js`, `tests/e2e/workflow-editor.test.js` |
| Dual editors: Easy Mode forms and Advanced Mode canvas, one graph | Implemented + tested | `tests/e2e/workflow-editor.test.js`, `tests/unit/form-model.test.js` |
| Undo/redo, autosave, dirty state | Implemented + tested | `tests/e2e/workflow-editor.test.js` |
| Conditions with true/false branches | Implemented + tested | `tests/unit/workflow-engine.test.js` |
| Variables (`setVariable`, `{{placeholders}}`) | Implemented + tested | `tests/unit/expression.test.js` |
| Delays (≤10 min) | Implemented + tested | `tests/unit/workflow-engine.test.js` |
| HTTP request node with HTTPS + host allowlist + SSRF screening | Implemented + tested (against a stub, no real egress) | `tests/unit/workflow-engine.test.js` |
| Media nodes (`sendPhoto`, `sendDocument`, media variants) | Implemented, untested at the edges (schema + transport only; needs a public HTTPS file URL) | `backend/src/services/transports/*` |

## Simulator

| Feature | Status | Evidence |
| --- | --- | --- |
| Runs the **saved workflow** through the real engine, never canned output | Implemented + tested | `tests/integration/simulator.test.js` |
| Mock Telegram adapter records the conversation | Implemented + tested | `tests/integration/simulator.test.js` |
| Telegram-like chat UI, inline keyboard taps as callback events | Implemented + tested | `tests/e2e/simulator-ui.test.js` |
| Branch tracing timeline, variables panel, error display | Implemented + tested | `tests/e2e/simulator-ui.test.js` |
| Draft vs published version selection | Implemented + tested | `tests/e2e/simulator-ui.test.js` |
| Reusable scenarios (save / replay / delete) | Implemented + tested | `tests/integration/simulator.test.js` |
| Step-by-step single-stepping | Unavailable — runs are whole-workflow only | — |
| Multi-conversation persistence across reload | Unavailable — the transcript resets per page load | — |

## Live runtime

| Feature | Status | Evidence |
| --- | --- | --- |
| Webhook registration with per-bot capability key + `secret_token` | Implemented + tested | `tests/integration/live-runtime.test.js` |
| Webhook removal, key rotation, masked URLs, hash-only storage | Implemented + tested | `tests/integration/live-runtime.test.js` |
| Update parsing (message, edited, callback, new member, unsupported) | Implemented + tested | `tests/unit/update-parser.test.js` |
| Exactly-once processing per `update_id` | Implemented + tested | `tests/integration/live-runtime.test.js` |
| In-process queue: bounded concurrency, dedupe, backoff retries | Implemented + tested | `tests/unit/queue.test.js` |
| Rate-limit-aware retry (honours `retry_after`), retries recorded | Implemented + tested | `tests/integration/live-runtime.test.js` |
| Real Telegram actions via the live transport | Implemented + tested against the Bot API mock; **not verified against api.telegram.org** | `tests/integration/live-runtime.test.js` |
| Cooldowns and concurrency guard per workflow | Implemented + tested | `tests/integration/live-runtime.test.js`, `tests/integration/advanced.test.js` |
| Dry-run routing probe | Implemented + tested | `tests/integration/live-runtime.test.js` |
| Live test lab (one real message, explicit confirmation) | Implemented + tested | `tests/integration/live-runtime.test.js`, `tests/e2e/live-runtime-ui.test.js` |
| Development long polling (refuses when a webhook is active / in production) | Implemented + tested (CLI guards) | `tests/integration/scripts.test.js` |
| Distributed queue / multi-replica runtime | Unavailable — single process by design; see `docs/DEPLOYMENT.md` | — |

## Logs, analytics, scheduling, restrictions

| Feature | Status | Evidence |
| --- | --- | --- |
| Execution log with filters, pagination, detail (steps, transcript, variables) | Implemented + tested | `tests/integration/simulator.test.js`, `tests/e2e/simulator-ui.test.js` |
| Log deletion with confirmation | Implemented + tested | `tests/integration/simulator.test.js` |
| Analytics: success rate, p50/p95, per-workflow, daily buckets, top errors | Implemented + tested | `tests/integration/advanced.test.js`, `tests/e2e/advanced-ui.test.js` |
| Honest empty states (no fabricated numbers) | Implemented + tested | `tests/integration/advanced.test.js` |
| Interval schedules from published schedule triggers | Implemented + tested | `tests/integration/advanced.test.js`, `tests/unit/scheduler.test.js` |
| Manual "Run now" for a schedule | Implemented + tested | `tests/integration/advanced.test.js`, `tests/e2e/advanced-ui.test.js` |
| Automatic scheduler loop | Implemented + tested manually; **off by default** (`SCHEDULER_ENABLED=false`) and unsuitable for sleeping free tiers | `docs/DEPLOYMENT.md` |
| Bot-level allow/block lists enforced in the runtime | Implemented + tested | `tests/integration/advanced.test.js` |
| Per-command allow/block lists | Implemented + tested | `tests/integration/advanced.test.js`, `tests/integration/command-replies.test.js` |
| Cron expressions / timezone-accurate scheduling | Unavailable — interval minutes only, `timezone` stored but the loop is UTC-based | — |

## Delivery, docs, operations

| Feature | Status |
| --- | --- |
| `.env.example`, `.gitignore`, `.dockerignore` | Implemented |
| Firestore / Storage / Realtime Database rules + indexes | Implemented (rules are committed; **not deployed** — see `docs/FIREBASE-SETUP.md`) |
| Dockerfile, Render blueprint | Implemented, **not built or deployed here** |
| README, setup, Firebase, Telegram, deployment, security, limitations, troubleshooting docs | Implemented |
| Feature-completion matrix (this file) | Implemented |
| Automated unit / integration / e2e tests | 217 passing |
| CI pipeline config | Implemented — `.github/workflows/test.yml` runs `npm run test:all` on Node 20 and 22 |
| Real production deployment | Not performed |
