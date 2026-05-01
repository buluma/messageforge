# MessageForge Rebrand TODO (Strict Cutover)

Spec: [docs/07-BAILEYS-GAP-SPEC.md](/Users/shadowwalker/Documents/GitHub/messageforge/docs/07-BAILEYS-GAP-SPEC.md)

## Baileys Gap Checklist
- [x] Add privacy-settings command group
  - [x] last seen
  - [x] online
  - [x] profile picture
  - [x] status
  - [x] read receipts
  - [x] groups add
  - [x] disappearing mode
- [x] Add chat-level management commands
  - [x] archive / unarchive
  - [x] mute / unmute private chats
  - [x] mark read / unread
  - [x] star / unstar
  - [x] delete chat / clear chat history if needed
- [x] Add pairing-code login support
  - [x] boot option or command to request pairing code
  - [x] fallback to QR/session flow
  - [x] keep it compatible with current auth handling
- [x] Add broadcast-list support
  - [x] fetch broadcast list info
  - [x] surface it in a command or admin tool
- [x] Add profile-picture removal support
  - [x] explicit remove / clear profile photo action
  - [x] optional companion command alongside update photo/name/bio
- [x] Add an explicit message-edit command
  - [x] send edit payload for a quoted message or message ID
  - [x] keep separate from the receive-side edited-message detector
- [x] Decide whether to expose more Baileys primitives directly
  - [x] onWhatsApp
  - [x] fetchStatus
  - [x] getBusinessProfile
  - [x] profilePictureUrl
  - [x] presenceSubscribe
  - [x] sendPresenceUpdate
  - [x] readMessages
- [ ] Rework event handling to `sock.ev.process()` later
  - [ ] keep this as a stability refactor, not a feature addition
  - [ ] schedule after the missing command surface is filled in
- [x] Add tests or manual verification notes for each new command
  - [x] confirm permission gates
  - [x] confirm private vs group behavior
  - [x] confirm owner-only actions
  - [x] confirm reconnect does not duplicate listeners
  - [x] notes added: [docs/08-BAILEYS-GAP-VERIFICATION.md](/Users/shadowwalker/Documents/GitHub/messageforge/docs/08-BAILEYS-GAP-VERIFICATION.md)

## Completed
- [x] Runtime/process rename to `messageforge` (PM2 scripts, ecosystem app name, start scripts)
- [x] Entrypoint rename to `messageforge.js` and runtime file references updated
- [x] Plugin file rename from legacy `*-agent/*-owner/*-uptime/*-getjid/*-ai/*-ping/*-shorturl` to `messageforge-*`
- [x] Dashboard route/file rename to `smm/messageforge.html`
- [x] Package/repo identity update in `package.json`, lockfile metadata, and repo links
- [x] Default bot identity and env defaults switched to MessageForge (`config.js`, `sample.env`, `app.json`)
- [x] Core user-facing strings updated across menu, status, owner, profile, and utility plugins
- [x] Website/release/support links migrated to `github.com/buluma/messageforge`
- [x] Docs + Developer Assets updated (docs/*.md, CONTRIBUTING.md, CLAUDE.md, etc.)

## In Progress
- [ ] (None - sweep complete)

## Validation Checklist
- [x] Legacy-branding grep check returns no matches in tracked project files
- [x] PM2 process `messageforge` restarts cleanly
- [x] Bot reconnects and responds to menu/owner/ai commands
- [x] No regressions in date/time formatting responses
- [x] PM2 process now runs from messageforge/ (not silva-md-bot/)

## Release
- [ ] Commit rebrand sweep changes
- [ ] Push branch after confirming no secret leakage (`.env`, sessions, tokens)
