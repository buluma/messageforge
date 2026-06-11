const path = require('path');
const fs = require('fs');
const messengerStore = require('../messengerStore');
const { logMessage } = require('../logger') || { logMessage: console.log };
const { isValidJid } = require('../utils') || { isValidJid: (j) => !!j };
const { createMediaRoutes } = require('../mediaRoutes');
const { VALID_PRESENCE_STATES } = require('@whiskeysockets/baileys') || {
    VALID_PRESENCE_STATES: new Set([
        'unavailable',
        'available',
        'composing',
        'recording',
        'paused',
    ]),
};

module.exports = function messengerRoutes(app, deps = {}) {
    const { store, requireDashboardAuth, facesBuildIndex } = deps;
    app.get('/api/media/:jid/:msgId', async (req, res) => {
        const { jid, msgId } = req.params;
        try {
            if (!store) return res.status(503).json({ error: 'Store not ready' });
            const liveMsg = await store.loadMessage(jid, msgId);
            const chatMsgs = store.chats.get(jid);
            const liveMessages = chatMsgs ? Array.from(chatMsgs.values()) : [];
            const persisted = await messengerStore.getMessageById(jid, msgId, liveMessages);
            let msg = liveMsg?.message ? liveMsg : persisted;
            if (!msg?.message) return res.status(404).json({ error: 'Message not found' });

            const { dlAuto } = require('./lib/dlmedia');

            let dlResult;
            try {
                dlResult = await dlAuto(msg.message);
            } catch (e) {
                if (
                    e.message?.includes('status code 403') ||
                    e.message?.includes('410') ||
                    e.response?.status === 403
                ) {
                    if (global.sock && typeof global.sock.updateMediaMessage === 'function') {
                        // Refresh expired media URL
                        msg = await global.sock.updateMediaMessage(msg);
                        dlResult = await dlAuto(msg.message);
                        // Persist updated message to avoid future 403s
                        messengerStore.persistMessages([msg]).catch(() => {});
                    } else {
                        throw e;
                    }
                } else {
                    throw e;
                }
            }

            const { buffer, msgContent } = dlResult;
            res.set('Content-Type', msgContent.mimetype || 'application/octet-stream');
            res.send(buffer);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/test-hang', (req, res) => res.json({ ok: 1 }));
    app.post('/api/send', async (req, res) => {
        const { jid, text, quoted } = req.body;
        if (!jid || !text) return res.status(400).json({ error: 'Missing jid or text' });
        if (!isValidJid(jid)) return res.status(400).json({ error: 'Invalid jid' });
        try {
            if (!global.sock) return res.status(503).json({ error: 'Socket not ready' });
            const { safeSend } = require('../../handler');
            console.log(`[API SEND] Calling safeSend for ${jid}...`);
            const result = await Promise.race([
                safeSend(global.sock, jid, { text }, quoted ? { quoted } : {}),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Send timeout')), 30_000)),
            ]);
            console.log(`[API SEND] safeSend finished for ${jid}`);
            if (result)
                messengerStore
                    .persistMessages([result])
                    .catch((e) =>
                        logMessage('WARN', `[persist] send persist failed: ${e.message}`),
                    );
            res.json({ success: !!result, messageId: result?.key?.id });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/send-media', async (req, res) => {
        const { jid, media, mimetype, caption, filename } = req.body;
        if (!jid || !media) return res.status(400).json({ error: 'Missing jid or media' });
        if (!isValidJid(jid)) return res.status(400).json({ error: 'Invalid jid' });
        try {
            if (!global.sock) return res.status(503).json({ error: 'Socket not ready' });
            const buffer = Buffer.from(media, 'base64');
            const type = (mimetype || '').split('/')[0];
            let content;
            if (type === 'image') {
                content = { image: buffer, caption: caption || undefined, mimetype };
            } else if (type === 'video') {
                content = { video: buffer, caption: caption || undefined, mimetype };
            } else if (type === 'audio') {
                content = { audio: buffer, mimetype, ptt: false };
            } else {
                content = {
                    document: buffer,
                    mimetype,
                    fileName: filename || 'file',
                    caption: caption || undefined,
                };
            }
            const { safeSend } = require('../../handler');
            const result = await safeSend(global.sock, jid, content);
            if (result)
                messengerStore
                    .persistMessages([result])
                    .catch((e) =>
                        logMessage('WARN', `[persist] send-media persist failed: ${e.message}`),
                    );
            res.json({ success: !!result, messageId: result?.key?.id });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/toggle-pin', async (req, res) => {
        const { jid } = req.body;
        if (!jid) return res.status(400).json({ error: 'Missing jid' });
        if (!isValidJid(jid)) return res.status(400).json({ error: 'Invalid jid' });
        try {
            const db = require('./lib/dbManager');
            let pinned = await db.get('messenger_pinned', []);
            if (pinned.includes(jid)) {
                pinned = pinned.filter((j) => j !== jid);
            } else {
                pinned.push(jid);
            }
            await db.set('messenger_pinned', pinned);
            res.json({ success: true, pinned });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/toggle-archive', async (req, res) => {
        const { jid, archive } = req.body;
        if (!jid) return res.status(400).json({ error: 'Missing jid' });
        if (!isValidJid(jid)) return res.status(400).json({ error: 'Invalid jid' });
        try {
            const isArchiving = !!archive;
            if (global.sock) {
                await global.sock
                    .chatModify({ archive: isArchiving, lastMessages: [] }, jid)
                    .catch(() => {});
            }
            const db = require('./lib/dbManager');
            let archived = await db.get('messenger_archived', []);
            if (isArchiving && !archived.includes(jid)) {
                archived.push(jid);
            } else if (!isArchiving && archived.includes(jid)) {
                archived = archived.filter((j) => j !== jid);
            }
            await db.set('messenger_archived', archived);
            res.json({ success: true, archived });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.get('/api/control/autopilot/:jid', (req, res) => {
        const { jid } = req.params;
        if (!jid) return res.status(400).json({ error: 'Missing jid' });
        if (!isValidJid(jid)) return res.status(400).json({ error: 'Invalid jid' });
        try {
            const autopilot = require('./plugins/ai-autopilot');
            res.json(autopilot.dashboardStatus(jid));
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/control/autopilot', (req, res) => {
        const { jid, action, args } = req.body || {};
        if (!jid) return res.status(400).json({ error: 'Missing jid' });
        if (!isValidJid(jid)) return res.status(400).json({ error: 'Invalid jid' });
        try {
            const autopilot = require('./plugins/ai-autopilot');
            const result = autopilot.dashboardControl(jid, action, Array.isArray(args) ? args : []);
            res.status(result.ok === false ? 400 : 200).json(result);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/react', async (req, res) => {
        const { jid, msgId, fromMe, participant, emoji } = req.body;
        if (!jid || !msgId || !emoji) return res.status(400).json({ error: 'Missing params' });
        if (!isValidJid(jid)) return res.status(400).json({ error: 'Invalid jid' });
        try {
            if (!global.sock) return res.status(503).json({ error: 'Socket not ready' });
            const key = { remoteJid: jid, id: msgId, fromMe: !!fromMe };
            if (participant) key.participant = participant;
            await global.sock.sendMessage(jid, { react: { text: emoji, key } });
            res.json({ success: true });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/delete-message', async (req, res) => {
        const { jid, msgId, fromMe, participant } = req.body;
        if (!jid || !msgId) return res.status(400).json({ error: 'Missing params' });
        if (!isValidJid(jid)) return res.status(400).json({ error: 'Invalid jid' });
        try {
            if (!global.sock) return res.status(503).json({ error: 'Socket not ready' });
            const key = { remoteJid: jid, id: msgId, fromMe: !!fromMe };
            if (participant) key.participant = participant;
            await global.sock.sendMessage(jid, { delete: key });
            res.json({ success: true });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/typing', async (req, res) => {
        const { jid, state } = req.body;
        if (!jid) return res.status(400).json({ error: 'Missing jid' });
        if (!isValidJid(jid)) return res.status(400).json({ error: 'Invalid jid' });
        const presenceState = VALID_PRESENCE_STATES.has(state) ? state : 'composing';
        try {
            if (!global.sock) return res.status(503).json({ error: 'Socket not ready' });
            await global.sock.sendPresenceUpdate(presenceState, jid);
            res.json({ success: true });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/subscribe-presence', async (req, res) => {
        const { jid } = req.body;
        if (!jid) return res.status(400).json({ error: 'Missing jid' });
        if (!isValidJid(jid)) return res.status(400).json({ error: 'Invalid jid' });
        try {
            if (!global.sock) return res.status(503).json({ error: 'Socket not ready' });
            await global.sock.presenceSubscribe(jid);
            res.json({ success: true });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    const MEDIA_DATA_DIR = path.join(__dirname, '..', 'data');

    app.use(
        '/api/media',
        createMediaRoutes({
            mediaDataDir: MEDIA_DATA_DIR,
            requireDashboardAuth,
            facesBuildIndex,
        }),
    );

    app.get('/api/me', (req, res) => {
        if (!global.sock) return res.status(503).json({ error: 'Socket not ready' });
        res.json({
            jid: global.botJid || null,
            lid: global.botLid || null,
            num: global.botNum || null,
        });
    });

    app.post('/api/read', async (req, res) => {
        const { jid, msgId, fromMe, participant } = req.body;
        if (!jid || !msgId) return res.status(400).json({ error: 'Missing params' });
        try {
            if (!global.sock) return res.status(503).json({ error: 'Socket not ready' });
            const key = { remoteJid: jid, id: msgId, fromMe: !!fromMe };
            if (participant) key.participant = participant;
            await global.sock.readMessages([key]);
            res.json({ success: true });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // ── Full-text message search ──────────────────────────────────────────────────

    app.get('/api/search', async (req, res) => {
        const q = String(req.query.q || '').trim();
        const limitRaw = Number(req.query.limit || 20);
        const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 20;

        if (!q || q.length < 2) {
            return res.json({ results: [] });
        }

        try {
            const DATA_DIR = path.join(__dirname, 'data', 'messenger-history');
            const INDEX_FILE = path.join(DATA_DIR, 'index.json');

            if (!fs.existsSync(INDEX_FILE)) return res.json({ results: [] });

            let jids;
            try {
                jids = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
            } catch {
                return res.json({ results: [] });
            }

            if (!Array.isArray(jids) || jids.length === 0) return res.json({ results: [] });

            const qLower = q.toLowerCase();
            const results = [];

            for (const jid of jids) {
                if (results.length >= limit) break;

                const fileName = Buffer.from(String(jid), 'utf8').toString('base64url') + '.json';
                const filePath = path.join(DATA_DIR, fileName);
                if (!fs.existsSync(filePath)) continue;

                let messages;
                try {
                    messages = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                } catch {
                    continue;
                }

                if (!Array.isArray(messages)) continue;

                // Collect all matching messages from this jid, newest first
                const matches = [];
                for (const m of messages) {
                    const text =
                        m?.message?.conversation ||
                        m?.message?.extendedTextMessage?.text ||
                        m?.message?.imageMessage?.caption ||
                        m?.message?.videoMessage?.caption ||
                        '';
                    if (!text) continue;
                    if (text.toLowerCase().includes(qLower)) {
                        matches.push({
                            jid,
                            pushName: m.pushName || '',
                            message: {
                                id: m?.key?.id || '',
                                text,
                                fromMe: !!m?.key?.fromMe,
                                timestamp: m.messageTimestamp || 0,
                            },
                        });
                    }
                }

                // Sort newest-first and take up to remaining limit slots
                matches.sort((a, b) => b.message.timestamp - a.message.timestamp);
                for (const match of matches) {
                    if (results.length >= limit) break;
                    results.push(match);
                }
            }

            // Final sort across all jids: newest-first
            results.sort((a, b) => b.message.timestamp - a.message.timestamp);

            res.json({ results: results.slice(0, limit) });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
};
