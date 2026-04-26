# 🚀 Installation & Deployment

ShadowBot is designed to be easily deployed on various platforms. Below are step-by-step instructions for the most popular hosting providers.

## 🔗 Prerequisites
Before you deploy, you **must** generate a `SESSION_ID`. This allows the bot to link to your WhatsApp account without needing to scan a QR code every time the server restarts.

[Generate Session ID Here](https://silva-session-selector.vercel.app/)

---

## 🟣 Heroku (Recommended)
*24/7 uptime · Auto-restart on crash · Industry standard*

1. **Fork the repository** to your own GitHub account.
2. Visit the [Silva MD Fork Checker](https://silva-md-fork-checker.vercel.app/) and click **Deploy to Heroku**.
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
*Fast builds · No "sleep" mode on free tier · $5 free credits/month*

1. **Fork the repository** on GitHub.
2. Log in to [Railway.app](https://railway.app).
3. Click **New Project → Deploy from GitHub repo**.
4. Select your `silva-md-bot` fork.
5. Go to the **Variables** tab and add:
   - `SESSION_ID`
   - `OWNER_NUMBER`
   - `BOT_NAME`
6. Railway will automatically build and deploy. Check the logs for `✅ Connected to WhatsApp`.

---

## 🟡 Koyeb
*Global edge network · Always-on free tier · Native Node.js support*

1. **Fork the repository**.
2. Log in to [Koyeb](https://app.koyeb.com).
3. Create a new **App** and select **GitHub** as the source.
4. Choose your fork and branch.
5. Set the **Run command** to `node silva.js`.
6. Add your Environment Variables (`SESSION_ID`, `OWNER_NUMBER`, etc.).
7. Pick a region and click **Deploy**.

---

## 🟠 Replit
*Browser-based IDE · Instant editing · "Always On" feature (paid)*

1. Fork or import this repo into your Replit account.
2. Go to **Tools → Secrets** (the lock icon).
3. Add your environment variables as secrets.
4. Click the **Run** button.
5. For 24/7 uptime, ensure you have the "Always On" power-up enabled.

---

## 💻 Local / VPS / Linux
*Full control · Lowest latency · Best for developers*

### Requirements
- Node.js 20 or higher
- Git
- FFmpeg (for media conversions)

### Setup
```bash
# Clone the repository
git clone https://github.com/SilvaTechB/silva-md-bot.git
cd silva-md-bot

# Install dependencies
npm install

# Create config file
cp sample.env .env
# Edit .env with your variables

# Start the bot
node silva.js
```

### Keep it running with PM2
```bash
npm install -g pm2
pm2 start silva.js --name silva-bot
pm2 save && pm2 startup
```
