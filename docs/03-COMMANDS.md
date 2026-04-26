# 📋 Full Command Reference

MessageForge features over 1200 commands distributed across specialized plugins. Use your prefix (default `.`) followed by the command name.

## 🎵 Media & Downloads

| Command   | Aliases      | Description                                  |
| --------- | ------------ | -------------------------------------------- |
| `.play`   | `.music`     | Search and download YouTube audio.           |
| `.yt`     | `.youtube`   | Download YouTube videos by URL or search.    |
| `.tiktok` | `.tt`        | Download TikTok videos without watermark.    |
| `.ig`     | `.instagram` | Download Instagram Reels, Stories, or Posts. |
| `.fb`     | `.facebook`  | Download high-quality Facebook videos.       |
| `.apk`    |              | Download and send APK files from the store.  |
| `.lyrics` |              | Fetch lyrics for any song.                   |

---

## 🤖 AI & Search Tools

| Command    | Aliases              | Description                                  |
| ---------- | -------------------- | -------------------------------------------- |
| `.ai`      | `.gpt`, `.assistant` | Interact with our ChatGPT-powered assistant. |
| `.gemini`  |                      | Use Google's Gemini Pro model for reasoning. |
| `.tr`      | `.translate`         | Translate text to over 100 languages.        |
| `.wiki`    |                      | Search Wikipedia for detailed information.   |
| `.weather` |                      | Get real-time weather reports for any city.  |
| `.shazam`  |                      | Identify any song from a short audio clip.   |

---

## 📦 Command Categories (1200+ Commands)

The bot's functionality is organized into specialized libraries:

| Category          | File                    | Description                                                       |
| ----------------- | ----------------------- | ----------------------------------------------------------------- |
| **AI Agent**      | `messageforge-agent.js` | Advanced multi-turn conversational AI.                            |
| **Text Tools**    | `text-tools.js`         | Morse, binary, rot13, leet, reverse, upper/lower. (68 cmds)       |
| **Math Tools**    | `math-tools.js`         | Scientific calculator, fibonacci, unit conversion. (30+ cmds)     |
| **Games**         | `games.js`              | RPS, hangman, trivia, riddles, slots, scramble. (70+ cmds)        |
| **Utility**       | `utility-tools.js`      | Date, calendar, timer, timezone, notes, speedtest. (49 cmds)      |
| **Education**     | `education.js`          | Periodic table, country info, vocabulary, planet facts. (35 cmds) |
| **Entertainment** | `entertainment.js`      | Memes, horoscopes, pickup lines, dad jokes, poems. (30+ cmds)     |
| **Dev Tools**     | `dev-tools.js`          | URL encode, hash, regex tester, password gen, cron. (35 cmds)     |
| **Health**        | `health-fitness.js`     | Workouts, calories, water tracker, meditation, yoga. (28 cmds)    |
| **Crypto**        | `crypto-finance.js`     | Price lookup, loan calc, tax, bill split, salary. (26 cmds)       |

---

## 👥 Group Administration

| Command    | Aliases   | Description                                       |
| ---------- | --------- | ------------------------------------------------- |
| `.kick`    | `.remove` | Remove a user from the group.                     |
| `.promote` | `.admin`  | Grant admin privileges to a member.               |
| `.demote`  |           | Revoke admin privileges.                          |
| `.hidetag` |           | Mention all members silently (notification only). |
| `.tagall`  |           | Mention every member in the chat.                 |
| `.lock`    |           | Restrict chat messages to admins only.            |
| `.warn`    |           | Issue a warning (auto-kick at 3 warnings).        |

---

## 🎨 Stickers & Images

| Command    | Aliases  | Description                              |
| ---------- | -------- | ---------------------------------------- |
| `.sticker` | `.s`     | Convert any image or video to a sticker. |
| `.imgurl`  | `.tourl` | Upload media and receive a direct link.  |
| `.qrcode`  | `.qr`    | Generate a QR code from text or a link.  |
| `.ascii`   |          | Convert text into stylized ASCII art.    |

---

## 👑 Owner & Management

| Command      | Aliases     | Description                                   |
| ------------ | ----------- | --------------------------------------------- |
| `.settings`  | `.config`   | Open the interactive configuration panel.     |
| `.theme`     | `.settheme` | Change the bot's personality and voice.       |
| `.ban`       |             | Prevent a specific user from using the bot.   |
| `.broadcast` | `.bc`       | Send a message to all active chats.           |
| `.eval`      | `.exec`     | Execute JavaScript code directly (DANGEROUS). |
