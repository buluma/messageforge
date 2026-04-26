# Repository Guidelines

## Project Structure & Module Organization
Core runtime lives at the repo root: `messageforge.js` (startup/connection), `handler.js` (message routing + plugin dispatch), and `config.js` (env-backed settings). Shared services are in `lib/` (state, DB, themes, media helpers). Command features are isolated in `plugins/*.js`; keep one feature area per plugin file (for example `group-analytics.js`, `text-tools.js`). Theme strings live in `themes/*.json`. Long-form docs are in `docs/`. Runtime/generated data (`session/`, `data/`, `logs/`) should not hold source logic.

## Build, Test, and Development Commands
- `npm install`: install dependencies (Node 20+ required).
- `cp sample.env .env`: create local config file, then fill required values.
- `npm start`: start the bot (`node messageforge.js`).
- `node messageforge.js`: direct start, useful during debugging.
- `npx prettier --check .`: verify formatting.
- `npx prettier --write .`: apply formatting fixes.
- `docker build -t messageforge .` then `docker run --env-file .env -p 25680:25680 messageforge`: containerized run.

## Coding Style & Naming Conventions
Use CommonJS modules (`require`, `module.exports`). Formatting is defined in `.prettierrc`: 4 spaces, single quotes, semicolons, trailing commas, width 100. ESLint rules in `.eslintrc.json` enforce single quotes and semicolons; keep unused args prefixed with `_`. Prefer lowercase plugin filenames; use hyphenated names for multi-word files (example: `language-tools.js`).

For plugin exports, follow the existing shape (`commands`, `description`, `permission`, `run`, etc.) and keep command names short and predictable.

## Testing Guidelines
No dedicated `npm test` suite is currently defined. For changes, run targeted manual checks:
- Start locally and verify affected commands in private and group chats.
- Validate permission gates (`public/admin/sudo/owner`) and error paths.
- For persistence changes, confirm both local `data/` behavior and MongoDB fallback when configured.

## Commit & Pull Request Guidelines
Recent history uses both conventional commits (`feat:`, `refactor:`, `chore:`) and short maintenance messages. Prefer: `<type>: <brief imperative summary>` (example: `feat: add anti-flood cooldown guard`). Keep commits focused by concern.

PRs should include: clear scope, changed files/plugins, test evidence (logs/screenshots), config impacts, and linked issue(s). Do not include secrets, session tokens, or `.env` values.
