# Firebase setup

BotForge uses Firebase for two things: **Firestore** as the production database and (optionally)
**Firebase Authentication** as the identity provider. The Realtime Database is **not used by the
application** — see the warning in the rules section.

## 1. Project

Project used by this deployment (public identifiers only):

```js
const firebaseConfig = {
  apiKey: "AIzaSyCChxWVg-w1TiertkXlUrfUgcC19y-CPNw",
  authDomain: "hiiii-72d78.firebaseapp.com",
  databaseURL: "https://hiiii-72d78-default-rtdb.firebaseio.com",
  projectId: "hiiii-72d78",
  storageBucket: "hiiii-72d78.firebasestorage.app",
  messagingSenderId: "560685164053",
  appId: "1:560685164053:web:7f672f7503160ec868901c"
};
```

These values are **not secrets** — they identify the project and ship to the browser by design.
They live in `.env` (`FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_DATABASE_URL`,
`FIREBASE_STORAGE_BUCKET`, `FIREBASE_MESSAGING_SENDER_ID`, `FIREBASE_APP_ID`) and are served to
the frontend by `GET /api/v1/auth/config`.

What *is* secret and must never be committed or sent to a browser: the **service-account private
key** (`FIREBASE_PRIVATE_KEY`), the **vault key** (`TOKEN_ENCRYPTION_KEY`) and `LOCAL_AUTH_SECRET`.

## 2. Service account (server only)

Firebase console → Project settings → Service accounts → *Generate new private key*.

```env
FIREBASE_PROJECT_ID=hiiii-72d78
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@hiiii-72d78.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n"
```

Keep the literal `\n` escapes and the surrounding quotes; the app converts them to newlines.
Then verify:

```bash
npm run check:firebase
```

It prints the resolved modes and performs a write/read/delete round-trip. It never prints the key.

## 3. Authentication

Firebase console → Authentication → Sign-in method → enable **Email/Password**.
Set `AUTH_MODE=firebase`. The frontend then signs in with the Firebase Web SDK and sends the ID
token as `Authorization: Bearer <idToken>`; the backend verifies it with the Admin SDK.
`AUTH_MODE=local` (email/password sessions signed with `LOCAL_AUTH_SECRET`) exists only for
development and is refused when `NODE_ENV=production`.

## 4. Rules

Deploy with the Firebase CLI from the repository root:

```bash
npm i -g firebase-tools
firebase login
firebase deploy --only firestore:rules,firestore:indexes,storage --project hiiii-72d78
```

`firebase/firestore.rules` denies **all** client access:

```
match /{document=**} { allow read, write: if false; }
```

This is intentional. The browser never talks to Firestore; every read goes through the Express API,
which authenticates the user and scopes queries by `uid`. Even with a leaked client config an
attacker cannot read `botSecrets/*` (the encrypted token envelopes).

### Realtime Database rules

`firebase/database.rules.json` is deployed as **public read/write**, as requested:

```json
{ "rules": { ".read": true, ".write": true } }
```

> **Security warning — read this before relying on it.**
> These rules make the whole Realtime Database world-readable and world-writable to anyone who
> knows the `databaseURL`. BotForge stores **nothing** in the Realtime Database, so no BotForge
> token, workflow or execution record becomes public through this hole today. If you ever move
> bot data, tokens, or user records into the Realtime Database, those records **will** be
> publicly readable and writable. Before doing that, replace the rules with per-user rules such as
> `"users": { "$uid": { ".read": "auth != null && auth.uid === $uid", ".write": "auth != null && auth.uid === $uid" } }`
> and remove the root-level `true` rules.
>
> Deploy with:
> ```bash
> firebase deploy --only database --project hiiii-72d78
> ```

`firebase/storage.rules` also denies everything; no bot assets are stored in Storage.

## 5. Indexes

`firebase/firestore.indexes.json` contains the composite indexes used by
workflows (status + updatedAt), executions (status/workflowId + startedAt), audit logs and
scheduled jobs. Deploy them together with the rules; Firestore will otherwise return
`FAILED_PRECONDITION` for the filtered queries.
