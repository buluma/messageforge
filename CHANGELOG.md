# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/buluma/messageforge/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/buluma/messageforge/releases/tag/v1.0.0
