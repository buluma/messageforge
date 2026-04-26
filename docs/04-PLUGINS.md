# 🔌 Plugin Architecture

ShadowBot is built on a highly modular plugin system, making it easy to add or modify functionality without touching the core logic.

## 📂 Location
All command plugins are located in the `/plugins` directory. Every `.js` file in this folder is automatically loaded at startup.

## 🛠️ Plugin Structure
A standard plugin file exports an object with the following properties:

```javascript
module.exports = {
    commands: ['cmd', 'alias'],  // Trigger words (without prefix)
    description: 'What it does', // Shown in the menu
    usage: '.cmd <args>',        // Optional: specific usage guide
    permission: 'public',        // 'public', 'admin', 'owner', or 'sudo'
    group: true,                 // Set false to block in groups
    private: true,               // Set false to block in private DMs
    botAdmin: false,             // Set true if bot needs group admin rights
    run: async (sock, message, args, ctx) => {
        // Your logic here
        await ctx.reply('Hello World!');
    }
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

---

## 🚀 Creating Your First Plugin
1. Create a new file in `plugins/hello.js`.
2. Add the following code:
```javascript
module.exports = {
    commands: ['hello'],
    description: 'Says hi!',
    run: async (sock, message, args, ctx) => {
        await ctx.reply('Hi there! I am ShadowBot.');
    }
};
```
3. Restart the bot, and your new command will be available!
