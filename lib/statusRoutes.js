'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../config');

function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function resolveStatusInboxJid(sock) {
    const selfJid = sock.user?.id?.includes(':')
        ? `${sock.user.id.split(':')[0]}@s.whatsapp.net`
        : sock.user?.id;

    const rawTarget = String(config.STATUS_INBOX_JID || '').trim();
    let targetJid = selfJid;
    if (rawTarget && rawTarget.toLowerCase() !== 'me') {
        if (rawTarget.toLowerCase() === 'owner' && config.OWNER_NUMBER) {
            targetJid = String(config.OWNER_NUMBER).includes('@')
                ? String(config.OWNER_NUMBER)
                : `${String(config.OWNER_NUMBER).replace(/\D/g, '')}@s.whatsapp.net`;
        } else {
            targetJid = rawTarget.includes('@') ? rawTarget : `${rawTarget.replace(/\D/g, '')}@s.whatsapp.net`;
        }
    }

    return targetJid || selfJid;
}

function createStatusSaver({ rootDir, downloadContentFromMessage, logMessage } = {}) {
    if (!rootDir) throw new Error('createStatusSaver: rootDir required');
    if (typeof downloadContentFromMessage !== 'function')
        throw new Error('createStatusSaver: downloadContentFromMessage required');
    if (typeof logMessage !== 'function') throw new Error('createStatusSaver: logMessage required');

    const statusSaverDir = path.join(rootDir, 'status_saver');
    ensureDir(statusSaverDir);

    async function saveMedia(message, msgType, sockLocal, caption) {
        try {
            const stream = await downloadContentFromMessage(
                message.message[msgType],
                msgType.replace('Message', ''),
            );

            let buffer = Buffer.from([]);
            for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

            const extMap = {
                imageMessage: 'jpg',
                videoMessage: 'mp4',
                audioMessage: 'ogg',
            };

            const filename = `${Date.now()}.${extMap[msgType]}`;
            const filePath = path.join(statusSaverDir, filename);
            fs.writeFileSync(filePath, buffer);

            const targetJid = resolveStatusInboxJid(sockLocal);
            await sockLocal.sendMessage(targetJid, {
                [msgType.replace('Message', '')]: { url: filePath },
                caption: caption,
                mimetype: message.message[msgType].mimetype,
            });
            return true;
        } catch (error) {
            logMessage('ERROR', `Media Save Error: ${error.message}`);
            return false;
        }
    }

    return { saveMedia, statusSaverDir };
}

module.exports = {
    createStatusSaver,
};

