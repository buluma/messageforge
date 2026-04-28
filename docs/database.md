# Database Configuration Guide

MessageForge supports two persistence backends:

- `local` (JSON files under `data/`)
- `postgres` (PostgreSQL + local JSON backup)

MongoDB support has been removed.

## What PostgreSQL Stores

When `DATABASE_TYPE=postgres`, MessageForge stores:

- `plugin_data`: feature/config state (sudo users, banned users, antilink groups, pinned chats, etc.)
- `messages`: dashboard chat message history

Local JSON files are still written as a fallback copy.

## Environment Variables

```env
DATABASE_TYPE=postgres
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=shadowwalker
POSTGRES_PASSWORD=
POSTGRES_DB=messageforge
```

For local-only mode:

```env
DATABASE_TYPE=local
```

## Schema Initialization

On startup, when `DATABASE_TYPE=postgres`, MessageForge initializes:

- `plugin_data` table via `lib/dbManager.js`
- `messages` table + index via `lib/messengerStore.js`

No manual migration is required for empty databases.

## Migrating Existing Local JSON Data to PostgreSQL

1. Set `DATABASE_TYPE=postgres` in `.env`.
2. Configure `POSTGRES_*` values.
3. Run:

```bash
node scripts/migrate-to-postgres.js
```

This script imports:

- `data/*.json` -> `plugin_data`
- `data/messenger-history/*.json` -> `messages`

## Quick Connectivity Checks

```bash
# Basic connectivity
psql -h localhost -p 5432 -U shadowwalker -d messageforge -c "SELECT 1"

# Server readiness
pg_isready -h localhost -p 5432
```

## Production Notes

- Use strong credentials via environment variables.
- Restrict network access to the PostgreSQL port.
- Back up with `pg_dump`.
- Monitor connections with `pg_stat_activity`.
