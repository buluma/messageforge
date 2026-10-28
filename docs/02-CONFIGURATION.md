# ⚙️ Configuration Guide

MessageForge uses environment variables for configuration. You can set these in your hosting platform's dashboard or in a `.env` file (local development).

## 🔑 Essential Variables

| Variable       | Description                                            | Example                  |
| -------------- | ------------------------------------------------------ | ------------------------ |
| `SESSION_ID`   | The authentication string for your WhatsApp session.   | `MessageForge~abc123...` |
| `OWNER_NUMBER` | Your WhatsApp number (with country code, digits only). | `254712345678`           |
| `BOT_NAME`     | The name the bot uses to refer to itself.              | `MessageForge`           |

---

## 🛡️ Protection Features

| Variable             | Description                                       | Default |
| -------------------- | ------------------------------------------------- | ------- |
| `ANTIDELETE_GROUP`   | Restore deleted messages in group chats.          | `true`  |
| `ANTIDELETE_PRIVATE` | Restore deleted messages in private chats.        | `true`  |
| `ANTILINK`           | Automatically delete links and warn/kick senders. | `false` |
| `ANTICALL`           | Reject incoming WhatsApp calls automatically.     | `true`  |
| `ANTIFLOOD`          | Detect and stop message spamming.                 | `true`  |
| `ANTIVV`             | Automatically open and forward "View Once" media. | `true`  |

---

## ✨ Appearance & Style

| Variable     | Description                                                        | Default          |
| ------------ | ------------------------------------------------------------------ | ---------------- |
| `THEME`      | The visual theme for the bot (see [Themes Guide](./05-THEMES.md)). | `messageforge`   |
| `PREFIX`     | The character(s) used to trigger commands.                         | `.`              |
| `OWNER_NAME` | Your name displayed in the bot's about section.                    | `SHADOWNET Team` |
| `MODE`       | Who can use the bot: `public`, `private`, or `groups`.             | `public`         |

---

## 🤖 Automation Settings

| Variable                   | Description                                                                                          | Default |
| -------------------------- | ---------------------------------------------------------------------------------------------------- | ------- |
| `AUTO_STATUS_SEEN`         | Automatically view all statuses of your contacts.                                                    | `true`  |
| `AUTO_STATUS_REACT`        | React to statuses with random emojis.                                                                | `true`  |
| `STATUS_INBOX_JID`         | Single chat/JID where saved status updates are forwarded (`owner`, `me`, user/group JID, or digits). | `me`    |
| `AUTO_UNFOLLOW_NEWSLETTER` | Automatically unfollow newsletters/channels when detected.                                           | `false` |
| `AUTO_FOLLOW_NEWSLETTER`   | Deprecated; newsletters are never automatically followed.                                           | `false` |
| `AUTO_TYPING`              | Show "typing..." indicator while processing.                                                         | `true`  |
| `AUTO_RECORDING`           | Show "recording..." indicator for audio commands.                                                    | `false` |
| `ALWAYS_ONLINE`            | Keep the bot's status as "Online" 24/7.                                                              | `false` |
| `READ_MESSAGE`             | Automatically mark all incoming messages as read.                                                    | `false` |

---

## 🛠️ Advanced Settings

| Variable                | Description                                                  | Default        |
| ----------------------- | ------------------------------------------------------------ | -------------- |
| `DEBUG`                 | Enable verbose logging in the console for troubleshooting.   | `false`        |
| `DATABASE_TYPE`         | Storage backend: `local` or `postgres`.                      | `local`        |
| `POSTGRES_HOST`         | PostgreSQL host (used when `DATABASE_TYPE=postgres`).        | `localhost`    |
| `POSTGRES_PORT`         | PostgreSQL port.                                             | `5432`         |
| `POSTGRES_USER`         | PostgreSQL username.                                         | `shadowwalker` |
| `POSTGRES_PASSWORD`     | PostgreSQL password.                                         | _(Empty)_      |
| `POSTGRES_DB`           | PostgreSQL database name.                                    | `messageforge` |
| `DASHBOARD_TOKEN`       | Token required for remote admin dashboard/API/socket access. | _(Unset)_      |
| `MESSENGER_HISTORY_MAX` | Number of messages retained per chat for dashboard history.  | `3000`         |
| `LOG_MAX_FILE_BYTES`    | Rotate app log file after this many bytes.                   | `5242880`      |
| `LOG_MAX_AGE_DAYS`      | Delete app log files older than this many days.              | `2`            |
| `LOG_MAX_TOTAL_BYTES`   | Prune oldest app logs when total log size exceeds this cap.  | `209715200`    |
| `LOG_FORMAT`            | Console log style: `text` (default) or `json`.               | `text`         |
| `DB_POOL_MAX`           | Maximum concurrent PostgreSQL connections in the pool.       | `20`           |
| `MEDIA_MAX_MB`          | Maximum size of media files to download (in MB).             | `100`          |
| `PORT`                  | The port for the internal health check server.               | `25680`        |
| `APP_URL`               | Your deployment URL (used for Heroku keep-alive).            | _(None)_       |
