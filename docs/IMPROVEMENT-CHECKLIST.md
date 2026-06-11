# MessageForge Improvement Checklist

Actionable implementation plan derived from a project-wide review (2026-06-11).
Work is split into small, independent PRs. Check items off as they land.

**Suggested order:** Phase 1 → 2 → 3 → 4 → 5 → 6, with Phase 7 in parallel when a live WA session is available.

---

## Already in place (no work needed)

- [x] Socket-level send guard (`installSendGuard()` wraps all `sock.sendMessage` calls)
- [x] Global API rate limit (120 req/min per IP on `/api/*`)
- [x] Plugin hot-reload (chokidar watcher + `GET /api/plugins/reload`)
- [x] Partial route extraction (`createMediaRoutes`, `createFaceRoutes` in `lib/`)
- [x] Graceful shutdown (`SIGINT` / `SIGTERM`)
- [x] Ops health endpoint (`/api/ops/health`, `/health`)
- [x] Command collision detection (`reportCommandCollisions` in `handler.js`)
- [x] Dashboard messenger bug fixes (temp ID delete, `renderedMsgIds` leak, viewOnce unwrap) — `smm/js/messenger.js`

---

## Phase 1 — CI & safety net

**Goal:** Catch regressions across 160 plugins and duplicate commands before merge.  
**Est. effort:** 1–2 days · **2 PRs**

### PR 1a — Auto-discover all plugins in smoke tests

- [x] Replace static `pluginRelPaths` list in `tests/plugins.smoke.test.js` with dynamic `fs.readdirSync('plugins/')`
- [x] Support event-only plugins: pass if `(commands.length && run)` OR `(isEvent && run)`
- [x] *(Optional)* Add `tests/__fixtures__/plugin-export-allowlist.json` for known exceptions (allowlist hook in place; file not needed yet)
- [x] `npm test` passes on Node 20 and 22

**Acceptance:** Every `plugins/*.js` file is covered; failures print the offending filename.

### PR 1b — Strict collisions in CI + doc cleanup

- [x] Export `getCommandCollisions()` from `handler.js` (pure function, testable)
- [x] Add `tests/handler.collisions.test.js` — assert zero collisions in default plugin set
- [x] Run CI with `STRICT_COMMAND_COLLISIONS=true` (workflow env or dedicated job)
- [x] Fix `AGENTS.md`: document `npm test` / `npm run lint`; remove stale MongoDB mention
- [x] Align `DATABASE_TYPE` docs (`local` in `config.js` vs `json` in tests/docs)
- [x] Remove hardcoded `OWNER_NUMBER` default in `config.js`; warn at boot if unset
- [ ] **GitHub UI:** enable branch protection — require `Tests` + `lint` checks on `main`/`master`

**Acceptance:** CI fails on duplicate command aliases; contributor docs match reality.

---

## Phase 2 — Security hardening

**Goal:** Safer defaults for production dashboard deployments.  
**Est. effort:** 1 day · **1 PR**

### PR 2 — Production auth + write-path limits

- [x] Fail fast at boot when `NODE_ENV=production` and `DASHBOARD_TOKEN` is unset (or document explicit opt-out)
- [x] Remove `?token=` query-string auth from `extractAuthToken()` in `messageforge.js`
- [x] Update `smm/js/api.js` if it passes token via query string
- [x] Add stricter per-route rate limit for write endpoints (`/api/send`, `/api/send-media`, `/api/delete-message`, etc.) — e.g. 10/min per IP on top of global 120/min
- [x] Document `DASHBOARD_TOKEN` requirement in `sample.env` and `docs/DEPLOYMENT-CHECKLIST.md`

**Acceptance:**

- [x] Production Docker boot fails without `DASHBOARD_TOKEN` (or logs loud warning per chosen policy)
- [x] `?token=` no longer authenticates
- [ ] Burst of 15 `POST /api/send` from one IP returns 429 (manual verify)

---

## Phase 3 — Handler & dispatch quality

**Goal:** Better debuggability and visibility into plugin/dispatch health.  
**Est. effort:** 0.5 day · **1 PR**

### PR 3 — Plugin error visibility + collision metrics

- [x] Replace silent `catch {}` in `onMessage` loop (`handler.js` ~L575) with `logger.warn` including `plugin.__pluginFile`
- [x] Expose collision count in `/api/ops/health` (`messageforge.js`)
- [x] Add handler test: `onMessage` errors are logged, not swallowed

**Acceptance:** Plugin hook failures visible in logs; ops dashboard shows collision count (0 in clean tree).

---

## Phase 4 — Split `messageforge.js`

**Goal:** Reduce the ~2,700-line monolith; safer reviews and changes.  
**Est. effort:** 2–3 days · **3 PRs**

`messageforge.js` currently owns Baileys connection, ~38 Express routes, Socket.IO, and session logic.

### PR 4a — Extract shared HTTP middleware

- [ ] Create `lib/http/requestIp.js` — `requestIp`, `isLocalAddress`
- [ ] Create `lib/http/dashboardAuth.js` — `extractAuthToken`, `requireDashboardAuth`, `isAuthorizedByToken`
- [ ] Create `lib/http/rateLimit.js` — global + write-path limiters
- [ ] Create `lib/http/securityHeaders.js` — CSP, `nosniff`, `X-Frame-Options`
- [ ] Wire middleware from `messageforge.js`

**Acceptance:** No behavior change; `curl /health` and dashboard login still work.

### PR 4b — Extract route modules

- [ ] Create `lib/routes/index.js` — `mountAll(app, deps)`
- [ ] Create `lib/routes/chats.js` — `/api/chats`, messages, aliases, profile-pic
- [ ] Create `lib/routes/messenger.js` — send, react, typing, delete, read, pin, archive
- [ ] Create `lib/routes/ops.js` — `/api/ops/health`, `/health`, `/ping`
- [ ] Create `lib/routes/plugins.js` — `/api/plugins`, reload
- [ ] Create `lib/routes/github.js` — `/gh/*` proxy
- [ ] Create `lib/routes/quickReplies.js`
- [ ] Create `lib/routes/static.js` — smm static, `/`
- [ ] Use dependency injection: `getSock: () => global.sock` (keep `global.sock` for now)

**Acceptance:** All existing API routes work; each PR stays under ~500 lines changed where possible.

### PR 4c — Extract WhatsApp connection

- [ ] Create `lib/whatsapp/connection.js` — `connectToWhatsApp`, `scheduleReconnect`, `closeSocket`, `installSendGuard`
- [ ] Slim `messageforge.js` to ~400 lines: integrity check → config → DB → WA → HTTP

**Acceptance:** Bot connects, reconnects, and sends messages identically to before.

---

## Phase 5 — Plugin metadata

**Goal:** Better discovery and menu navigation across 160 plugins / 1200+ commands.  
**Est. effort:** 2–3 days · **2 PRs**

### PR 5a — Schema + validation (non-breaking)

- [ ] Document optional plugin fields: `category`, `tags`, `hidden`
- [ ] Validate `category` against allowed enum on load; warn on unknown
- [ ] Update `docs/04-PLUGINS.md`

**Starter categories:** `moderation`, `media`, `downloaders`, `ai`, `utility`, `games`, `group`, `owner`, `automation`, `search`

### PR 5b — Surface in menu + API

- [ ] Group `.menu` output by `category` in `plugins/menu.js`
- [ ] Fall back to filename heuristics when `category` is absent
- [ ] Extend `GET /api/plugins` to return `{ commands, description, permission, category, tags, file }`
- [ ] *(Optional)* Add category filter to dashboard plugins view (`smm/js/dashboard.js`)
- [ ] Tag top ~20 most-used plugins first (don't block on tagging all 160)

**Acceptance:** Menu is grouped; `/api/plugins` supports dashboard filtering; untagged plugins still work.

---

## Phase 6 — Observability

**Goal:** Easier production debugging ("bot went quiet", throttle events, slow plugins).  
**Est. effort:** 1–2 days · **1 PR**

### PR 6 — Metrics in ops health

- [ ] Create `lib/metrics.js` — in-memory counters: `commandsExecuted`, `commandsFailed`, `sendGuardThrottled`, `pluginOnMessageErrors`
- [ ] Increment in `handler.js` on dispatch success/failure
- [ ] Increment in `createSendPacer` when send guard waits
- [ ] Expose counters in `/api/ops/health`
- [ ] *(Optional)* Add request ID middleware for API logs

**Acceptance:** After 10 commands, `/api/ops/health` shows `commandsExecuted: 10`; throttle events increment when send guard waits.

---

## Phase 7 — Live Baileys verification (manual QA)

**Goal:** Catch protocol/client quirks that unit tests cannot.  
**Est. effort:** 2–4 hours manual · **parallel with any phase**

Requires a connected WhatsApp session. Spec: [08-BAILEYS-GAP-VERIFICATION.md](./08-BAILEYS-GAP-VERIFICATION.md)

| # | Scenario | Command / action | Pass criteria | Done |
|---|----------|------------------|---------------|------|
| 1 | Non-owner rejection | `.sudo` as non-owner | Themed permission denial | [ ] |
| 2 | Pairing code boot | `PAIRING_CODE=true` | Registers without QR | [ ] |
| 3 | Privacy update | gap plugin command | Round-trip visible on phone | [ ] |
| 4 | Message edit | Edit sent message | Edit visible in dashboard thread | [ ] |
| 5 | Profile pic remove | gap plugin command | Pic cleared on WA client | [ ] |
| 6 | Broadcast list | gap plugin command | Returns list info | [ ] |

- [ ] Log results in `docs/08-BAILEYS-GAP-VERIFICATION.md` with date + WA version

---

## PR sizing summary

| PR | Scope | Est. effort | Depends on |
|----|-------|-------------|------------|
| 1a | Full plugin smoke tests | 2–4 h | — |
| 1b | Collisions in CI + docs | 3–5 h | 1a (optional) |
| 2 | Security hardening | 4–6 h | — |
| 3 | Handler error visibility | 2–3 h | — |
| 4a | HTTP middleware extract | 3–4 h | — |
| 4b | Route modules | 1–2 d | 4a |
| 4c | WA connection extract | 1 d | 4b |
| 5a | Plugin metadata schema | 3–4 h | — |
| 5b | Menu + API grouping | 4–8 h | 5a |
| 6 | Metrics in ops health | 4–6 h | 3 |
| 7 | Live WA checklist | 2–4 h manual | deployed bot |

**Total (Phases 1–6):** ~8–12 dev days, excluding full category tagging of all 160 plugins.

---

## Recommended first sprint (week 1)

1. [x] **PR 1a** — full plugin smoke tests (highest ROI, lowest risk)
2. [x] **PR 1b** — collision CI + `AGENTS.md` fix *(branch protection still manual in GitHub UI)*
3. [x] **PR 2** — production `DASHBOARD_TOKEN` gate + write-path rate limits
4. [x] **PR 3** — `onMessage` error logging

---

## Related docs

- [todo.md](../todo.md) — open Baileys gap + branch protection items
- [DEPLOYMENT-CHECKLIST.md](./DEPLOYMENT-CHECKLIST.md) — production deploy steps
- [04-PLUGINS.md](./04-PLUGINS.md) — plugin authoring guide
- [06-API-REFERENCE.md](./06-API-REFERENCE.md) — REST API reference
