# MessageForge

<div align="center">

<img src="https://i.imgur.com/dBaSKWF.gif" height="20" width="100%">

**A feature-rich WhatsApp bot powered by Node.js + Baileys, with 1200+ commands, AI tools, media utilities, and modular plugins.**

<img src="https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white" alt="Node 20+">
<img src="https://img.shields.io/badge/License-MIT-blue" alt="MIT License">
<img src="https://img.shields.io/badge/Commands-1200%2B-brightgreen" alt="1200+ commands">
<img src="https://img.shields.io/badge/Architecture-Plugin%20Based-orange" alt="Plugin based architecture">

<img src="https://i.imgur.com/dBaSKWF.gif" height="20" width="100%">

</div>

## Highlights

- 1200+ commands ready to run: moderation, media, AI, automation, and utility workflows.
- Plugin-first architecture (`plugins/*.js`) so new features ship as isolated modules.
- Storage without lock-in: local JSON or PostgreSQL.
- Built-in dashboard + REST endpoints for fast ops and debugging.
- Theming layer for rapid voice/style swaps.

## Boot

```bash
npm install
cp sample.env .env
# set SESSION_ID / OWNER_NUMBER / core env vars
npm start
```

If it boots, you’re live.

## Boot (Docker)

```bash
cp sample.env .env
# set SESSION_ID / OWNER_NUMBER / core env vars
docker compose up -d --build
docker compose logs -f messageforge
```

Health check:

```bash
curl http://127.0.0.1:25680/health
```

## Deploy (Production)

Docker is the canonical production deploy:

```bash
cp sample.env .env
# Set SESSION_ID, OWNER_NUMBER, DASHBOARD_TOKEN, and any optional overrides
docker compose up -d --build
docker compose logs -f messageforge
```

Health check:

```bash
curl http://127.0.0.1:25680/health
```

PM2 (bare-metal alternative):

```bash
npm install
cp sample.env .env
pm2 start ecosystem.config.js
pm2 logs messageforge --lines 50
```

## Hack

```bash
# run tests
npm test

# lint (0 errors required)
npm run lint
npm run lint:fix

# format check
npx prettier --check .
npx prettier --write .
```

- Runtime flow: `messageforge.js` -> `handler.js` -> `plugins/*`
- Add/patch commands in `plugins/` (one feature area per file)
- Shared internals in `lib/` (`dbManager`, state, media, themes, helpers)
- Treat `sample.env` as the config contract

## Dev Loop

```bash
# terminal 1
npm start

# terminal 2 (while editing)
npx prettier --write plugins/your-plugin.js
```

Edit small, run fast, test both private and group chats.

## Ship

- Installation: [docs/01-INSTALLATION.md](./docs/01-INSTALLATION.md)
- Configuration: [docs/02-CONFIGURATION.md](./docs/02-CONFIGURATION.md)
- Commands: [docs/03-COMMANDS.md](./docs/03-COMMANDS.md)
- Plugins: [docs/04-PLUGINS.md](./docs/04-PLUGINS.md)
- Themes: [docs/05-THEMES.md](./docs/05-THEMES.md)
- API: [docs/06-API-REFERENCE.md](./docs/06-API-REFERENCE.md)
- Database: [docs/database.md](./docs/database.md)
- Deployment Checklist: [docs/DEPLOYMENT-CHECKLIST.md](./docs/DEPLOYMENT-CHECKLIST.md)
- Contributing: [CONTRIBUTING.md](./CONTRIBUTING.md)

## License

MIT. See [LICENSE](./LICENSE).

<div align="center">

Built by [ShadowNet Inc](https://github.com/buluma)

</div>
