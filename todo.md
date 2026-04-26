# MessageForge Rebrand TODO (Strict Cutover)

## Completed
- [x] Runtime/process rename to `messageforge` (PM2 scripts, ecosystem app name, start scripts)
- [x] Entrypoint rename to `messageforge.js` and runtime file references updated
- [x] Plugin file rename from legacy `*-agent/*-owner/*-uptime/*-getjid/*-ai/*-ping/*-shorturl` to `messageforge-*`
- [x] Dashboard route/file rename to `smm/messageforge.html`
- [x] Package/repo identity update in `package.json`, lockfile metadata, and repo links
- [x] Default bot identity and env defaults switched to MessageForge (`config.js`, `sample.env`, `app.json`)
- [x] Core user-facing strings updated across menu, status, owner, profile, and utility plugins
- [x] Website/release/support links migrated to `github.com/buluma/messageforge`

## In Progress
- [ ] Final global sweep for any remaining legacy tokens in tracked files
- [ ] Remove deprecated legacy-only theme artifacts no longer needed

## Validation Checklist
- [ ] Legacy-branding grep check returns no matches in tracked project files
- [ ] PM2 process `messageforge` restarts cleanly
- [ ] Bot reconnects and responds to menu/owner/ai commands
- [ ] No regressions in date/time formatting responses

## Release
- [ ] Commit rebrand sweep changes
- [ ] Push branch after confirming no secret leakage (`.env`, sessions, tokens)
