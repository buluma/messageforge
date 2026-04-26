# ⚙️ Configuration Guide

ShadowBot uses environment variables for configuration. You can set these in your hosting platform's dashboard or in a `.env` file (local development).

## 🔑 Essential Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `SESSION_ID` | The authentication string for your WhatsApp session. | `Silva~abc123...` |
| `OWNER_NUMBER` | Your WhatsApp number (with country code, digits only). | `254712345678` |
| `BOT_NAME` | The name the bot uses to refer to itself. | `ShadowBot` |

---

## 🛡️ Protection Features

| Variable | Description | Default |
|----------|-------------|---------|
| `ANTIDELETE_GROUP` | Restore deleted messages in group chats. | `true` |
| `ANTIDELETE_PRIVATE`| Restore deleted messages in private chats. | `true` |
| `ANTILINK` | Automatically delete links and warn/kick senders. | `false` |
| `ANTICALL` | Reject incoming WhatsApp calls automatically. | `true` |
| `ANTIFLOOD` | Detect and stop message spamming. | `true` |
| `ANTIVV` | Automatically open and forward "View Once" media. | `true` |

---

## ✨ Appearance & Style

| Variable | Description | Default |
|----------|-------------|---------|
| `THEME` | The visual theme for the bot (see [Themes Guide](./05-THEMES.md)). | `silva` |
| `PREFIX` | The character(s) used to trigger commands. | `.` |
| `OWNER_NAME` | Your name displayed in the bot's about section. | `Silva` |
| `MODE` | Who can use the bot: `public`, `private`, or `groups`. | `public` |

---

## 🤖 Automation Settings

| Variable | Description | Default |
|----------|-------------|---------|
| `AUTO_STATUS_SEEN` | Automatically view all statuses of your contacts. | `true` |
| `AUTO_STATUS_REACT`| React to statuses with random emojis. | `true` |
| `AUTO_TYPING` | Show "typing..." indicator while processing. | `true` |
| `AUTO_RECORDING` | Show "recording..." indicator for audio commands. | `false` |
| `ALWAYS_ONLINE` | Keep the bot's status as "Online" 24/7. | `false` |
| `READ_MESSAGE` | Automatically mark all incoming messages as read. | `false` |

---

## 🛠️ Advanced Settings

| Variable | Description | Default |
|----------|-------------|---------|
| `DEBUG` | Enable verbose logging in the console for troubleshooting. | `false` |
| `MONGODB_URL` | Connection string for MongoDB database (optional). | *(Local storage)* |
| `PORT` | The port for the internal health check server. | `25680` |
| `APP_URL` | Your deployment URL (used for Heroku keep-alive). | *(None)* |
