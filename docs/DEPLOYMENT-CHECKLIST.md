# ✅ Deployment Checklist (Docker + Heimdal)

Use this checklist before and after deploying MessageForge to production.

## 1) Pre-Deploy

- [ ] Host is reachable and stable (`heimdal@10.0.0.212`).
- [ ] Docker Engine + Compose plugin installed (`docker --version`, `docker compose version`).
- [ ] Repo is up to date (`git pull`).
- [ ] `.env` exists and is complete:
    - [ ] `SESSION_ID`
    - [ ] `OWNER_NUMBER`
    - [ ] `BOT_NAME`
    - [ ] `DASHBOARD_TOKEN` (strong, non-empty)
    - [ ] `DATABASE_TYPE` (`local` or `postgres`)
- [ ] If using PostgreSQL:
    - [ ] Dedicated DB/user exists for MessageForge (do not reuse app-wide superuser).
    - [ ] `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` set.
    - [ ] DB connectivity verified from host.

## 2) Security Baseline

- [ ] Dashboard token is set and kept secret.
- [ ] Port `25680` exposure is intentional:
    - [ ] LAN/VPN only preferred, or
    - [ ] Reverse proxy with auth/TLS in front.
- [ ] No secrets committed in git (`.env` stays local only).

## 3) Build & Start

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f messageforge
```

- [ ] Container status is `Up` and healthy.
- [ ] No crash-loop/restart storm.

## 4) Post-Deploy Smoke Tests

- [ ] Health endpoint responds:

```bash
curl http://127.0.0.1:25680/health
```

- [ ] Bot connects to WhatsApp (no unexpected QR prompt).
- [ ] Command works in private chat.
- [ ] Command works in group chat.
- [ ] Dashboard loads and requires token remotely.
- [ ] Persistence works:
    - [ ] Local mode: data files update under `data/`
    - [ ] Postgres mode: `plugin_data` / `messages` activity observed

## 5) Persistence & Backups

- [ ] Compose mounts are present:
    - [ ] `./session -> /app/session`
    - [ ] `./data -> /app/data`
    - [ ] `./logs -> /app/logs`
- [ ] Backup plan in place:
    - [ ] `session/` backup
    - [ ] `data/` backup
    - [ ] PostgreSQL dump schedule (`pg_dump`) if using postgres

## 6) Operations

- [ ] Log rotation active (compose `json-file` max-size/max-file).
- [ ] Resource usage monitored (`docker stats`).
- [ ] Alerting for restarts/down state (watchtower, Prometheus, or external monitor).
- [ ] Time sync verified on host (NTP healthy).

## 7) Upgrade Procedure

```bash
git pull
docker compose up -d --build
docker compose logs -f messageforge
```

- [ ] Re-run smoke tests after upgrade.
- [ ] Keep previous commit hash for rollback.

## 8) Known Functional Changes

- [ ] Team/user comms updated for removed commands:
    - [ ] `.sticker` / `.s`
    - [ ] `.textsticker` / `.tsticker` / `.stext` / `.textstick`
