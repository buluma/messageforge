# MessageForge TODO

Spec: [docs/07-BAILEYS-GAP-SPEC.md](docs/07-BAILEYS-GAP-SPEC.md)
Verification: [docs/08-BAILEYS-GAP-VERIFICATION.md](docs/08-BAILEYS-GAP-VERIFICATION.md)
Audit source: project-wide pass 2026-05-02

---

## P0 — Security (do today)

### Credential hygiene (verified 2026-05-02)
- [x] `.env` and `config.env` already in `.gitignore`
- [x] Git history clean — `config.env` only ever had `PREFIX=.`; `.env` never committed; no keys in GitHub history
- [x] `config.env` still exists locally — delete it; `.env` is canonical
- [x] Updated `config.js` to load `.env` as fallback when `config.env` absent
- [x] Sync `sample.env` to current full key set (no values)

### Auth gaps
- [x] `DELETE /api/media` auth — covered by blanket `app.use('/api', requireDashboardAuth)` at line 1782. No action needed.
- [x] Audit public-by-design routes: `/health`, `/ping`, `/api/local-commit-activity` — `/api/local-commit-activity` is auth-protected via `app.use('/api', requireDashboardAuth)`; `/health` + `/ping` are intentionally public liveness probes

### Express route shadowing
- [x] Verified 2026-05-02: no actual conflict. `/api/media/face` already at line 2141 (before :jid/:msgId at 2143). Single-segment paths (persons, index-status, index-faces) don't match the two-segment `:jid/:msgId` pattern. PATCH/DELETE on `/api/media/persons/:id` don't conflict with GET-only `:jid/:msgId`. CLAUDE.md note documents protective intent; routing is correct.

---

## P1 — High Impact

### Split messageforge.js (117k → modules)
- [x] Extract `lib/mediaRoutes.js` from lines 2283–2488; mount via `app.use('/api/media', ...)`
- [x] Extract `lib/antiDelete.js` from lines 757–759, 1059–1101, 1182–1186; export `bindAntiDelete(sock, messageCache)`
- [x] Extract `lib/statusRoutes.js` for status saver/auto-react wiring
- [x] Extract face routes (lines 2492–2529) into `lib/faceRoutes.js`; keep `lib/faceIndexer.js` as engine
- [x] After extraction: messageforge.js target <30k lines, only socket boot + event wiring

### Memory caps
- [x] `global.lidJidMap` capped at 20k, evict oldest 10% on overflow
- [x] `global.lidPhoneCache` capped at 60k, evict oldest 10% on overflow
- [x] `messageCache` anti-delete: added standalone `setInterval` sweep every 5min using `MESSAGE_CACHE_TTL_MS`; removed redundant inline sweep from upsert handler
- [x] `groupCache` in `handler.js` — added `setInterval` to evict expired entries every 5min, not just on-access

### Atomic writes (corruption on crash)
- [x] `lib/messengerStore.js` — `safeWriteJson` now writes tmp then renames
- [x] `lib/faceIndexer.js" — `saveIndex` now writes tmp then renames
- [x] Audit per-JID history file writes for same pattern (only writer is `lib/messengerStore.js`; `messageforge.js` only reads for `/api/search`)
- [x] Wrap `safeWriteJson(INDEX_FILE)` in try/catch (`messengerStore.js` `addToIndex`)

### Anti-ban: `safeSend` bypass audit
- [x] `plugins/antibot.js` — group confirmation message now uses `ctx.safeSend`
- [x] `plugins/antidemote.js` — already used `ctx.safeSend` (audit was wrong)
- [x] 597 total `sock.sendMessage` calls across plugins — `installSendGuard()` wraps `sock.sendMessage`, so plugin calls are still paced/jittered; no unguarded text responses found
- [x] Add ESLint rule banning `sock.sendMessage` in `plugins/**` to catch regressions (warns on plain-text `sock.sendMessage({text: ...})`)

### Sync FS in plugins
- [x] Verified 2026-05-02: `antigm`, `antifake`, `bookmark`, `greet`, `warn`, `notes` all load once at startup and save only on explicit admin commands — not hot-path. `leveling.js` already debounces saves. No migration needed for these.
- [x] `usage-analytics.js` — already debounced at 1s via `scheduleSave()`; `auditlog.js` — already debounced at 10s via `global._auditSaveTimer`. No migration needed.

### Silent error swallowing
- [ ] `messageforge.js` send guard queue — `.catch(() => {})` on `queue`/`priorityQueue` chains is intentional (keeps queue alive; errors surface via `result`). No action needed.
- [x] `messageforge.js` — `void messengerStore.persistMessages()` → now logs WARN on failure (both event handler and `/api/send` route)
- [x] `lib/messengerStore.js" write queue — `.catch(() => {})` → logs `jid` + `err.message` via logger
- [x] `plugins/antivv.js` — react `.catch(() => {})` → `console.warn` with message
- [x] `plugins/anticall.js` — all `catch { /* ignore */ }` → `console.warn` with context
- [x] `lib/aiClient.js:139` — log `err.message` before continuing
- [x] `lib/aiClient.js:130` — sanitize axios error before logging (strip Authorization header)

### faceIndexer retry bug
- [x] `lib/faceIndexer.js` — reset `modelsLoaded = false` alongside `loadPromise = null` on failure
- [x] Add 3x exponential backoff retry around model fetch via `fetchWithRetry()`

---

## P2 — Quality

### Tests
- [x] Added `.github/workflows/test.yml` — runs `npm test` on push + PR, Node 20.x + 22.x matrix
- [x] Added `.github/workflows/lint.yml` — runs `npm run lint` (ESLint errors fail build, warnings pass)
- [x] Added ESLint v9 with flat config (`eslint.config.mjs`), `no-restricted-syntax` rule warns on `sock.sendMessage` in plugins
- [x] Added `lint` and `lint:fix` scripts to `package.json`
- [x] Add coverage threshold to `jest` config (baseline): `statements: 24, branches: 20, lines: 25, functions: 15`
- [x] Write tests for handler dispatch (permission gates, prefix resolution, typo correction) — `tests/handler.test.js`
- [x] Write test stubs for 10 representative plugins (alive, antidelete, ai, downloader, group) — `tests/plugins.smoke.test.js`
- [x] Add tests for messengerStore soft-delete + auto-restore round trip — `tests/messengerStore.test.js`
- [x] Add test for atomic write + crash simulation (tmp + rename pattern) — `tests/messengerStore.test.js`
- [ ] Mark test + lint as required checks in branch protection

### Dashboard XSS + CSP
- [x] `smm/js/media.js` — added `escapeHtml` import; applied to `f.name`, `f.folder`, `f.url` in grid template, lightbox `alt`, person `name`/`jid`, duplicate grid filenames, error message in innerHTML
- [x] `smm/js/messenger.js` — already used `escapeHtml` throughout (was correct)
- [x] Lightbox Escape key — already existed in `media.js:564`; audit finding was wrong
- [x] Add CSP `<meta>` to `smm/messageforge.html`
- [ ] Sweep remaining `innerHTML` in `smm/js/*` for unescaped untrusted strings (low priority — main surfaces fixed)

### Dashboard memory + lifecycle
- [x] Verified: mount functions (`mountMessenger`, `mountDashboard`, `mountMedia`) called once at startup; view switches are CSS-only. Listener accumulation does not occur. `chatTimeTicker` running forever is correct for this SPA pattern.

### Messenger view UX
- [x] Dedup: check `state.renderedMsgIds.has(m.key.id)` before append (`messenger.js`)
- [x] Cursor pagination on "Load older" (`messenger.js`); uses existing `limit`+`before` API params
- [x] Show file size in delete confirm dialog (`media.js`)
- [x] Add `Escape` keybinding to close lightbox (`media.js`)
- [x] Add `Escape` to close QR popup (`messenger.js`)

### Input validation
- [x] Added `isValidJid(jid)` helper in `messageforge.js` + `VALID_PRESENCE_STATES` set
- [x] Applied to all POST handlers: `/api/send`, `/api/toggle-pin`, `/api/react`, `/api/delete-message`, `/api/typing`, `/api/subscribe-presence`
- [x] Presence state whitelisted — falls back to `composing` if invalid
- [x] Magic-byte MIME check in `lib/mediaRoutes.js` `checkMagicBytes()` — rejects upload on mismatch

### DB hardening
- [x] `lib/database.js` — `max: Number(process.env.DB_POOL_MAX || 20)`
- [x] Bump `connectionTimeoutMillis` 2s → 5s
- [x] Add reconnect-on-error + healthcheck query on pool error
- [x] Audit all SQL: ensure parameterized, no string interpolation (queries use `$1` params; only `${TABLE_NAME}` interpolation is constant internal)

---

## P3 — Polish

### Lib modules
- [x] `lib/state.js:56` — `saving` flag mutex around autosave
- [x] `lib/state.js:27` — type-validate loaded data; default `[]` if not array
- [x] `lib/dlmedia.js` — `Promise.race` 60s timeout on download
- [x] `lib/dlmedia.js` — max size guard (env `MEDIA_MAX_MB`, default 100)
- [x] `lib/theme.js:21` — fallback to key string when missing instead of null
- [x] `lib/statusManager.js:113` — switch dedup to time-based map (1h TTL) not LRU shift
- [x] `lib/messengerStore.js:117` — `Promise.race` 30s timeout on write queue
- [x] `lib/messengerStore.js:605` — `getMessageById` async/sync mismatch with Postgres path

### Config centralization
- [x] Moved to `config.js`: `PORT`, `SEND_GUARD_MAX_PER_MIN`, `LID_JID_MAP_MAX`, `LID_PHONE_CACHE_MAX`, `GROUP_CACHE_TTL_MS`, `MESSAGE_CACHE_TTL_MS`, `MESSENGER_CACHED_CHATS`, `FACE_MATCH_THRESHOLD`, `MEDIA_MAX_MB`, `DB_POOL_MAX`
- [x] `messengerStore.js`, `database.js`, `faceIndexer.js`, `dlmedia.js`, `handler.js`, `messageforge.js` all read from `config.*` instead of inline literals
- [x] `FACE_MATCH_THRESHOLD` env override added

### Plugin hygiene
- [x] Audit permission/group/private combos across plugins; added `scripts/audit_plugins.js` + fixed unsupported `permission: 'member'` in `groupinfo.js` (now `public`)
- [x] Shared `checkPermission(plugin, ctx)` helper in handler.js to dedupe per-plugin guards
- [x] Centralize common plugin imports (config/theme helpers) into ctx; migrated most plugins off `require('../lib/theme')` and several off `require('../config')` (remaining exceptions are intentional/special-case)

### Infra
- [x] `ecosystem.config.js` — add `error_file`, `out_file`, `log_date_format`
- [x] Dockerfile — non-root user, multi-stage build
- [x] Dockerfile — verify `.dockerignore` excludes node_modules, .git, tests
- [x] docker-compose — move `POSTGRES_PASSWORD` to Docker secret
- [x] docker-compose — verify `/health` endpoint matches healthcheck path

### Repo cleanup
- [x] Deploy story: Docker primary via `docker compose up -d` (documented in CLAUDE.md + README)
- [x] Moved `Procfile`, `app.json`, `.replit`, `replit.nix`, `replit.md` → `docs/deploy-archive/`
- [x] README updated: Docker canonical deploy section, Heroku section removed, test/lint commands added
- [x] Updated CLAUDE.md: replaced outdated comment with `npm test` / `npm run lint` docs

### Accessibility
- [x] Add `aria-label` on icon-only buttons in `smm/messageforge.html`
- [x] `role="dialog"` on modals, `role="status"` on typing indicator
- [x] Keyboard nav: Tab order, focus trap on lightbox + popups

### Logging
- [x] Replace bare `console.log/warn/error` in `messageforge.js` with `logMessage()` wrapper
- [x] `handler.js:952` — use imported `logger.error` not `console.error`
- [x] Add structured-log mode (JSON lines) toggle for prod

---

## Pre-existing (carry over)

- [x] Rework event handling around `sock.ev.process()` across remaining handler-level listeners
  - [x] `bindGroupCacheInvalidation` — converted to no-op; `groupCache.delete(id)` now called inside `messageforge.js`'s `onGroupParticipantsUpdate` (in `ev.process` block)
  - [x] `setupConnectionHandlers` — both `ev.on('connection.update')` and `ev.on('group-participants.update')` removed; function is no-op; logic moved into `ev.process` block
  - [x] Plugin `onGroupParticipantsUpdate` hooks now fire once (via `ev.process`), not twice
  - [x] Reconnect safety preserved: new socket gets fresh `ev.process` handler; no listener accumulation
- [ ] Execute and record full manual verification pass from `docs/08-BAILEYS-GAP-VERIFICATION.md`
  - [ ] confirm permission gates
  - [ ] confirm private vs group behavior
  - [ ] confirm owner-only actions
  - [ ] confirm reconnect does not duplicate listeners
- [ ] 75 startup collision warnings: `social-tools.js`, `security-tools.js`, `text-tools.js` etc. bundle plugins duplicate individual plugins. Decision needed: keep bundles and remove individuals, or remove bundle overlap. First-match wins so bot works; warnings are noise.

## Release Hygiene
- [x] Confirm no secret leakage — verified 2026-05-02: `.env`/`config.env` excluded from git, no keys in committed history
