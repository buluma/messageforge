'use strict';

const VALID = ['composing', 'recording', 'paused', 'available', 'unavailable'];

module.exports = {
    commands: ['presence', 'recording', 'busy', 'offline'],
    description: 'Set bot presence status in a chat',
    permission: 'owner',
    group: true,
    private: true,

    run: async (sock, message, args, { _sender, contextInfo, prefix }) => {
        const jid = message.key.remoteJid;
        const cmd = message.key.id
            ? (message.message?.conversation || message.message?.extendedTextMessage?.text || '')
                  .split(/\s+/)[0]
                  .replace(/^[^\w]/, '')
                  .toLowerCase()
            : '';

        let presenceType;
        if (cmd === 'typing') presenceType = 'composing';
        else if (cmd === 'recording') presenceType = 'recording';
        else if (cmd === 'busy') presenceType = 'unavailable';
        else if (cmd === 'online') presenceType = 'available';
        else if (cmd === 'offline') presenceType = 'unavailable';
        else presenceType = (args[0] || '').toLowerCase();

        if (!presenceType || !VALID.includes(presenceType)) {
            return sock.sendMessage(
                jid,
                {
                    text:
                        `*Presence Command Usage:*\n\n` +
                        `• \`${prefix}typing\` — show typing...\n` +
                        `• \`${prefix}recording\` — show recording...\n` +
                        `• \`${prefix}online\` — show online\n` +
                        `• \`${prefix}offline\` — appear offline\n` +
                        `• \`${prefix}presence composing\` — typing\n` +
                        `• \`${prefix}presence recording\` — recording\n` +
                        `• \`${prefix}presence paused\` — paused\n` +
                        `• \`${prefix}presence available\` — online\n` +
                        `• \`${prefix}presence unavailable\` — offline`,
                    contextInfo,
                },
                { quoted: message },
            );
        }

        try {
            await sock.sendPresenceUpdate(presenceType, jid);

            const labels = {
                composing: '⌨️ Typing...',
                recording: '🎤 Recording...',
                paused: '⏸️ Paused',
                available: '🟢 Online',
                unavailable: '⚫ Offline',
            };

            await sock.sendMessage(
                jid,
                {
                    text: `${labels[presenceType] || presenceType} *presence set!*`,
                    contextInfo,
                },
                { quoted: message },
            );
        } catch (e) {
            await sock.sendMessage(
                jid,
                {
                    text: `❌ Failed to set presence: ${e.message}`,
                    contextInfo,
                },
                { quoted: message },
            );
        }
    },
};
