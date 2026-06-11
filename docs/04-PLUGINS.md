# 🔌 Plugin Architecture

MessageForge is built on a highly modular plugin system, making it easy to add or modify functionality without touching the core logic.

## 📂 Location

All command plugins are located in the `/plugins` directory. Every `.js` file in this folder is automatically loaded at startup.

## 🛠️ Plugin Structure

A standard plugin file exports an object with the following properties:

```javascript
module.exports = {
    commands: ['cmd', 'alias'], // Trigger words (without prefix)
    description: 'What it does', // Shown in the menu
    usage: '.cmd <args>', // Optional: specific usage guide
    permission: 'public', // 'public', 'admin', 'owner', or 'sudo'
    group: true, // Set false to block in groups
    private: true, // Set false to block in private DMs
    botAdmin: false, // Set true if bot needs group admin rights
    category: 'utility', // Optional: one of moderation|media|downloaders|ai|utility|games|group|owner|automation|search
    tags: ['productivity', 'tools'], // Optional: array of freeform string tags
    hidden: false, // Optional: set true to exclude from .menu output (commands still work)
    run: async (sock, message, args, ctx) => {
        // Your logic here
        await ctx.reply('Hello World!');
    },
};
```

## 🧠 The Context Object (`ctx`)

The `run` function receives a `ctx` object that provides easy access to common tools:

- `sock`: The raw Baileys socket.
- `jid`: The current chat identifier.
- `sender`: The JID of the user who sent the command.
- `isGroup`: Boolean indicating if the chat is a group.
- `isAdmin`: Boolean indicating if the sender is a group admin.
- `isOwner`: Boolean indicating if the sender is the bot owner.
- `args`: An array of words from the user's message after the command.
- `text`: The full text of the user's message.
- `reply(text)`: A helper function to reply to the user's message.
- `theme`: An object containing the current theme's strings.
- `getStr(key)`: Fetches a localized/themed string by its key.

### `category` (optional)

Group your plugin under a section in the `.menu` output and in the dashboard plugins view.  
Must be one of the following enum values:

| Category | Icon | Description |
|----------|------|-------------|
| `moderation` | 🛡️ | Anti-spam, anti-link, ban/kick/warn |
| `media` | 🎵 | Music, audio conversion, lyrics |
| `downloaders` | ⬇️ | Download from YouTube, TikTok, Instagram, etc. |
| `ai` | 🤖 | AI chat, image generation, translation, TTS |
| `utility` | 🔧 | General-purpose tools (calc, date, encode, etc.) |
| `games` | 🎮 | Trivia, word games, challenges |
| `group` | 👥 | Group management (tagall, poll, lock, welcome) |
| `owner` | 👑 | Bot owner-only commands (sudo, restart, setprefix) |
| `automation` | ⚙️ | Auto-reply, auto-status, schedulers |
| `search` | 🔍 | Wikipedia, weather, news, IP lookup, stalking |

If no `category` is set, the menu will attempt to infer one from the filename.  
Unknown category values produce a warning at boot but do not prevent loading.

### `tags` (optional)

An array of freeform string tags used for filtering in the dashboard and future API features.  
Example:

```javascript
tags: ['productivity', 'tools', 'text'],
```

### `hidden` (optional)

Set to `true` to hide the plugin's commands from the `.menu` help output.  
Commands still work when typed — this is useful for internal/admin-only utilities that would clutter the menu.

---

## 🚀 Creating Your First Plugin

1. Create a new file in `plugins/hello.js`.
2. Add the following code:

```javascript
module.exports = {
    commands: ['hello'],
    description: 'Says hi!',
    run: async (sock, message, args, ctx) => {
        await ctx.reply('Hi there! I am MessageForge.');
    },
};
```

3. Restart the bot, and your new command will be available!
