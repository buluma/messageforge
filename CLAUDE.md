# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

MessageForge — a multi-device WhatsApp bot built on Node.js and `@whiskeysockets/baileys` (aliased to `gifted-baileys`). The bot connects to WhatsApp via QR scan or a `SESSION_ID` environment variable, then dispatches commands to ~200 plugin files.

## Commands

```bash
# Run the bot
node messageforge.js
# or
npm start

# Install dependencies (requires Node >=20, ffmpeg, webp system packages)
npm install

# Docker
docker build -t messageforge-md . && docker run -p 25680:25680 --env-file config.env messageforge-md
```

No test runner is configured. No lint script exists.

## Architecture

### Boot flow

`messageforge.js` → loads session → calls `connectToWhatsApp()` → creates Baileys socket → registers event handlers → delegates command dispatch to `handler.js`.

### Configuration

All runtime settings live in `config.js`, which reads from environment variables (or `config.env` via dotenv). Copy `sample.env` → `config.env` to configure locally. Key vars:

| Var | Purpose |
|-----|---------|
| `SESSION_ID` | Compressed base64 session (`MessageForge~<b64>` format). Omit to use QR. |
| `OWNER_NUMBER` | Phone number (digits only) of the bot owner |
| `PREFIX` | Command prefix (default `.`). Supports comma-list, `any`, or empty |
| `MODE` | `public` / `private` / `both` — who can use the bot |
| `THEME` | Active theme name (matches a file in `themes/`) |

### Plugin system (`plugins/`)

Each plugin file exports one object (or an array of objects) with this shape:

```js
module.exports = {
    commands:    ['cmd1', 'cmd2'],   // trigger words (no prefix)
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
| `messageforge.js` | Entry point, Baileys socket, event wiring, anti-delete, anti-VV, status saver |
| `handler.js` | Plugin loader, command dispatch, permission checks, LID resolution |
| `config.js` | Config with env-var defaults |
| `lib/theme.js` | Theme loader (`themes/*.json`) and `getStr()` helper |
| `lib/statusManager.js` | WhatsApp status broadcast handler (auto-seen, auto-react, status saver) |
| `lib/bgmTrigger.js` | Background music trigger logic |
| `lib/dlmedia.js` | Media download utilities |

### Themes (`themes/`)

JSON files keyed by theme name (e.g. `messageforge.json`, `friday.json`). Each contains a `STRINGS` object with a `global` section (botName, footer, greeting strings, error text). Active theme set via `THEME` env var. Switch at runtime with the `settheme` command.

### Persistent data (`data/`)

Runtime files written here:
- `sudo.json` — array of sudo-user JIDs (loaded at startup into `global.sudoUsers`)
- `lid-phone-cache.json` — LID→phone mapping cache (flushed every 30s, on SIGINT/SIGTERM)
- `push-names.json` — display name cache

### Session (`session/`)

Baileys multi-file auth state. Do not commit. Restored from `SESSION_ID` env var on first run (only when `creds.json` is absent — overwriting breaks Signal encryption).

### LID handling

Modern WhatsApp uses `@lid` identifiers instead of phone numbers in groups. `messageforge.js` maintains `global.lidJidMap` and `global.lidPhoneCache`; `handler.js` resolves `@lid` senders against group participant lists before permission checks. Always use `jidToNum()` / `sameNumber()` from `handler.js` rather than splitting JIDs manually.

### Anti-ban protection

`handler.js`'s `safeSend()` enforces a 30-message-per-minute rate limit with random jitter (100–500 ms) on every outgoing message. Do not bypass this with direct `sock.sendMessage()` calls from within plugins except for time-sensitive operations like delete-and-warn.

### Express server

`messageforge.js` starts an Express server on port `25680` (or `PORT` env). Routes: `/` (dashboard), `/health`, `/ping`. The `/ping` endpoint is hit every 25 min for Heroku keep-alive when `APP_URL` is set.
