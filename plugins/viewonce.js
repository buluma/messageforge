'use strict';

const config = require('../config');
const {
    downloadMediaBuffer,
    findViewOnceMedia,
    sendRevealedMedia,
} = require('../lib/viewonce');

// In-memory toggle — seeded from config, changeable at runtime
if (typeof global.antivvEnabled === 'undefined') {
    global.antivvEnabled = config.ANTIVV !== false;
}

module.exports = {
    commands: ['vv', 'viewonce', 'openphoto', 'openvideo', 'vvphoto'],
    description: 'Manually reveal a view-once message (reply to it)',
    permission:  'owner',
    group:       true,
    private:     true,

    run: async (sock, message, args, { sender, contextInfo }) => {
        const quoted = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        if (!quoted) {
            return sock.sendMessage(sender, {
                text: '❌ *Reply to a view-once photo / video / audio with this command.*',
                contextInfo
            }, { quoted: message });
        }

        const reveal = findViewOnceMedia(quoted, { allowPlainMedia: true });
        if (!reveal) {
            return sock.sendMessage(sender, {
                text: '❌ Quoted message has no image, video, or audio.',
                contextInfo
            }, { quoted: message });
        }

        try {
            const buffer = await downloadMediaBuffer(reveal.content, reveal.mediaType, {
                maxBytes: config.ANTIVV_MAX_BYTES,
            });
            await sendRevealedMedia(sock, sender, {
                ...reveal,
                buffer,
                caption: reveal.content?.caption || '',
            }, { quoted: message });
            await sock.sendMessage(sender, { react: { text: '😍', key: message.key } }).catch(() => {});
        } catch (err) {
            await sock.sendMessage(sender, { react: { text: '😔', key: message.key } }).catch(() => {});
            await sock.sendMessage(sender, {
                text: `❌ Failed to open media: ${err.message}`,
                contextInfo
            }, { quoted: message });
        }
    }
};
