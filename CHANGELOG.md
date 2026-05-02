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

### Added
- `feat(smm)`: Add floating `scroll to latest` button in thread view
- `feat(smm)`: Add persistent chat label aliases with new endpoints:
  - `GET /api/chat-aliases`
  - `POST /api/chat-alias`
- `feat(smm)`: Add quick rename action (`✎`) in active chat header
- `feat(dashboard)`: Add local git activity API (`GET /api/local-commit-activity`) and plot local commits as a second chart dataset

### Changed
- `change(smm)`: Preserve active chat search filter when chat list refreshes or updates
- `change(smm)`: Auto-refresh dashboard every 60s only when dashboard view is active and tab is visible
- `change(dashboard)`: Show chart recency context via `Last commit ... ago` status text
- `change(pm2)`: Align PM2 runtime port back to `25680` in `ecosystem.config.js`

### Fixed
- `fix(smm)`: Always scroll to latest messages and keep message input focused when switching conversations
- `fix(smm)`: Prevent chat list load stalls by making unresolved-name hydration non-blocking in `/api/chats`
- `fix(smm)`: Improve contact name resolution for LID/JID variants and avoid self-name leakage in unrelated private chats
- `fix(smm)`: Restore own-linked chat labels (for bot/owner-linked numbers) when self-name guard is active

## [2.2.0](https://github.com/buluma/messageforge/compare/v2.1.0...v2.2.0) (2026-05-01)


### Features

* add media gallery, soft-delete chat history, and real presence status ([0094dd3](https://github.com/buluma/messageforge/commit/0094dd3f59effcea09944ce8e20649330e512f03))

## [2.1.0](https://github.com/buluma/messageforge/compare/2.0.0...v2.1.0) (2026-05-01)


### Features

* cap app log growth and add dashboard favicon ([8492828](https://github.com/buluma/messageforge/commit/84928287ac9ac99fbbc1cea9488673eb7dee3a5b))
* **smm:** improve chat UX, naming, aliases, and dashboard activity ([3013cd1](https://github.com/buluma/messageforge/commit/3013cd1b53a8e436fd6794dcb57a627ce1d516ce))

---

## [1.0.0] - 2026-05-01

### Added
- `feat(baileys)`: Add owner-only Baileys gap command surface via `plugins/baileys-gap.js`
  - privacy controls (`lastseen`, `online`, `profile`, `status`, `readreceipts`, `groupsadd`, `disappearing`)
  - chat controls (`chatarchive`, `chatunarchive`, `chatmute`, `chatunmute`, `chatread`, `chatunread`, `chatstar`, `chatunstar`, `chatdelete`, `chatclear`)
  - broadcast list inspection (`broadcastlist`, `blistinfo`)
  - profile-picture removal (`removepp`, `clearpp`)
  - explicit message edit (`msgedit`)
  - selected primitives (`waon`, `statusof`, `bizprofileof`, `ppurlof`, `presub`, `sendpresence`, `readmsg`)

### Changed
- `refactor(baileys)`: Consolidate socket-local event handling to `sock.ev.process()` dispatch in `createWhatsAppSocket()`

### Fixed
- `fix`: Wire runtime status mode and normalize command parsing
- `fix(baileys)`: Handle list-shaped `fetchStatus()` response correctly in `.statusof`
- `fix(baileys)`: Reset pairing retry flag when `requestPairingCode` fails to allow in-session retries

### Documentation
- `docs`: Add Baileys gap manual verification runbook (`docs/08-BAILEYS-GAP-VERIFICATION.md`)
- `docs`: Refresh command reference in `docs/03-COMMANDS.md`

---

## 2026-04-29

### Added
- `feat`: Standardize and colorize console logging

### Fixed
- `fix`: Import logger in messengerStore

---

## 2026-04-28

### Added
- `feat`: Route status saver to one inbox and auto-unfollow newsletters
- `feat`: Add PostgreSQL support for data persistence
- `feat(dashboard)`: Add search to plugins page
- `feat(menu)`: Replace half-border boxes with clean section layout
- `feat(smm)`: Focus message input when chat opens
- `feat(smm)`: Render WhatsApp text formatting in message bubbles
- `feat(smm)`: Move reactions and reply actions to bubble bottom, focus input on reply
- `feat(smm)`: Pin starred chats to top of chat list
- `perf(messenger)`: Cache messages + avatars to fix chat-switch lag

### Changed
- `chore`: Refine branding split and fix startup banner alignment
- `chore`: Switch to official @whiskeysockets/baileys
- `chore`: Add production docker compose for heimdal deployment
- `chore`: Update messenger reactions behavior and license text
- `chore(deps)`: Drop unused scrapers responsible for axios 0.x vulns
- `chore(deps)`: Force-patch transitive vulnerabilities via npm overrides
- `chore(deps)`: Add playwright + @playwright/test
- `chore(gitignore)`: Ignore .playwright-browsers
- `chore`: Untrack .gemini-tasks/state.json

### Fixed
- `fix`: Resolve postgres chat lookup and migration guard
- `fix`: Improve PostgreSQL message handling and pagination
- `fix`: Address PR review issues for LID mapping and lockfile source
- `fix(smm)`: Harden timestamp formatter + request timeouts, add chat-item meta layout
- `fix(smm)`: Normalize isPinned to boolean before sort comparison
- `fix(smm)`: Prevent emphasis parsing inside code spans and blocks
- `fix(tiktok)`: Use correct args index + delete files after telegram send
- `fix(dashboard)`: Patch current partial week into commit activity chart
- `fix(db)`: Only query MongoDB when the connection is ready

### Refactored
- `refactor`: Remove sticker plugins and related dependency chain
- `refactor`: Remove mongodb support and keep local/postgres backends

### Documentation
- `docs`: Add and link deployment checklist runbook
- `docs`: Add docker compose deployment and boot instructions
- `docs`: Retone README for developer-hacker workflow

### Merged
- Merge pull request #12: chore-switch-official-whiskeysockets-baileys
- Merge pull request #11: feature/postgres-support
- Merge pull request #10: feat/menu-redesign
- Merge pull request #9: feat/menu-redesign
- Merge pull request #8: feat/wa-text-formatting

---

## 2026-04-27

### Added
- `feat(tiktok)`: Add Telegram auto-forward integration
- `feat(tiktok)`: Add `.ttsend` command for manual Telegram upload
- `feat(tiktok)`: Improve watermark removal with multiple strategies
- `feat(tiktok)`: Add quality options, local storage, and management commands

### Fixed
- `fix(tiktok)`: Use ctx.command for accurate command detection

---

## 2026-04-26

### Added
- `feat`: Stabilize plugins and add OpenRouter->Ollama AI fallback
- `feat`: Add usage-based failure alerting
- `feat`: Revamp messenger panel and config wiring
- `feat`: Implement hybrid persistence and architectural hardening
- `feat`: Complete MessageForge rename (rebrand)

### Changed
- `chore`: Add ai provider observability and messageforge rebrand plan
- `chore`: Remove low-value and duplicate plugins
- `chore`: Untrack config.env for security
- `chore`: Complete MessageForge rebrand sweep

### Refactored
- `refactor`: Fix command execution logic and plugin architecture

### Documentation
- `docs`: Modularize documentation and add JSDoc comments

### Dependencies
- `deps`: Bump axios from 1.14.0 to 1.15.0
- `deps`: Bump @xmldom/xmldom from 0.8.11 to 0.8.13
- `deps`: Bump follow-redirects from 1.15.11 to 1.16.0
- `deps`: Bump lodash from 4.17.23 to 4.18.1
- `deps`: Bump file-type from 18.7.0 to 21.3.2
- `deps`: Bump @tootallnate/once, emoji-api and jsdom

### Merged
- Merge pull request #6: dependabot/npm_and_yarn/multi
- Merge pull request #5: dependabot/npm_and_yarn/file-type
- Merge pull request #4: dependabot/npm_and_yarn/follow-redirects
- Merge pull request #3: dependabot/npm_and_yarn/lodash
- Merge pull request #2: dependabot/npm_and_yarn/xmldom
- Merge pull request #1: dependabot/npm_and_yarn/axios

### Initial
- Initial commit with ShadowBot foundation

---

[Unreleased]: https://github.com/buluma/messageforge/compare/v2.3.0...HEAD
[2.3.0]: https://github.com/buluma/messageforge/compare/v2.2.0...v2.3.0
[2.2.0]: https://github.com/buluma/messageforge/compare/v2.1.0...v2.2.0
[2.1.0]: https://github.com/buluma/messageforge/compare/1.0.0...v2.1.0
[1.0.0]: https://github.com/buluma/messageforge/releases/tag/v1.0.0
