# Local setup

## Requirements

- Node.js **20.11+** (developed and tested on Node 22)
- npm 10+
- No build tools: the frontend is plain ES modules served statically

## Steps

```bash
npm install
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # vault key
# paste the value into .env as TOKEN_ENCRYPTION_KEY
npm start
```

Open <http://localhost:8080>. An empty database starts with no accounts; click **Create account**.

## Environment variables

| Variable | Default | Notes |
| --- | --- | --- |
| `NODE_ENV` | `development` | `production` refuses `AUTH_MODE=local` and `DB_MODE=json` |
| `PORT` | `8080` | HTTP port |
| `APP_BASE_URL` | `http://localhost:$PORT` | used for links and as webhook base fallback |
| `AUTH_MODE` | auto (`firebase` if admin creds exist, else `local`) | `local` is dev-only |
| `LOCAL_AUTH_SECRET` | — | ≥32 chars, required for local auth |
| `LOCAL_AUTH_SESSION_TTL_SECONDS` | `604800` | 7 days |
| `DB_MODE` | auto (`firestore` if admin creds exist, else `json`) | |
| `JSON_DB_PATH` | `backend/.data/db.json` | local store path |
| `FIREBASE_PROJECT_ID` / `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY` | — | Admin SDK (server only, never shipped) |
| `FIREBASE_API_KEY` / `FIREBASE_AUTH_DOMAIN` / `FIREBASE_DATABASE_URL` / `FIREBASE_STORAGE_BUCKET` / `FIREBASE_MESSAGING_SENDER_ID` / `FIREBASE_APP_ID` | — | public client config, served by `GET /api/v1/auth/config` |
| `TOKEN_ENCRYPTION_KEY` | — | base64 32 bytes; **required** |
| `TOKEN_ENCRYPTION_KEY_VERSION` | `1` | written into new envelopes |
| `TOKEN_ENCRYPTION_KEY_V2` … | — | additional keys for rotation |
| `TELEGRAM_API_BASE_URL` | `https://api.telegram.org` | must be HTTPS |
| `TELEGRAM_WEBHOOK_BASE_URL` | — | public HTTPS base for webhooks; required to register one |
| `TELEGRAM_API_TIMEOUT_MS` | `10000` | per Bot API call |
| `ALLOWED_ORIGINS` | empty (= same-origin) | comma separated browser origins |
| `RATE_LIMIT_*`, `CONNECT_RATE_LIMIT_MAX_REQUESTS` | 120/min, 10/min | general and sensitive limits |
| `MAX_JSON_BODY_BYTES` | `262144` | request body cap |
| `EXECUTION_TIMEOUT_MS` / `EXECUTION_MAX_STEPS` | `15000` / `60` | workflow run limits |
| `QUEUE_CONCURRENCY` | `4` | live-runtime workers |
| `EXECUTION_RETENTION_DAYS` | `30` | guidance for pruning (see `pruneExecutions`) |
| `SCHEDULER_ENABLED` | `false` | interval schedules run automatically only when true |
| `HTTP_ACTION_ALLOWED_HOSTS` | empty | enables HTTP nodes for these HTTPS hosts only |
| `TRUST_PROXY` | `0` | set to the proxy hop count behind a load balancer |
| `LOG_LEVEL` | `info` | `error` keeps test output quiet |

## Tests

```bash
npm run test:unit          # pure logic: schema, engine, expressions, queue, scheduler
npm run test:integration   # HTTP API against a real Express app + Telegram mock
npm run test:e2e           # real UI modules in jsdom against a live local server
npm run test:all           # everything (~60 s)
```

Tests never touch the network: `tests/helpers/mock-telegram.js` replaces the Bot API transport and
fails loudly on an unexpected URL. Each suite uses its own temporary JSON store.

## Project layout

See the architecture section of the [README](../README.md). The important boundary is that
`shared/` is imported by both the browser and the server, while `backend/src/services/` is
server-only (it handles decrypted tokens).
