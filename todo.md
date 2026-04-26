# Option 3 Rebrand TODO: `MessageForge` (Strict Non-Legacy Cutover)

## 0) Guardrails
- [ ] Create a dedicated branch: `chore/rebrand-messageforge`
- [ ] Back up current env files (`.env`, `config.env`) before edits
- [ ] Decide exact new brand values:
  - [ ] Product name: `MessageForge`
  - [ ] Command alias policy: remove legacy aliases immediately
  - [ ] GitHub org/repo target
  - [ ] Website/support links
  - [ ] Social links

## 1) Runtime + Process Renames
- [ ] Rename PM2 app name in `ecosystem.config.js` (`messageforge`)
- [ ] Update PM2 scripts in `package.json`:
  - [ ] `pm2:restart`
  - [ ] `pm2:stop`
  - [ ] `pm2:logs`
  - [ ] `pm2:delete`
- [ ] Update deploy/runtime references:
  - [ ] `Procfile`
  - [ ] `Dockerfile` labels/description
  - [ ] `app.json` app metadata

## 2) Package + Repository Identity
- [ ] Update `package.json` identity fields:
  - [ ] `name`
  - [ ] `description`
  - [ ] `repository.url`
  - [ ] `homepage`
  - [ ] `bugs.url`
  - [ ] `keywords`
  - [ ] `author` / `contributors` if needed
- [ ] Regenerate `package-lock.json` metadata consistency
- [ ] Update hardcoded repo links in plugins/core (`repo.js`, `menu.js`, agent plugin, dashboard assets)

## 3) Bot UX Rebrand (User-Facing Text)
- [ ] Update default branding in `config.js` fallbacks (`BOT_NAME`, `OWNER_NAME`, status strings)
- [ ] Update `sample.env` defaults
- [ ] Update theme defaults:
  - [ ] Rename `themes/silva.json` -> `themes/messageforge.json`
  - [ ] Update theme content strings (`botName`, footer, titles)
  - [ ] Set default theme to `messageforge`
- [ ] Replace user-facing strings in plugins/core:
  - [ ] “ShadowBot”
  - [ ] “SilvaTech”
  - [ ] “Powered by ShadowBot”
  - [ ] social/contact links

## 4) Command/Intent Rebrand
- [ ] Update command aliases:
  - [ ] agent plugin command list
  - [ ] natural-language examples currently using legacy invocation
- [ ] Update handler shortcuts in `handler.js` (`messageforge|agent` trigger logic)
- [ ] Remove all legacy command triggers and parser paths

## 5) File/Path Renames (Deep Rebrand)
- [ ] Rename entrypoint to `messageforge.js` (or `bot.js`)
- [ ] Update all references to renamed entry file:
  - [ ] `package.json` (`main`, `start`)
  - [ ] `ecosystem.config.js`
  - [ ] `Procfile`
  - [ ] docs and scripts
- [ ] Rename dashboard filename `smm/silva.html` -> `smm/messageforge.html` and patch routes
- [ ] Rename plugin files prefixed `silva-*` to `messageforge-*`

## 6) Docs + Developer Assets
- [ ] Update all docs:
  - [ ] `README.md`
  - [ ] `CONTRIBUTING.md`
  - [ ] `docs/*`
  - [ ] `replit.md`
  - [ ] `CLAUDE.md`
  - [ ] `AGENTS.md` only if project instructions need brand updates
- [ ] Replace legacy URLs:
  - [ ] session generator links
  - [ ] deploy helper links
  - [ ] repo links

## 7) Dashboard/UI Assets
- [ ] Update dashboard branding in:
  - [ ] `smm/messageforge.html`
  - [ ] `smm/js/dashboard.js`
- [ ] Update page titles, logos, GitHub URLs, repo constants

## 8) Search-and-Replace Sweep
- [ ] Global sweep terms (case-sensitive and insensitive):
  - [ ] `silva-bot`
  - [ ] `silva-md-bot`
  - [ ] `silva-md-v4`
  - [ ] `SilvaMD`
  - [ ] `SilvaTech`
  - [ ] `ShadowBot`
  - [ ] `silva`
- [ ] Remove all matches from tracked source/docs/runtime files (except historical git metadata)

## 9) Validation Matrix
- [ ] Static checks:
  - [ ] `node --check` on touched JS files
  - [ ] formatting check
- [ ] Runtime checks:
  - [ ] PM2 start/restart works under new app name
  - [ ] bot connects to WhatsApp
  - [ ] dashboard reachable
- [ ] Command checks:
  - [ ] AI commands (`.chatai`, `.gemini`, agent)
  - [ ] menu/help displays new name
  - [ ] repo/about commands show new URLs
  - [ ] date/status replies unchanged functionally
- [ ] Negative checks:
  - [ ] `rg -n "silva|ShadowBot|SilvaTech|SilvaMD" -S` returns zero in tracked files
  - [ ] no legacy command aliases remain callable

## 10) Release + Migration
- [ ] Commit in logical chunks (runtime, branding text, docs, links)
- [ ] Push and open PR with migration notes
- [ ] Add release notes:
  - [ ] renamed PM2 process and commands
  - [ ] renamed entry file (if applicable)
  - [ ] breaking change: legacy aliases removed
  - [ ] updated URLs and package identity
- [ ] Post-merge deploy checklist for existing hosts

## 11) Rollback Plan
- [ ] Keep one tag before rebrand (`pre-rebrand-messageforge`)
- [ ] Keep old PM2 name fallback command documented
