'use strict';
const axios = require('axios');

module.exports = {
    commands: ['paste', 'pastebin', 'hastebin'],
    description: 'Paste text online and get a shareable link',
    permission: 'public',
    group: true,
    private: true,
    run: async (sock, message, args, { sender, contextInfo }) => {
        const text = args.join(' ');
        if (!text) {
            return sock.sendMessage(
                sender,
                {
                    text: '📋 Please provide text to paste.\nExample: .paste Hello World\n_Or reply to a message with .paste_',
                    contextInfo,
                },
                { quoted: message },
            );
        }
        await sock.sendMessage(
            sender,
            { text: '⏳ Uploading paste...', contextInfo },
            { quoted: message },
        );
        try {
            const { data, status } = await axios.post('https://paste.rs', text, {
                headers: { 'Content-Type': 'text/plain' },
                timeout: 15000,
                responseType: 'text',
                validateStatus: () => true,
            });
            if (status < 200 || status >= 300) throw new Error(`paste.rs HTTP ${status}`);
            const link = String(data || '').trim();
            if (!/^https?:\/\//.test(link)) throw new Error('No link returned');
            await sock.sendMessage(
                sender,
                {
                    text: `📋 *Paste Uploaded!*\n\n🔗 ${link}\n\n_Powered by paste.rs • MessageForge_`,
                    contextInfo,
                },
                { quoted: message },
            );
        } catch (e) {
            await sock.sendMessage(
                sender,
                { text: `❌ Paste failed: ${e.message}`, contextInfo },
                { quoted: message },
            );
        }
    },
};
