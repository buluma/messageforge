# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

MessageForge — a multi-device WhatsApp bot built on Node.js and `@whiskeysockets/baileys` (aliased to `gifted-baileys`). The bot connects to WhatsApp via QR scan or a `SESSION_ID` environment variable, then dispatches commands to ~200 plugin files. It also runs a web-based admin dashboard (`smm/`) served on the same Express port.

## Commands

```bash
# Run the bot
node messageforge.js
# or
npm start

# PM2 (production)
pm2 start ecosystem.config.js
pm2 restart messageforge
pm2 logs messageforge --lines 50

# Install dependencies (requires Node >=20, ffmpeg, ffprobe, webp system packages)
npm install

# Docker (docker-compose.yml is the canonical way — recommended for production)
docker compose up -d
docker compose logs -f messageforge

# Tests
npm test          # Jest suite (unit + integration)
npm run lint      # ESLint (0 errors required; warnings are informational)
npm run lint:fix  # Auto-fix lint issues
```

## Architecture

### Boot flow

`messageforge.js` → loads session → calls `connectToWhatsApp()` → creates Baileys socket → registers event handlers → starts Express server on port `25680` → delegates command dispatch to `handler.js`.

### Configuration

All runtime settings live in `config.js`, which reads from environment variables (or `config.env` via dotenv). Copy `sample.env` → `config.env` to configure locally. Key vars:

| Var | Purpose |
|-----|---------|
| `SESSION_ID` | Compressed base64 session (`MessageForge~<b64>` format). Omit to use QR. |
| `OWNER_NUMBER` | Phone number (digits only) of the bot owner |
| `PREFIX` | Command prefix (default `.`). Supports comma-list, `any`, or empty |
| `MODE` | `public` / `private` / `both` — who can use the bot |
| `THEME` | Active theme name (matches a file in `themes/`) |
| `DATABASE_TYPE` | `json` (default) or `postgres` |
| `POSTGRES_*` | Host/port/user/password/db when using postgres |
| `MESSENGER_HISTORY_MAX` | Max messages stored per chat (default 3000) |

### Plugin system (`plugins/`)

Each plugin file exports one object (or an array of objects):

```js
module.exports = {
    commands:    ['cmd1', 'cmd2'],
    description: 'What it does',
    permission:  'public',           // 'public' | 'admin' | 'owner'
    group:       true,               // set false to block in groups
    private:     true,               // set false to block in private chat
    botAdmin:    false,              // set true if bot needs admin role
    run: async (sock, message, args, ctx) => { ... }
};
```

`handler.js` loads all plugins on startup, resolves typos via Levenshtein distance, checks permissions, and calls `plugin.run(sock, message, args, ctx)`.

The `ctx` object passed to `run` contains:
- `sock` — raw Baileys socket
- `jid` / `sender` — chat JID (where to reply)
- `from` — sender JID (individual who typed the command)
- `isGroup`, `isAdmin`, `isBotAdmin`, `isOwner`, `isSudo`
- `args` — array of words after the command
- `text` — full message text
- `prefix` — canonical prefix string
- `reply(text)` — shorthand to quoted-reply
- `safeSend(content, opts)` — rate-limited send (max 30/min)
- `theme` — active theme strings (`getActiveTheme().global`)
- `getStr(key)` — fetch themed string by key
- `groupMetadata` — cached group metadata (5 min TTL)

### Key files

| File | Role |
|------|------|
| `messageforge.js` | Entry point, Baileys socket, event wiring, Express server, all API routes, anti-delete, anti-VV, status saver |
| `handler.js` | Plugin loader, command dispatch, permission checks, LID resolution |
| `config.js` | Config with env-var defaults |
| `lib/messengerStore.js` | LRU message cache, write queue per JID, dual JSON/Postgres backend, soft-delete |
| `lib/faceIndexer.js` | Face recognition pipeline (face-api.js + canvas), person clustering, face crop storage |
| `lib/database.js` | PostgreSQL connection pool (`getPgPool()`) |
| `lib/theme.js` | Theme loader (`themes/*.json`) and `getStr()` helper |
| `lib/statusManager.js` | WhatsApp status broadcast handler (auto-seen, auto-react, status saver) |
| `lib/dlmedia.js` | Media download utilities |
| `lib/aiClient.js` | AI integration client |
| `lib/state.js` | Global state persistence |

### Admin dashboard (`smm/`)

Single-page app served at `/`. All JS uses ES modules (`import/export`). Entry point is `smm/js/main.js`. Views are toggled by `.rail-btn[data-view]` → `.view#view-<name>`.

| File | Role |
|------|------|
| `smm/js/main.js` | Entry: mounts all views, initialises socket, handles rail navigation |
| `smm/js/socket.js` | Socket.IO wrapper; re-emits `new-message`, `presence-update`, `reaction-update` as DOM CustomEvents |
| `smm/js/messenger.js` | Chats view — list, thread render, send, reply, pin, presence badge |
| `smm/js/media.js` | Media gallery — grid, lightbox, sort/filter, people section, merge/delete persons |
| `smm/js/dashboard.js` | Dashboard view — GitHub stats, commit chart |
| `smm/js/api.js` | Axios wrapper with auth token management |
| `smm/js/state.js` | Shared frontend state (active socket reference) |

Dashboard auth uses a token stored in `localStorage`. Socket.IO connection passes the same token via `opts.auth`. The `/api/auth/config` endpoint tells the frontend whether auth is required.

### Message storage (`lib/messengerStore.js`)

Dual backend — JSON files under `data/messenger-history/` or PostgreSQL when `DATABASE_TYPE=postgres`. LRU in-memory cache (bounded by `MESSENGER_CACHED_CHATS`, default 50). Write operations are queued per JID to prevent concurrent file corruption.

- **Soft-delete**: `softDeleteChat(jid)` removes local messages and hides the chat; auto-restores when the next message arrives. Persisted in `data/hidden-chats.json`.
- **Index**: `data/messenger-history/index.json` tracks which JIDs have history files.

### Media gallery & thumbnails

`GET /api/media` scans `data/` recursively, **skipping dot-directories** (`.thumbs`, `.faces`). Thumbnails generated lazily by ffmpeg with a 3-process concurrency limit. `ffprobe` probes video duration first; thumb is captured at 10% to avoid black frames. Thumbs cached at `data/.thumbs/<sha1>.jpg` with `Cache-Control: immutable`.

### Face recognition (`lib/faceIndexer.js`)

Uses `face-api.js` with its bundled tfjs 1.7.0. **Do not `require('@tensorflow/tfjs-node')`** — tfjs 4.x conflicts and corrupts the bundled version. `canvas` npm package provides Node.js image rendering; `monkeyPatch` requires the `Canvas` class (not `createCanvas` factory) for `instanceof` checks.

- Models auto-downloaded on first scan to `data/face-models/` from the face-api.js GitHub weights repo.
- `loadPromise` is cleared on failure so the next scan retries instead of permanently rejecting.
- Face crops stored in `data/.faces/`, index in `data/face-index.json`.
- Clustering uses euclidean distance with `MATCH_THRESHOLD = 0.45`.

### Express API routes (all under `/api`, auth-gated except `/api/auth/config`)

| Route | Purpose |
|-------|---------|
| `GET /api/chats` | Chat list with latest message |
| `GET /api/chat/:jid/messages` | Paginated message history |
| `POST /api/send` | Send a message |
| `POST /api/delete-message` | Delete a message |
| `POST /api/toggle-pin` | Pin/unpin a chat |
| `POST /api/react` | Send a reaction |
| `POST /api/typing` | Send typing presence |
| `POST /api/subscribe-presence` | Subscribe to presence for a JID |
| `GET /api/media` | List all local media files |
| `GET /api/media/thumb` | Lazy-generate and serve thumbnail |
| `DELETE /api/media` | Delete media file + its thumbnail |
| `GET /api/media/persons` | List face-clustered persons |
| `POST /api/media/index-faces` | Start face indexing job |
| `GET /api/media/index-status` | Poll indexing progress |
| `PATCH /api/media/persons/:id` | Rename person or merge (`{ mergeInto }`) |
| `DELETE /api/media/persons/:id` | Delete person and face crops |
| `GET /api/plugins` | List loaded plugins |
| `GET /api/me` | Bot JID info |

### Persistent data (`data/`)

| Path | Contents |
|------|----------|
| `data/messenger-history/` | Per-JID JSON message history + `index.json` |
| `data/hidden-chats.json` | Soft-deleted chat JIDs |
| `data/sudo.json` | Sudo-user JIDs |
| `data/push-names.json` | Display name cache |
| `data/lid-phone-cache.json` | LID→phone cache (flushed every 30s) |
| `data/.thumbs/` | Video/image thumbnail cache (dot-dir, excluded from media scan) |
| `data/.faces/` | Face crop images (dot-dir, excluded from media scan) |
| `data/face-index.json` | Face clustering index |
| `data/face-models/` | Downloaded face-api.js model weights |

### Session (`session/`)

Baileys multi-file auth state. Do not commit. Restored from `SESSION_ID` env var on first run (only when `creds.json` is absent — overwriting breaks Signal encryption).

### LID handling

Modern WhatsApp uses `@lid` identifiers instead of phone numbers in groups. `messageforge.js` maintains `global.lidJidMap` and `global.lidPhoneCache`; `handler.js` resolves `@lid` senders against group participant lists before permission checks. Always use `jidToNum()` / `sameNumber()` from `handler.js` rather than splitting JIDs manually.

### Anti-ban protection

`handler.js`'s `safeSend()` enforces a 30-message-per-minute rate limit with random jitter (100–500 ms) on every outgoing message. Do not bypass this with direct `sock.sendMessage()` calls from within plugins except for time-sensitive operations like delete-and-warn.

### Route ordering in `messageforge.js`

Express routes for `/api/media/face`, `/api/media/index-status`, `/api/media/index-faces`, and `/api/media/persons` **must be declared before** `app.get('/api/media/:jid/:msgId', ...)` to prevent the parameterised route matching internal paths.
