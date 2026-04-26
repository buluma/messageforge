'use strict';

const config = require('../config');

module.exports = {
    commands:    ['owner', 'creator'],
    description: 'Show bot owner contact information',
    permission:  'public',
    group:       true,
    private:     true,
    run: async (sock, message, args, { sender, jid, contextInfo }) => {
        const ownerNumber = (config.OWNER_NUMBER || '').replace(/\D/g, '');
        const ownerName   = config.OWNER_NAME || '✦ MessageForge ✦';

        const vcard = [
            'BEGIN:VCARD',
            'VERSION:3.0',
            `FN:${ownerName}`,
            'ORG:MessageForge Team',
            `TEL;type=CELL;type=VOICE;waid=${ownerNumber}:+${ownerNumber}`,
            'END:VCARD'
        ].join('\n');

        await sock.sendMessage(sender, {
            contacts: {
                displayName: ownerName,
                contacts: [{ vcard }]
            },
            contextInfo: {
                ...contextInfo,
                externalAdReply: {
                    title: '👑 Bot Owner',
                    body: 'Tap to view contact details',
                    sourceUrl: 'https://github.com/buluma/messageforge',
                    mediaType: 1,
                    renderLargerThumbnail: false
                }
            }
        }, { quoted: message });

    }
};
