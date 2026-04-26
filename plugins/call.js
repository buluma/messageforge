'use strict';

const os = require('os');
const { getStr } = require('../lib/theme');

module.exports = {
    commands:    ['call', 'support', 'ss'],
    description: 'Support panel',
    permission:  'public',
    group:       true,
    private:     true,
    run: async (sock, message, args, { sender, contextInfo }) => {
        const botName = getStr('botName') || 'MessageForge';
        const pic     = getStr('pic1') || '';

        const nairobiTime = new Date().toLocaleTimeString('en-KE', {
            hour: 'numeric', minute: 'numeric', hour12: true, timeZone: 'Africa/Nairobi'
        });
        const nairobiDate = new Date().toLocaleDateString('en-KE', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Africa/Nairobi'
        });

        const uptime  = process.uptime();
        const hours   = Math.floor(uptime / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);
        const seconds = Math.floor(uptime % 60);

        const sub = args[0]?.toLowerCase() || 'menu';

        if (sub === 'status') {
            return sock.sendMessage(sender, {
                text:
`🖥️ *System Status*

⏰ ${nairobiTime} — ${nairobiDate}
⏳ Uptime: ${hours}h ${minutes}m ${seconds}s
💻 Platform: ${os.platform()} ${os.arch()}
🧠 Memory: ${(os.freemem() / 1048576).toFixed(0)} MB free of ${(os.totalmem() / 1048576).toFixed(0)} MB`,
                contextInfo
            }, { quoted: message });
        }

        if (sub === 'social') {
            return sock.sendMessage(sender, {
                text:
`📱 *MessageForge Team Social Media*

• GitHub: https://github.com/buluma/messageforge
• Issues: https://github.com/buluma/messageforge/issues
• Releases: https://github.com/buluma/messageforge/releases
• Support: https://github.com/buluma/messageforge/discussions`,
                contextInfo
            }, { quoted: message });
        }

        const callCaption =
`『 *${botName}* 』

⏰ *${nairobiTime}*
📅 *${nairobiDate}*

*Support Options:*
• .call status — System status
• .call social — Social media links`;
        await sock.sendMessage(sender, { text: callCaption, contextInfo }, { quoted: message });
    }
};
