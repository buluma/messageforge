# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.3.0] - 2026-05-02

### Security (P0)
- Deleted legacy `config.env`; `.env` is now canonical; `config.js` falls back correctly
- Synced `sample.env` to full current key set (all tuning variables documented, no values)
- Confirmed public-by-design routes (`/health`, `/ping`) are intentionally unauthenticated
- Applied `isValidJid()` + `VALID_PRESENCE_STATES` whitelist to all six POST JID handlers (`/api/send`, `/api/toggle-pin`, `/api/react`, `/api/delete-message`, `/api/typing`, `/api/subscribe-presence`)
- Added magic-byte MIME validation in `lib/mediaRoutes.js` — upload rejected when file content does not match declared extension
- Added CSP `<meta>` header to `smm/messageforge.html`
- Fixed remaining `innerHTML` XSS vectors: lightbox `src`/`alt`, message key ID in DOM attributes, reaction emoji from socket events
- Fixed PostgreSQL auth state `::jsonb` casting and manual serialization to prevent decryption crashes

### Reliability (P1)
- Extracted ~600 lines from `messageforge.js` into `lib/mediaRoutes.js`, `lib/antiDelete.js`, `lib/statusRoutes.js`, `lib/faceRoutes.js`
- Capped `global.lidJidMap` at 20k and `global.lidPhoneCache` at 60k with 10% eviction on overflow
- Added standalone `setInterval` sweep for `messageCache` TTL; added `setInterval` eviction for `groupCache` in `handler.js`
- `lib/messengerStore.js` and `lib/faceIndexer.js` atomic writes: tmp-then-rename pattern to prevent corruption on crash
- `lib/faceIndexer.js`: reset `modelsLoaded = false` on failure so next scan retries; added `fetchWithRetry()` with 3× exponential backoff around model downloads
- Reworked Baileys event handling: removed `ev.on()` listeners from `handler.js` (`connection.update`, `group-participants.update`); all event logic consolidated into `ev.process()` in `messageforge.js` — plugin hooks fire once, not twice on reconnect
- Improved error logging: `aiClient.js` logs before swallowing errors; sanitizes `Authorization` header from axios error logs; `messengerStore.js` write queue logs JID + error; `antivv.js` and `anticall.js` warn instead of silently ignoring
- Fixed write queue serialization in `lib/messengerStore.js` to ensure the queue remains locked until the writer finishes

### Quality (P2)
- Added `.github/workflows/test.yml` (Node 20.x + 22.x matrix) and `.github/workflows/lint.yml` CI
- Added ESLint v9 flat config (`eslint.config.mjs`) with `no-restricted-syntax` warn on bare `sock.sendMessage` in plugins
- Added `lint` and `lint:fix` scripts to `package.json`
- Added Jest coverage thresholds (baseline): statements 24%, branches 20%, lines 25%, functions 15%
- Added 82 tests: handler dispatch (permission gates, prefix resolution, typo correction), messengerStore soft-delete + auto-restore + atomic write, 10 plugin smoke tests
- Dashboard UX: message dedup before append, cursor pagination on "Load older", file size in delete confirm dialog, Escape key for lightbox and QR popup
- PostgreSQL pool hardening: max connections env-configurable (`DB_POOL_MAX`), connection timeout 2s → 5s, reconnect-on-error with healthcheck query
- Fixed logic errors in permission handler causing owner-restricted test failures

### Polish (P3)
- Centralized 10 runtime tuning constants into `config.js`: `PORT`, `SEND_GUARD_MAX_PER_MIN`, `LID_JID_MAP_MAX`, `LID_PHONE_CACHE_MAX`, `GROUP_CACHE_TTL_MS`, `MESSAGE_CACHE_TTL_MS`, `MESSENGER_CACHED_CHATS`, `FACE_MATCH_THRESHOLD`, `MEDIA_MAX_MB`, `DB_POOL_MAX`; all consumers read from `config.*`
- `lib/state.js`: saving-flag mutex around autosave; type-validate loaded data, default to `[]` if not array
- `lib/dlmedia.js`: 60s active cancellation timeout; `MEDIA_MAX_MB` size guard
- `lib/statusManager.js`: switched status dedup from LRU-shift to time-based map (1h TTL)
- `lib/messengerStore.js`: 30s write-queue timeout; fixed `getMessageById` async/sync mismatch on Postgres path
- `lib/theme.js`: fallback to key string on missing theme entry instead of null
- Docker: non-root user, multi-stage build, `POSTGRES_PASSWORD` via Docker secret
- PM2: added `error_file`, `out_file`, `log_date_format` to `ecosystem.config.js`
- Plugin hygiene: `scripts/audit_plugins.js` audit tool; `checkPermission()` helper in `handler.js`; ctx-level theme/config centralization across plugins
- Resolved all 75 startup plugin command collision warnings — bundle aliases kept, conflicting aliases removed from individual plugin files
- Dashboard accessibility: `aria-label` on icon-only buttons, `role="dialog"` on modals, `role="status"` on typing indicator, keyboard focus trap on lightbox and popups
- Structured JSON log mode toggle; `logMessage()` wrapper replaces bare `console.*` in `messageforge.js`

### Dashboard (smm) Improvements
- Added floating `scroll to latest` button in thread view
- Added persistent chat label aliases with new endpoints
- Added quick rename action (`✎`) in active chat header
- Added local git activity API and chart integration
- Improved contact name resolution for LID/JID variants

## [2.2.0] - 2026-05-01
- Added media gallery, soft-delete chat history, and real presence status

## [2.1.0] - 2026-05-01
- Capped app log growth and add dashboard favicon
- **smm:** improved chat UX, naming, aliases, and dashboard activity

## [1.0.0] - 2026-05-01
- Added owner-only Baileys gap command surface privacy/chat/broadcast controls

---

[Unreleased]: https://github.com/buluma/messageforge/compare/v2.3.0...HEAD
[2.3.0]: https://github.com/buluma/messageforge/compare/v2.2.0...v2.3.0
[2.2.0]: https://github.com/buluma/messageforge/compare/v2.1.0...v2.2.0
[2.1.0]: https://github.com/buluma/messageforge/compare/1.0.0...v2.1.0
[1.0.0]: https://github.com/buluma/messageforge/releases/tag/v1.0.0
