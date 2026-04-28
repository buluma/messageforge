# 🚀 Installation & Deployment

MessageForge is designed to be easily deployed on various platforms. Below are step-by-step instructions for the most popular hosting providers.

## 🔗 Prerequisites

Before you deploy, you **must** generate a `SESSION_ID`. This allows the bot to link to your WhatsApp account without needing to scan a QR code every time the server restarts.

[Generate Session ID Here](https://messageforge-session-selector.vercel.app/)

---

## 🟣 Heroku (Recommended)

_24/7 uptime · Auto-restart on crash · Industry standard_

1. **Fork the repository** to your own GitHub account.
2. Visit the [MessageForge Fork Checker](https://messageforge-md-fork-checker.vercel.app/) and click **Deploy to Heroku**.
3. Log in to your Heroku account.
4. Fill in the required Environment Variables:
    - `SESSION_ID`: Your generated ID.
    - `OWNER_NUMBER`: Your number (e.g., `254712345678`).
    - `BOT_NAME`: Your preferred name for the bot.
5. Click **Deploy App**.
6. Once finished, go to **Resources** and ensure the `worker` dyno is turned ON.
7. Check **More → View Logs** to confirm the connection.

---

## 🚂 Railway

_Fast builds · No "sleep" mode on free tier · $5 free credits/month_

1. **Fork the repository** on GitHub.
2. Log in to [Railway.app](https://railway.app).
3. Click **New Project → Deploy from GitHub repo**.
4. Select your `messageforge` fork.
5. Go to the **Variables** tab and add:
    - `SESSION_ID`
    - `OWNER_NUMBER`
    - `BOT_NAME`
6. Railway will automatically build and deploy. Check the logs for `✅ Connected to WhatsApp`.

---

## 🟡 Koyeb

_Global edge network · Always-on free tier · Native Node.js support_

1. **Fork the repository**.
2. Log in to [Koyeb](https://app.koyeb.com).
3. Create a new **App** and select **GitHub** as the source.
4. Choose your fork and branch.
5. Set the **Run command** to `node messageforge.js`.
6. Add your Environment Variables (`SESSION_ID`, `OWNER_NUMBER`, etc.).
7. Pick a region and click **Deploy**.

---

## 🟠 Replit

_Browser-based IDE · Instant editing · "Always On" feature (paid)_

1. Fork or import this repo into your Replit account.
2. Go to **Tools → Secrets** (the lock icon).
3. Add your environment variables as secrets.
4. Click the **Run** button.
5. For 24/7 uptime, ensure you have the "Always On" power-up enabled.

---

## 💻 Local / VPS / Linux

_Full control · Lowest latency · Best for developers_

### Requirements

- Node.js 20 or higher
- Git
- FFmpeg (for media conversions)

### Setup

```bash
# Clone the repository
git clone https://github.com/MessageForgeB/messageforge.git
cd messageforge

# Install dependencies
npm install

# Create config file
cp sample.env .env
# Edit .env with your variables

# Start the bot
node messageforge.js
```

### Keep it running with PM2

```bash
npm install -g pm2
pm2 start messageforge.js --name messageforge-bot
pm2 save && pm2 startup
```

---

## 🐳 Docker Compose (Recommended for Self-Hosting)

_Reproducible deploys · Persistent bot session/data · Easy restarts_

MessageForge includes:

- `Dockerfile`
- `docker-compose.yml` (production-oriented defaults)

### Requirements

- Docker Engine
- Docker Compose plugin (`docker compose`)

### Setup

```bash
# Clone the repository
git clone https://github.com/MessageForgeB/messageforge.git
cd messageforge

# Create config file
cp sample.env .env
# Edit .env with required values:
# SESSION_ID, OWNER_NUMBER, BOT_NAME, DASHBOARD_TOKEN

# Build and run
docker compose up -d --build
```

### Verify

```bash
# Container status
docker compose ps

# Live logs
docker compose logs -f messageforge

# Health endpoint
curl http://127.0.0.1:25680/health
```

### Update

```bash
git pull
docker compose up -d --build
```

### Persistence

The compose file mounts:

- `./session` -> `/app/session`
- `./data` -> `/app/data`
- `./logs` -> `/app/logs`

This keeps auth/session state and data across container restarts.

### PostgreSQL Mode (Optional)

If using PostgreSQL, set in `.env`:

```env
DATABASE_TYPE=postgres
POSTGRES_HOST=<your-postgres-host>
POSTGRES_PORT=5432
POSTGRES_USER=<username>
POSTGRES_PASSWORD=<password>
POSTGRES_DB=messageforge
```

Before going live, run the [Deployment Checklist](./DEPLOYMENT-CHECKLIST.md).
