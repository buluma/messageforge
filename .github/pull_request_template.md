## Summary

- What changed?
- Why was this change needed?

## Scope

- [ ] Core runtime (`messageforge.js`, `handler.js`, `config.js`)
- [ ] Plugins (`plugins/*`)
- [ ] Data/storage (`lib/database.js`, `lib/messengerStore.js`, `lib/state.js`)
- [ ] Dashboard/UI (`smm/*`)
- [ ] Docs/Meta (`docs/*`, `.github/*`)

## Validation

- [ ] Local start succeeds (`npm start` or `node messageforge.js`)
- [ ] Affected commands tested manually (private + group where relevant)
- [ ] Permission gates validated (`public/admin/sudo/owner`) where relevant
- [ ] No secrets/session tokens/.env values added

## Risk & Rollback

- Risk level: Low / Medium / High
- Rollback plan:

## Checklist

- [ ] PR title follows Conventional Commits (`feat:`, `fix:`, `chore:`, etc.)
- [ ] Changelog impact considered (Release Please will draft release notes)
- [ ] Docs updated if behavior/config changed
