# MessageForge TODO

Spec: [docs/07-BAILEYS-GAP-SPEC.md](/Users/shadowwalker/Documents/GitHub/messageforge/docs/07-BAILEYS-GAP-SPEC.md)  
Verification: [docs/08-BAILEYS-GAP-VERIFICATION.md](/Users/shadowwalker/Documents/GitHub/messageforge/docs/08-BAILEYS-GAP-VERIFICATION.md)

## Active
- [ ] Rework event handling around `sock.ev.process()` across the remaining handler-level listeners
  - [ ] keep this as a stability refactor, not a feature addition
  - [ ] preserve current behavior on reconnect and group participant hooks
- [ ] Execute and record full manual verification pass from `docs/08-BAILEYS-GAP-VERIFICATION.md`
  - [ ] confirm permission gates
  - [ ] confirm private vs group behavior
  - [ ] confirm owner-only actions
  - [ ] confirm reconnect does not duplicate listeners

## Release Hygiene
- [ ] Confirm no secret leakage (`.env`, session artifacts, tokens) before future pushes
