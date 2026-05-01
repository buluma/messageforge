# MessageForge Rebrand TODO (Strict Cutover)

Spec: [docs/07-BAILEYS-GAP-SPEC.md](/Users/shadowwalker/Documents/GitHub/messageforge/docs/07-BAILEYS-GAP-SPEC.md)

## Baileys Gap Checklist
- [ ] Add privacy-settings command group
  - [ ] last seen
  - [ ] online
  - [ ] profile picture
  - [ ] status
  - [ ] read receipts
  - [ ] groups add
  - [ ] disappearing mode
- [ ] Add chat-level management commands
  - [ ] archive / unarchive
  - [ ] mute / unmute private chats
  - [ ] mark read / unread
  - [ ] star / unstar
  - [ ] delete chat / clear chat history if needed
- [ ] Add pairing-code login support
  - [ ] boot option or command to request pairing code
  - [ ] fallback to QR/session flow
  - [ ] keep it compatible with current auth handling
- [ ] Add broadcast-list support
  - [ ] fetch broadcast list info
  - [ ] surface it in a command or admin tool
- [ ] Add profile-picture removal support
  - [ ] explicit remove / clear profile photo action
  - [ ] optional companion command alongside update photo/name/bio
- [ ] Add an explicit message-edit command
  - [ ] send edit payload for a quoted message or message ID
  - [ ] keep separate from the receive-side edited-message detector
- [ ] Decide whether to expose more Baileys primitives directly
  - [ ] onWhatsApp
  - [ ] fetchStatus
  - [ ] getBusinessProfile
  - [ ] profilePictureUrl
  - [ ] presenceSubscribe
  - [ ] sendPresenceUpdate
  - [ ] readMessages
- [ ] Rework event handling to `sock.ev.process()` later
  - [ ] keep this as a stability refactor, not a feature addition
  - [ ] schedule after the missing command surface is filled in
- [ ] Add tests or manual verification notes for each new command
  - [ ] confirm permission gates
  - [ ] confirm private vs group behavior
  - [ ] confirm owner-only actions
  - [ ] confirm reconnect does not duplicate listeners

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
