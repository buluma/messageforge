const fs = require('fs');
const path = require('path');
const axios = require('axios');
const crypto = require('crypto');
const config = require('../../config');
const messengerStore = require('../messengerStore');
const { isJidGroup, isJidBroadcast, jidNormalizedUser } = require('@whiskeysockets/baileys');

module.exports = function chatsRoutes(app, { store }) {
    const CHAT_ALIASES_FILE = path.join(__dirname, 'data', 'chat-aliases.json');

    function readChatAliases() {
        try {
            if (!fs.existsSync(CHAT_ALIASES_FILE)) return {};
            const raw = JSON.parse(fs.readFileSync(CHAT_ALIASES_FILE, 'utf8'));
            return raw && typeof raw === 'object' ? raw : {};
        } catch {
            return {};
        }
    }

    function writeChatAliases(aliases) {
        const dir = path.dirname(CHAT_ALIASES_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(CHAT_ALIASES_FILE, JSON.stringify(aliases, null, 2));
    }

    app.get('/api/chats', async (req, res) => {
        try {
            if (!store) return res.status(503).json({ error: 'Store not ready' });

            const db = require('../../lib/dbManager');
            const pinned = await db.get('messenger_pinned', []);
            const archived = await db.get('messenger_archived', []);
            const aliases = readChatAliases();

            const chats = [];
            const liveJids = Array.from(store.chats.keys());
            const jids = await messengerStore.listKnownJids(liveJids);
            const selfName = String(global.sock?.user?.name || '')
                .trim()
                .toLowerCase();
            const pushNameCache = global.pushNameCache;
            if (!global.chatNameHydrateCooldown) global.chatNameHydrateCooldown = new Map();
            const hydrateCooldownMs = 10 * 60 * 1000;

            const extractPhone = (value) =>
                String(value || '')
                    .split('@')[0]
                    .split(':')[0];
            const displayFromJid = (value) =>
                extractPhone(value).replace(/\D/g, '') || extractPhone(value);
            const nameLooksNumeric = (value) => /^\+?\d{7,}$/.test(String(value || '').trim());
            const normalizeCandidates = (value) => {
                const norm = jidNormalizedUser(value || '');
                const phone = extractPhone(norm);
                return Array.from(
                    new Set(
                        [
                            value,
                            norm,
                            phone ? `${phone}@s.whatsapp.net` : '',
                            phone ? `${phone}@lid` : '',
                            phone || '',
                        ].filter(Boolean),
                    ),
                );
            };
            const digitsOnly = (value) => String(value || '').replace(/\D/g, '');
            const ownPhones = new Set(
                [global.sock?.user?.id, global.sock?.user?.lid, global.botJid, config.OWNER_NUMBER]
                    .map((v) => digitsOnly(extractPhone(v)))
                    .filter((v) => v && v.length >= 7),
            );
            const isOwnLinkedChat = (jid) => ownPhones.has(digitsOnly(extractPhone(jid)));
            const cacheResolvedName = (jid, name) => {
                if (!jid || !name || !pushNameCache) return;
                const normJid = jidNormalizedUser(jid);
                const phone = normJid.split('@')[0].split(':')[0].replace(/\D/g, '');
                const keys = new Set([jid, normJid]);
                if (phone) {
                    keys.add(phone);
                    keys.add(`${phone}@s.whatsapp.net`);
                    keys.add(`${phone}@lid`);
                }
                for (const key of keys) {
                    if (key) pushNameCache.set(key, name);
                }
            };
            const readCandidateName = (row) =>
                row?.name ||
                row?.notify ||
                row?.pushName ||
                row?.verifiedName ||
                row?.verified_name ||
                '';

            async function hydrateNameFromSocket(jid) {
                const sock = global.sock;
                if (!sock) return '';
                const now = Date.now();
                const until = global.chatNameHydrateCooldown.get(jid) || 0;
                if (until > now) return '';

                const candidates = normalizeCandidates(jid).filter((v) => v.includes('@'));
                let hydrated = '';
                try {
                    if (typeof sock.onWhatsApp === 'function') {
                        for (const candidate of candidates) {
                            const rows = (await sock.onWhatsApp(candidate)) || [];
                            for (const row of rows) {
                                const name = String(readCandidateName(row) || '').trim();
                                if (name && !nameLooksNumeric(name)) {
                                    cacheResolvedName(candidate, name);
                                    if (row?.jid) cacheResolvedName(row.jid, name);
                                    hydrated = name;
                                    break;
                                }
                            }
                            if (hydrated) break;
                        }
                    }
                } catch {}

                if (!hydrated && typeof sock.getBusinessProfile === 'function') {
                    try {
                        for (const candidate of candidates) {
                            const profile = await sock.getBusinessProfile(candidate);
                            const name = String(readCandidateName(profile) || '').trim();
                            if (name && !nameLooksNumeric(name)) {
                                cacheResolvedName(candidate, name);
                                hydrated = name;
                                break;
                            }
                        }
                    } catch {}
                }

                global.chatNameHydrateCooldown.set(jid, now + hydrateCooldownMs);
                return hydrated;
            }

            async function resolveChatName(jid, liveMessages, lastMsg) {
                const isPrivate = !isJidGroup(jid) && !isJidBroadcast(jid);
                const fromIncoming = !lastMsg.key?.fromMe;
                const candidates = normalizeCandidates(jid);
                let resolvedName = '';

                for (const key of candidates) {
                    const v = pushNameCache?.get(key);
                    if (v && !nameLooksNumeric(v)) {
                        resolvedName = v;
                        break;
                    }
                }

                if (
                    !resolvedName &&
                    fromIncoming &&
                    lastMsg.pushName &&
                    !nameLooksNumeric(lastMsg.pushName)
                ) {
                    resolvedName = lastMsg.pushName;
                }

                if (!resolvedName && isPrivate) {
                    const recentIncomingName = await messengerStore.getLatestIncomingPushName(
                        jid,
                        liveMessages,
                    );
                    if (recentIncomingName && !nameLooksNumeric(recentIncomingName)) {
                        resolvedName = recentIncomingName;
                    }
                }

                if (!resolvedName || nameLooksNumeric(resolvedName)) {
                    // Never block /api/chats on remote metadata lookups.
                    // Trigger best-effort hydration in the background; next refresh can pick it up.
                    void hydrateNameFromSocket(jid);
                }

                if (!resolvedName) resolvedName = displayFromJid(jid);

                if (isPrivate && !fromIncoming && selfName) {
                    if (
                        String(resolvedName || '')
                            .trim()
                            .toLowerCase() === selfName &&
                        !isOwnLinkedChat(jid)
                    ) {
                        resolvedName = displayFromJid(jid);
                    }
                }

                return resolvedName;
            }

            for (const jid of jids) {
                const chatMsgs = store.chats.get(jid);
                const liveMessages = chatMsgs ? Array.from(chatMsgs.values()) : [];
                const lastMsg = await messengerStore.getLatestMessage(jid, liveMessages);
                if (!lastMsg) continue;

                const snippet =
                    lastMsg.message?.conversation ||
                    lastMsg.message?.extendedTextMessage?.text ||
                    '[Media]';

                const aliasName = String(aliases[jid] || '').trim();
                const resolvedName =
                    aliasName || (await resolveChatName(jid, liveMessages, lastMsg));

                chats.push({
                    jid,
                    name: resolvedName,
                    lastMsgSnippet: snippet,
                    timestamp: lastMsg.messageTimestamp,
                    isPinned: pinned.includes(jid),
                    isArchived: archived.includes(jid),
                });
            }

            // Sort by timestamp (latest first)
            chats.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

            res.json({ chats, pinned, archived });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.get('/api/chats/:jid/messages', async (req, res) => {
        const { jid } = req.params;
        try {
            if (!store) return res.status(503).json({ error: 'Store not ready' });
            const chatMsgs = store.chats.get(jid);
            const liveMessages = chatMsgs ? Array.from(chatMsgs.values()) : [];
            const page = await messengerStore.getMessagesPage(jid, liveMessages, {
                limit: req.query.limit,
                before: req.query.before,
            });
            res.json(page);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.get('/api/chats/:jid/media', async (req, res) => {
        const { jid } = req.params;
        try {
            const mediaMsgs = await messengerStore.getChatMedia(jid);
            res.json({ messages: mediaMsgs });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.get('/api/chat-aliases', (req, res) => {
        res.json({ aliases: readChatAliases() });
    });

    app.post('/api/chat-alias', (req, res) => {
        const jid = String(req.body?.jid || '').trim();
        const alias = String(req.body?.alias || '').trim();
        if (!jid) return res.status(400).json({ error: 'Missing jid' });

        const aliases = readChatAliases();
        if (!alias) delete aliases[jid];
        else aliases[jid] = alias;
        writeChatAliases(aliases);
        res.json({ ok: true, aliases });
    });

    app.get('/api/chat/:jid/messages', async (req, res) => {
        const { jid } = req.params;
        try {
            if (!store) return res.status(503).json({ error: 'Store not ready' });
            const chatMsgs = store.chats.get(jid);
            const liveMessages = chatMsgs ? Array.from(chatMsgs.values()) : [];
            const page = await messengerStore.getMessagesPage(jid, liveMessages, {
                limit: req.query.limit,
                before: req.query.before,
            });
            res.json(page);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // Server-side profile-pic cache. Keyed by jid. Two flavors:
    //   hit:  { buf, mime, etag, expires }
    //   miss: { miss: true, expires }
    // LRU-bounded so resident memory stays predictable.
    const profilePicCache = new Map();
    const PROFILE_PIC_HIT_TTL_MS = 10 * 60 * 1000;
    const PROFILE_PIC_MISS_TTL_MS = 5 * 60 * 1000;
    const PROFILE_PIC_MAX_ENTRIES = 200;
    const PROFILE_PIC_SKIP_SUFFIXES = ['@newsletter', '@broadcast'];

    function profilePicCacheSet(jid, value) {
        profilePicCache.delete(jid);
        profilePicCache.set(jid, value);
        while (profilePicCache.size > PROFILE_PIC_MAX_ENTRIES) {
            const oldest = profilePicCache.keys().next().value;
            if (oldest === undefined) break;
            profilePicCache.delete(oldest);
        }
    }

    function profilePicCacheTouch(jid) {
        if (!profilePicCache.has(jid)) return;
        const v = profilePicCache.get(jid);
        profilePicCache.delete(jid);
        profilePicCache.set(jid, v);
    }

    app.get('/api/profile-pic/:jid', async (req, res) => {
        const { jid } = req.params;
        try {
            if (PROFILE_PIC_SKIP_SUFFIXES.some((s) => jid.endsWith(s))) {
                res.set('Cache-Control', 'private, max-age=86400');
                return res.status(404).end();
            }

            const now = Date.now();
            const cached = profilePicCache.get(jid);
            if (cached && cached.expires > now) {
                profilePicCacheTouch(jid);
                if (cached.miss) {
                    res.set(
                        'Cache-Control',
                        `private, max-age=${Math.floor((cached.expires - now) / 1000)}`,
                    );
                    return res.status(404).end();
                }
                res.set(
                    'Cache-Control',
                    `private, max-age=${Math.floor((cached.expires - now) / 1000)}`,
                );
                res.set('ETag', cached.etag);
                if (req.headers['if-none-match'] === cached.etag) return res.status(304).end();
                res.set('Content-Type', cached.mime);
                return res.send(cached.buf);
            }

            if (!global.sock) return res.status(503).json({ error: 'Socket not ready' });
            const url = await global.sock.profilePictureUrl(jid, 'image').catch(() => null);
            if (!url) {
                profilePicCacheSet(jid, { miss: true, expires: now + PROFILE_PIC_MISS_TTL_MS });
                res.set(
                    'Cache-Control',
                    `private, max-age=${Math.floor(PROFILE_PIC_MISS_TTL_MS / 1000)}`,
                );
                return res.status(404).end();
            }

            const axios = require('axios');
            const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 10000 });
            const buf = Buffer.from(response.data);
            const crypto = require('crypto');
            const etag = '"' + crypto.createHash('sha1').update(buf).digest('hex') + '"';
            const mime = response.headers['content-type'] || 'image/jpeg';

            profilePicCacheSet(jid, {
                buf,
                mime,
                etag,
                expires: now + PROFILE_PIC_HIT_TTL_MS,
            });

            res.set('Cache-Control', 'private, max-age=3600');
            res.set('ETag', etag);
            if (req.headers['if-none-match'] === etag) return res.status(304).end();
            res.set('Content-Type', mime);
            res.send(buf);
        } catch {
            profilePicCacheSet(jid, { miss: true, expires: Date.now() + PROFILE_PIC_MISS_TTL_MS });
            res.set(
                'Cache-Control',
                `private, max-age=${Math.floor(PROFILE_PIC_MISS_TTL_MS / 1000)}`,
            );
            res.status(404).end();
        }
    });
};
