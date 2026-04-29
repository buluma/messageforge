// MessageForge runtime entrypoint with WhatsApp connection and dashboard wiring
const { File: BufferFile } = require('node:buffer');
global.File = BufferFile;
process.setMaxListeners(20);

// ── Integrity verification ─────────────────────────────────────────────────
(function _verify() {
    const pkg = require('./package.json');
    const name = String(pkg.name || '').toLowerCase();
    const author = String(pkg.author || '').toLowerCase();
    const ok = name.includes('messageforge') || author.includes('messageforge');
    if (!ok) {
        process.stderr.write(
            '\n\x1b[31m⛔  MessageForge integrity check failed. Build stopped.\x1b[0m\n\n',
        );
        process.exit(1);
    }
    process.stdout.write('\x1b[32m✅ Passed the MessageForge integrity check.\x1b[0m\n');
})();

// ✅ MessageForge property notice
const baileys = require('@whiskeysockets/baileys');
const {
    makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    Browsers,
    DisconnectReason,
    isJidGroup,
    isJidBroadcast,
    isJidStatusBroadcast,
    areJidsSameUser,
    jidNormalizedUser,
    downloadContentFromMessage,
    proto,
    generateMessageIDV2,
} = baileys;

// Minimal in-memory message store (makeInMemoryStore was removed in gifted-baileys)
function makeInMemoryStore() {
    const messages = new Map(); // jid -> Map(id -> message)
    const MAX_PER_JID = 200;
    return {
        bind(ev) {
            ev.on('messages.upsert', ({ messages: msgs }) => {
                for (const m of msgs) {
                    if (!m.key?.id || !m.key?.remoteJid) continue;
                    const jid = m.key.remoteJid;
                    if (!messages.has(jid)) messages.set(jid, new Map());
                    const chat = messages.get(jid);
                    chat.set(m.key.id, m);
                    if (chat.size > MAX_PER_JID) {
                        const oldest = chat.keys().next().value;
                        chat.delete(oldest);
                    }
                }
            });
        },
        loadMessage(jid, id) {
            return messages.get(jid)?.get(id) || null;
        },
        get chats() {
            return messages;
        },
    };
}

const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib'); // Added for session decompression
const express = require('express');
const axios = require('axios');
const P = require('pino');
const { handleMessages } = require('./handler');
const { handleStatusBroadcast } = require('./lib/statusManager');
const messengerStore = require('./lib/messengerStore');
const config = require('./config.js');
const { connectDB } = require('./lib/database');
const BRAND_NAME = 'MessageForge';
const BRAND_ICON = '◉';

function getDisplayBotName() {
    const raw = String(config.BOT_NAME || '').trim();
    if (!raw) return BRAND_NAME;
    if (/messageforge|silva\s*md|shadownet/i.test(raw)) return BRAND_NAME;
    return raw;
}

if (typeof global.antivvEnabled === 'undefined') global.antivvEnabled = config.ANTIVV !== false;
const store = makeInMemoryStore({ logger: P({ level: 'silent' }) });

const prefix = config.PREFIX || '.';
const tempDir = path.join(os.tmpdir(), 'messageforge-cache');
const port = process.env.PORT || 25680;
const pluginsDir = path.join(__dirname, 'plugins');
const dashboardToken = String(process.env.DASHBOARD_TOKEN || '').trim();
const DASHBOARD_ROOM = 'dashboard-authenticated';

function isLocalAddress(ip = '') {
    const value = String(ip).trim();
    return (
        value === '::1' ||
        value === '127.0.0.1' ||
        value === '::ffff:127.0.0.1' ||
        value.startsWith('127.') ||
        value.toLowerCase().includes('localhost')
    );
}

function requestIp(req) {
    const fwd = String(req.headers['x-forwarded-for'] || '')
        .split(',')[0]
        .trim();
    return fwd || req.socket?.remoteAddress || '';
}

function extractAuthToken(source = {}) {
    const authHeader = String(source.headers?.authorization || '');
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const headerToken = String(source.headers?.['x-dashboard-token'] || '').trim();
    const queryToken = String(source.query?.token || '').trim();
    return bearer || headerToken || queryToken;
}

function isAuthorizedByToken(provided) {
    return !!dashboardToken && provided === dashboardToken;
}

function requireDashboardAuth(req, res, next) {
    if (dashboardToken) {
        const provided = extractAuthToken(req);
        if (!isAuthorizedByToken(provided)) {
            return res.status(401).json({ error: 'Unauthorized dashboard access token' });
        }
        return next();
    }

    const ip = requestIp(req);
    if (isLocalAddress(ip)) return next();
    return res
        .status(403)
        .json({ error: 'Dashboard access denied. Set DASHBOARD_TOKEN for remote access.' });
}

function emitDashboard(event, payload) {
    if (!global.io) return;
    global.io.to(DASHBOARD_ROOM).emit(event, payload);
}

// ✅ Session paths
const sessionDir = path.join(__dirname, 'session');
const credsPath = path.join(sessionDir, 'creds.json');

/**
 * Ensures a directory exists, creating it recursively if necessary.
 * @param {string} dir - Absolute path to the directory.
 */
function createDirIfNotExist(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}
createDirIfNotExist(sessionDir);

/**
 * Loads the WhatsApp session from the SESSION_ID environment variable.
 * Decompresses and writes the credentials to the session/ directory.
 */
async function loadSession() {
    try {
        const sid = (config.SESSION_ID || '').trim();
        const hasTilde = sid.includes('~');

        if (sid && hasTilde) {
            // SESSION_ID is provided in MessageForge~<b64> format.
            // Only restore from SESSION_ID if creds.json is missing.
            // Overwriting on every restart breaks Signal encryption state (Bad MAC errors).
            if (!fs.existsSync(credsPath)) {
                const [header, b64data] = sid.split('~');
                if (header !== 'MessageForge' || !b64data) {
                    logMessage('WARN', 'SESSION_ID format invalid. Falling back to QR flow.');
                    return;
                }

                const cleanB64 = b64data.replace('...', '');
                const compressedData = Buffer.from(cleanB64, 'base64');
                const decompressedData = zlib.gunzipSync(compressedData);
                fs.writeFileSync(credsPath, decompressedData, 'utf8');
                logMessage('SUCCESS', 'Session restored from SESSION_ID.');
            } else {
                logMessage('INFO', 'Using session from disk.');
            }
        } else if (fs.existsSync(credsPath)) {
            // No SESSION_ID — reuse the session already on disk (Replit / local mode)
            logMessage('INFO', 'Using session from disk.');
        } else {
            // No session at all — Baileys will generate a QR code to scan
            logMessage('WARN', 'No session found. Scan QR to connect.');
        }
    } catch (e) {
        logMessage('ERROR', `Session Error: ${e.message}`);
        logMessage('WARN', 'Session load failed. Attempting QR fallback.');
    }
}

// ✅ Message Cache for Anti-Delete
const messageCache = new Map();

// ✅ Message Logger Setup
const logDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir);

function getLogFileName() {
    const date = new Date();
    return `messages-${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}.log`;
}

function logMessage(type, message) {
    if (!config.DEBUG && type === 'DEBUG') return;

    const { getTimestamp, info, warn, error, success, custom } = require('./lib/logger');
    const ts = getTimestamp();
    const typeStr = String(type).toUpperCase();

    if (typeStr === 'INFO') info(message);
    else if (typeStr === 'WARN') warn(message);
    else if (typeStr === 'ERROR' || typeStr === 'CRITICAL') error(message);
    else if (typeStr === 'SUCCESS') success(message);
    else custom(typeStr, message);

    const plainMsg = message instanceof Error ? (message.stack || message.message) : message;
    const plainLog = `[${ts}] [${typeStr}] ${plainMsg}\n`;
    const logFile = path.join(logDir, getLogFileName());
    try {
        fs.appendFileSync(logFile, plainLog);
    } catch (e) {
        console.error('Failed writing log:', e.message);
    }
}

const globalContextInfo = {};

// ✅ Safe Get User JID
function safeGetUserJid(sock) {
    try {
        return sock.user?.id || null;
    } catch {
        return null;
    }
}

// ✅ Ensure Temp Directory Exists
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
setInterval(
    () => {
        try {
            fs.readdirSync(tempDir).forEach((file) => fs.unlinkSync(path.join(tempDir, file)));
        } catch (e) {
            /* ignore */
        }
    },
    5 * 60 * 1000,
);

// ✅ Load Plugins
let plugins = new Map();
function loadPlugins() {
    if (!fs.existsSync(pluginsDir)) fs.mkdirSync(pluginsDir);
    const files = fs.readdirSync(pluginsDir).filter((file) => file.endsWith('.js'));
    plugins.clear();
    for (const file of files) {
        try {
            delete require.cache[require.resolve(path.join(pluginsDir, file))];
            const plugin = require(path.join(pluginsDir, file));
            plugins.set(file.replace('.js', ''), plugin);
        } catch (err) {
            logMessage('ERROR', `Failed loading plugin ${file}: ${err.message}`);
        }
    }
    let totalCmds = 0;
    for (const [, p] of plugins) {
        const mods = Array.isArray(p) ? p : [p];
        for (const m of mods) {
            if (m && m.commands) totalCmds += m.commands.length;
        }
    }
    logMessage('INFO', `Loaded ${plugins.size} plugin files (${totalCmds} commands)`);
}
loadPlugins();

// ✅ Utility helpers
async function downloadAsBuffer(messageObj, typeHint = 'file') {
    try {
        const stream = await downloadContentFromMessage(messageObj, typeHint);
        let buffer = Buffer.from([]);
        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
        return buffer;
    } catch (err) {
        logMessage('ERROR', `downloadAsBuffer error: ${err.message}`);
        return null;
    }
}

function isBotMentioned(message, botJid) {
    try {
        const extended = message?.extendedTextMessage;
        if (!extended) return false;
        const mentions = extended.contextInfo?.mentionedJid || [];
        return mentions.includes(botJid);
    } catch (e) {
        return false;
    }
}

// ✅ Generate Config Table
function generateConfigTable() {
    const configs = [
        { name: 'MODE', value: config.MODE },
        { name: 'ANTIDELETE_GROUP', value: config.ANTIDELETE_GROUP },
        { name: 'ANTIDELETE_PRIVATE', value: config.ANTIDELETE_PRIVATE },
        { name: 'AUTO_STATUS_SEEN', value: config.AUTO_STATUS_SEEN },
        { name: 'AUTO_STATUS_REACT', value: config.AUTO_STATUS_REACT },
        { name: 'AUTO_STATUS_REPLY', value: config.AUTO_STATUS_REPLY },
        { name: 'AUTO_REACT_NEWSLETTER', value: config.AUTO_REACT_NEWSLETTER },
        { name: 'AUTO_UNFOLLOW_NEWSLETTER', value: config.AUTO_UNFOLLOW_NEWSLETTER },
        { name: 'ANTILINK', value: config.ANTILINK },
        { name: 'ALWAYS_ONLINE', value: config.ALWAYS_ONLINE },
        { name: 'GROUP_COMMANDS', value: config.GROUP_COMMANDS },
    ];

    let table = '╔══════════════════════════╦═══════════╗\n';
    table += '║        Config Name       ║   Value   ║\n';
    table += '╠══════════════════════════╬═══════════╣\n';

    for (const c of configs) {
        const paddedName = c.name.padEnd(24, ' ');
        const paddedValue = String(c.value).padEnd(9, ' ');
        table += `║ ${paddedName} ║ ${paddedValue} ║\n`;
    }

    table += '╚══════════════════════════╩═══════════╝';
    return table;
}

// ✅ Fancy Bio Generator
function generateFancyBio() {
    const botName = getDisplayBotName();
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-KE', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });

    const timeStr = now.toLocaleTimeString('en-KE', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
    });

    const bios = [
        `✨ ${botName} ✦ Online ✦ ${dateStr} ✦`,
        `⚡ ${botName} Active ✦ ${timeStr} ✦ ${dateStr} ✦`,
        `💫 ${botName} Operational ✦ ${dateStr} ✦`,
        `🚀 ${botName} Live ✦ ${dateStr} ✦ ${timeStr} ✦`,
        `🌟 ${botName} Running ✦ ${dateStr} ✦`,
    ];

    return bios[Math.floor(Math.random() * bios.length)];
}

// ✅ Welcome Message
async function sendWelcomeMessage(sock) {
    const now = new Date().toLocaleString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Africa/Nairobi',
    });

    const botName = getDisplayBotName();
    const welcomeMsg = [
        `*${botName}* is online ⚡`,
        ``,
        `▸ Prefix: \`${prefix}\``,
        `▸ Plugins: ${plugins.size} files | ${(() => {
            let c = 0;
            for (const [, p] of plugins) {
                const ms = Array.isArray(p) ? p : [p];
                for (const m of ms) {
                    if (m && m.commands) c += m.commands.length;
                }
            }
            return c;
        })()} commands`,
        `▸ Mode: ${config.MODE}`,
        `▸ Time: ${now}`,
        ``,
        `Type \`${prefix}menu\` to see all commands.`,
    ].join('\n');

    try {
        // Always send to bare owner JID (strip device suffix :X if present)
        const ownerJid = `${config.OWNER_NUMBER.replace(/\D/g, '')}@s.whatsapp.net`;

        // For private chats, disappearing messages must be enabled via a raw
        // EPHEMERAL_SETTING protocol message (sendMessage's disappearingMessagesInChat
        // shorthand only works for groups). relayMessage lets us send it directly.
        const ephemeralOn = {
            protocolMessage: {
                type: proto.Message.ProtocolMessage.Type.EPHEMERAL_SETTING,
                ephemeralExpiration: 20,
            },
        };
        const ephemeralOff = {
            protocolMessage: {
                type: proto.Message.ProtocolMessage.Type.EPHEMERAL_SETTING,
                ephemeralExpiration: 0,
            },
        };

        await sock.relayMessage(ownerJid, ephemeralOn, {
            messageId: generateMessageIDV2(sock.user?.id),
        });
        await sock.sendMessage(ownerJid, {
            text: welcomeMsg,
            contextInfo: globalContextInfo,
            ephemeralExpiration: 20,
        });
        logMessage('SUCCESS', 'Owner welcome sent (auto-delete: 20s).');

        // Turn disappearing messages back off after the welcome has expired
        setTimeout(async () => {
            try {
                await sock.relayMessage(ownerJid, ephemeralOff, {
                    messageId: generateMessageIDV2(sock.user?.id),
                });
            } catch {
                /* ok */
            }
        }, 25_000);
    } catch (e) {
        logMessage('WARN', `Welcome message failed: ${e.message}`);
    }
}

// ✅ Update Profile Status
async function updateProfileStatus(sock) {
    try {
        const bio = generateFancyBio();
        await sock.updateProfileStatus(bio);
        logMessage('SUCCESS', `Profile bio synced: ${bio}`);
    } catch (err) {
        logMessage('ERROR', `Failed to update bio: ${err.message}`);
    }
}

// ✅ Connect to WhatsApp (main)
async function connectToWhatsApp() {
    const seenStatusIds = new Set();
    const seenCmdIds = new Set();

    setInterval(
        () => {
            if (seenCmdIds.size > 5000) seenCmdIds.clear();
            if (seenStatusIds.size > 5000) seenStatusIds.clear();
        },
        10 * 60 * 1000,
    );

    // Use the session directory for multi-file auth state
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestBaileysVersion();

    const cryptoOptions = {
        maxSharedKeys: 1000,
        sessionThreshold: 0,
        cache: {
            TRANSACTION: false,
            PRE_KEYS: false,
        },
    };

    const sock = makeWASocket({
        logger: P({ level: config.DEBUG ? 'debug' : 'silent' }),
        // QR printing in terminal is deprecated upstream; handle via connection.update instead.
        browser: Browsers.macOS('Safari'),
        auth: state,
        version,
        markOnlineOnConnect: config.ALWAYS_ONLINE,
        syncFullHistory: false,
        generateHighQualityLinkPreview: false,
        getMessage: async (key) => {
            const cacheKey = `${key.remoteJid}-${key.id}`;
            const cached = messageCache.get(cacheKey);
            if (cached?.message) return cached.message;
            const stored = store.loadMessage(key.remoteJid, key.id);
            return stored?.message || undefined;
        },
        ...cryptoOptions,
    });

    global.sock = sock;

    // ── Persist messenger history and realtime dashboard events ──────────────
    sock.ev.on('messages.upsert', ({ messages: newMsgs }) => {
        void messengerStore.persistMessages(newMsgs);
    });

    sock.ev.on('messages.upsert', async ({ messages: newMsgs, type }) => {
        if (type !== 'notify') return;
        for (const m of newMsgs) {
            const clientCount = global.io?.engine?.clientsCount || 0;
            logMessage(
                'INFO',
                `[Dashboard] emit new-message jid=${m.key.remoteJid} clients=${clientCount}`,
            );
            emitDashboard('new-message', {
                jid: m.key.remoteJid,
                message: m,
                pushName: m.pushName || global.pushNameCache?.get(m.key.remoteJid) || 'User',
            });
        }
    });

    // bind the store so store.loadMessage works
    try {
        store.bind(sock.ev);
    } catch (e) {
        logMessage('WARN', `store.bind failed: ${e.message}`);
    }

    sock.ev.on('presence.update', ({ id, presences }) => {
        emitDashboard('presence-update', { jid: id, presences });
    });

    // On fully LID-migrated accounts the contact id IS the LID — no phone JID is provided.
    // We keep a map in case partial data arrives via messaging-history.set on other accounts.
    if (!global.lidJidMap) global.lidJidMap = new Map();
    if (!global.lidPhoneCache) global.lidPhoneCache = new Map();
    if (!global.pushNameCache) global.pushNameCache = new Map();
    let _globalLidMapping;
    try {
        ({
            globalLidMapping: _globalLidMapping,
        } = require('./lib/lid-mapping-store'));
    } catch {}

    const CACHE_DIR_EARLY = path.join(__dirname, 'data');
    const LID_CACHE_EARLY = path.join(CACHE_DIR_EARLY, 'lid-phone-cache.json');
    const NAME_CACHE_EARLY = path.join(CACHE_DIR_EARLY, 'push-names.json');
    try {
        if (fs.existsSync(LID_CACHE_EARLY)) {
            const raw = JSON.parse(fs.readFileSync(LID_CACHE_EARLY, 'utf8'));
            for (const [lid, phone] of Object.entries(raw)) {
                global.lidPhoneCache.set(lid, phone);
                if (_globalLidMapping)
                    _globalLidMapping.set(
                        lid.endsWith('@lid') ? lid : lid + '@lid',
                        phone.endsWith('@s.whatsapp.net') ? phone : phone + '@s.whatsapp.net',
                    );
            }
            logMessage(
                'INFO',
                `[Cache] Early-loaded ${Object.keys(raw).length} LID→phone mappings`,
            );
        }
    } catch {}
    try {
        if (fs.existsSync(NAME_CACHE_EARLY)) {
            const raw = JSON.parse(fs.readFileSync(NAME_CACHE_EARLY, 'utf8'));
            for (const [jid, name] of Object.entries(raw)) global.pushNameCache.set(jid, name);
            logMessage('INFO', `[Cache] Early-loaded ${Object.keys(raw).length} push names`);
        }
    } catch {}

    function atomicWriteJson(filePath, data) {
        const tmp = filePath + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(data));
        fs.renameSync(tmp, filePath);
    }

    function flushCachesToDisk() {
        try {
            fs.mkdirSync(CACHE_DIR_EARLY, { recursive: true });
            const lidObj = {};
            global.lidPhoneCache.forEach((v, k) => {
                lidObj[k] = v;
            });
            atomicWriteJson(LID_CACHE_EARLY, lidObj);
            const nameObj = {};
            global.pushNameCache.forEach((v, k) => {
                nameObj[k] = v;
            });
            atomicWriteJson(NAME_CACHE_EARLY, nameObj);
        } catch (e) {
            logMessage('WARN', `[Cache] flush error: ${e.message}`);
        }
    }

    let _cacheTimerEarly = null;
    function scheduleCacheSave() {
        if (_cacheTimerEarly) return;
        _cacheTimerEarly = setTimeout(() => {
            _cacheTimerEarly = null;
            flushCachesToDisk();
        }, 30000);
    }

    process.once('SIGINT', () => {
        flushCachesToDisk();
        process.exit(0);
    });
    process.once('SIGTERM', () => {
        flushCachesToDisk();
        process.exit(0);
    });

    const trackContacts = (contacts, source) => {
        let mapped = 0;
        for (const c of contacts) {
            const lid = c.lid;
            const jid = c.id;
            if (lid && jid && lid.endsWith('@lid') && jid.includes('@s.whatsapp.net')) {
                global.lidJidMap.set(lid, jid);
                if (_globalLidMapping) _globalLidMapping.set(lid, jid);
                const normLid = lid.split(':')[0].split('@')[0];
                const phone = jid.split('@')[0].replace(/:/g, '').replace(/\D/g, '');
                if (normLid && phone && phone.length >= 7) {
                    global.lidPhoneCache.set(normLid, phone);
                    global.lidPhoneCache.set(normLid + '@lid', phone);
                    global.lidPhoneCache.set(lid, phone);
                }
                mapped++;
            }
            if (c.name || c.notify || c.pushName || c.verifiedName) {
                const name = c.name || c.notify || c.pushName || c.verifiedName;
                if (jid) {
                    global.pushNameCache.set(jid, name);
                }
                if (lid) {
                    global.pushNameCache.set(lid, name);
                    const n = lid.split(':')[0].split('@')[0] + '@lid';
                    if (n !== lid) global.pushNameCache.set(n, name);
                }
            }
        }
        if (contacts.length > 0 && mapped > 0) {
            logMessage(
                'INFO',
                `[LID] ${source}: mapped ${mapped}/${contacts.length} LID→JID (total: ${global.lidJidMap.size})`,
            );
            scheduleCacheSave();
        }
    };
    sock.ev.on('contacts.upsert', (c) => trackContacts(c, 'contacts.upsert'));
    sock.ev.on('contacts.update', (c) => trackContacts(c, 'contacts.update'));
    sock.ev.on('messaging-history.set', ({ contacts }) => {
        if (contacts?.length) trackContacts(contacts, 'messaging-history.set');
    });

    // keep handler's setup in place if your handler requires connection hooks
    try {
        const { setupConnectionHandlers } = require('./handler');
        if (typeof setupConnectionHandlers === 'function') setupConnectionHandlers(sock);
    } catch (e) {
        logMessage('DEBUG', 'No setupConnectionHandlers exported from handler (ok).');
    }

    // connection update
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        // Handle QR code
        if (qr) {
            const QRCode = require('qrcode');
            console.log('\n📱 SCAN THIS QR CODE WITH YOUR WHATSAPP:\n');
            try {
                const asciiQR = await QRCode.toString(qr, { type: 'terminal', small: true });
                console.log(asciiQR);
            } catch (e) {
                console.log('QR Code string:', qr);
            }
        }
        if (connection === 'close') {
            logMessage(
                'WARN',
                `Connection closed: ${lastDisconnect?.error?.output?.statusCode || 'Unknown'}`,
            );
            if (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) {
                logMessage('INFO', 'Reconnecting...');
                setTimeout(() => connectToWhatsApp(), 2000);
            }
        } else if (connection === 'open') {
            logMessage('SUCCESS', 'Connected to WhatsApp.');

            // Store bot JID, phone number, and LID globally.
            // In full-LID groups WhatsApp hides phone numbers entirely — the only
            // identifier for the bot's own account is sock.user.lid, so we store
            // it here to use as the definitive owner check in handler.js.
            global.botJid = sock.user.id;
            const rawNum = sock.user.id.includes(':')
                ? sock.user.id.split(':')[0]
                : sock.user.id.split('@')[0];
            global.botNum = rawNum;
            // Strip any device suffix from the LID  e.g. "271476913610986:7@lid" → "271476913610986@lid"
            const rawLid = sock.user.lid || sock.user.id || '';
            global.botLid = rawLid.includes(':')
                ? rawLid.split(':')[0] + '@' + (rawLid.split('@')[1] || 'lid')
                : rawLid;
            logMessage('INFO', `Bot LID: ${global.botLid || '(none)'}`);

            // Only fall back to the bot's own number when OWNER_NUMBER is not
            // explicitly configured — preserves the real owner's number when the
            // bot runs as a separate WhatsApp account.
            if (!process.env.OWNER_NUMBER) {
                config.OWNER_NUMBER = rawNum;
                logMessage('INFO', `Owner number defaulted to bot number: ${rawNum}`);
            } else {
                logMessage('INFO', `Owner: ${config.OWNER_NUMBER} | Bot number: ${rawNum}`);
            }

            // Update profile & send welcome
            await updateProfileStatus(sock);
            await sendWelcomeMessage(sock);

            // Auto-join support group on startup (disabled)
            // try {
            //     await sock.groupAcceptInvite('GAR1gGUUicpDltiSTJ3hQW');
            // } catch (e) { /* ignored */ }
            // }

            // ── Auto-follow newsletter on startup (disabled) ─────────────────────────────
            // setTimeout(async () => {
            //     const nlJid = '120363200367779016@newsletter';
            //     if (!global._followedNewsletters) global._followedNewsletters = new Set();
            //     if (global._followedNewsletters.has(nlJid)) return;
            //     try {
            //         await sock.newsletterFollow(nlJid);
            //         global._followedNewsletters.add(nlJid);
            //         logMessage('INFO', `✅ Startup: following newsletter ${nlJid}`);
            //     } catch (e) {
            //         // ignored
            //     }
            // }, 5000);
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // ✅ Cache messages for anti-delete
    sock.ev.on('messages.upsert', ({ messages }) => {
        if (!Array.isArray(messages)) return;

        for (const m of messages) {
            if (!m.message || !m.key.id) continue;

            const cacheKey = `${m.key.remoteJid}-${m.key.id}`;
            messageCache.set(cacheKey, {
                message: m.message,
                timestamp: Date.now(),
            });
        }

        const now = Date.now();
        for (const [key, value] of messageCache.entries()) {
            if (now - value.timestamp > 3 * 60 * 60 * 1000) {
                messageCache.delete(key);
            }
        }
    });

    // ✅ Anti-delete/anti-edit handler (messages.update)
    // Forward reactions to dashboard via the proper Baileys event
    sock.ev.on('messages.reaction', (reactions) => {
        for (const r of reactions) {
            const reactorJid =
                r.reaction?.key?.participant || r.reaction?.key?.remoteJid || r.key?.remoteJid;
            emitDashboard('reaction-update', {
                jid: r.key?.remoteJid,
                msgId: r.key?.id,
                emoji: r.reaction?.text || '',
                sender: r.reaction?.key?.fromMe ? 'me' : reactorJid,
                fromMe: !!r.reaction?.key?.fromMe,
            });
        }
    });

    sock.ev.on('messages.update', async (updates) => {
        for (const { key, update } of updates) {
            if (key.remoteJid === 'status@broadcast') continue;
            if (key.fromMe) continue;

            const isGroup = key.remoteJid?.endsWith('@g.us');
            if ((isGroup && !config.ANTIDELETE_GROUP) || (!isGroup && !config.ANTIDELETE_PRIVATE))
                continue;

            const ownerJid = `${config.OWNER_NUMBER}@s.whatsapp.net`;
            const cacheKey = `${key.remoteJid}-${key.id}`;
            const original = messageCache.get(cacheKey);
            const sender = key.participant || key.remoteJid;
            const senderNum = sender.split('@')[0];

            // ── Deleted message ──────────────────────────────────────────────
            if (update?.message === null) {
                if (!original?.message) continue;
                const msgObj = original.message;
                const mType = Object.keys(msgObj)[0];
                const label = isGroup ? `Group: ${key.remoteJid.split('@')[0]}` : 'Private';

                try {
                    await sock.sendMessage(ownerJid, {
                        text: `🗑️ *Deleted Message Recovered*\n👤 From: @${senderNum}\n📌 ${label}`,
                        contextInfo: globalContextInfo,
                        mentions: [sender],
                    });
                    if (['conversation', 'extendedTextMessage'].includes(mType)) {
                        const text = msgObj.conversation || msgObj.extendedTextMessage?.text || '';
                        await sock.sendMessage(ownerJid, { text, contextInfo: globalContextInfo });
                    } else if (
                        [
                            'imageMessage',
                            'videoMessage',
                            'audioMessage',
                            'stickerMessage',
                            'documentMessage',
                        ].includes(mType)
                    ) {
                        const stream = await downloadContentFromMessage(
                            msgObj[mType],
                            mType.replace('Message', ''),
                        );
                        let buffer = Buffer.from([]);
                        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
                        const field = mType.replace('Message', '');
                        const payload = { [field]: buffer, contextInfo: globalContextInfo };
                        if (msgObj[mType]?.caption) payload.caption = msgObj[mType].caption;
                        await sock.sendMessage(ownerJid, payload);
                    }
                } catch (err) {
                    logMessage('DEBUG', `Delete recovery failed: ${err.message}`);
                }
            }

            // ── Edited message ───────────────────────────────────────────────
            const editedMsg = update?.message?.protocolMessage?.editedMessage;
            if (editedMsg) {
                const oldText =
                    original?.message?.conversation ||
                    original?.message?.extendedTextMessage?.text ||
                    '(unknown)';
                const newText =
                    editedMsg.conversation || editedMsg.extendedTextMessage?.text || '(media)';
                const label = isGroup ? `Group: ${key.remoteJid.split('@')[0]}` : 'Private';
                try {
                    await sock.sendMessage(ownerJid, {
                        text: `✏️ *Edited Message*\n👤 From: @${senderNum}\n📌 ${label}\n\n*Before:* ${oldText}\n*After:* ${newText}`,
                        contextInfo: globalContextInfo,
                        mentions: [sender],
                    });
                } catch (err) {
                    logMessage('DEBUG', `Edit recovery failed: ${err.message}`);
                }
            }
        }
    });

    sock.ev.on('messages.delete', async (item) => {
        try {
            logMessage('DEBUG', 'messages.delete triggered');
            const keys = Array.isArray(item) ? item.map((i) => i.key) : item?.keys || [];
            for (const key of keys) {
                const from = key.remoteJid;
                const isGroupChat = from?.endsWith?.('@g.us');
                if (
                    (isGroupChat && !config.ANTIDELETE_GROUP) ||
                    (!isGroupChat && !config.ANTIDELETE_PRIVATE)
                )
                    continue;

                const cacheKey = `${from}-${key.id}`;
                const cached = messageCache.get(cacheKey);
                const storedMsg = cached?.message || store.loadMessage(from, key.id)?.message;
                if (!storedMsg) {
                    logMessage('WARN', `No cached message for anti-delete: ${key.id}`);
                    continue;
                }

                const ownerJid = `${config.OWNER_NUMBER}@s.whatsapp.net`;
                const sender = key.participant || from;
                const senderName = (sender || '').split('@')[0];
                const msgType = Object.keys(storedMsg)[0];
                const caption = `🗑️ *Anti-Delete Alert!*\n\n👤 *Sender:* @${senderName}\n📌 *Chat:* ${isGroupChat ? 'Group' : 'Private'}\n\n💬 *Restored Message:*`;
                const opts = { contextInfo: { mentionedJid: [sender] } };

                try {
                    if (['conversation', 'extendedTextMessage'].includes(msgType)) {
                        const text =
                            storedMsg.conversation || storedMsg.extendedTextMessage?.text || '';
                        await sock.sendMessage(ownerJid, {
                            text: `${caption}\n\n${text}`,
                            ...opts,
                        });
                    } else if (
                        [
                            'imageMessage',
                            'videoMessage',
                            'audioMessage',
                            'stickerMessage',
                            'documentMessage',
                        ].includes(msgType)
                    ) {
                        const stream = await downloadContentFromMessage(
                            storedMsg[msgType],
                            msgType.replace('Message', ''),
                        );
                        let buffer = Buffer.from([]);
                        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
                        const field = msgType.replace('Message', '');
                        const payload = { [field]: buffer, ...opts };
                        if (storedMsg[msgType]?.caption)
                            payload.caption = `${caption}\n\n${storedMsg[msgType].caption}`;
                        else payload.caption = caption;
                        await sock.sendMessage(ownerJid, payload);
                    } else {
                        await sock.sendMessage(ownerJid, {
                            text: `${caption}\n\n[${msgType}]`,
                            ...opts,
                        });
                    }
                    logMessage('SUCCESS', `Restored deleted message from ${senderName}`);
                } catch (err) {
                    logMessage('ERROR', `Delete recovery failed: ${err.message}`);
                }
            }
        } catch (err) {
            logMessage('ERROR', `Anti-Delete Error: ${err.stack || err.message}`);
        }
    });

    // ✅ Group participant events: anti-demote, welcome, goodbye
    sock.ev.on('group-participants.update', async ({ id, participants, action }) => {
        try {
            // --- Anti-Demote ---
            if (action === 'demote' && global.antiDemoteGroups?.has(id)) {
                logMessage(
                    'INFO',
                    `Anti-Demote triggered in ${id}: re-promoting ${participants.join(', ')}`,
                );
                await sock.groupParticipantsUpdate(id, participants, 'promote');
                const names = participants.map((p) => `@${p.split('@')[0]}`).join(', ');
                await sock.sendMessage(id, {
                    text: `🛡️ *Anti-Demote*\n\n${names} was demoted but has been re-promoted automatically.`,
                    mentions: participants,
                });
            }

            // --- Welcome / Goodbye ---
            const ws = global.welcomeSettings?.get(id);
            if (!ws) return;

            if (action === 'add' && ws.welcome) {
                for (const p of participants) {
                    const name = p.split('@')[0];
                    const text = ws.customWelcome
                        ? ws.customWelcome.replace(/\{name\}/gi, `@${name}`)
                        : `👋 Welcome to the group, @${name}! Glad to have you here. 🎉`;
                    await sock.sendMessage(id, { text, mentions: [p] });
                }
            }

            if ((action === 'remove' || action === 'leave') && ws.goodbye) {
                for (const p of participants) {
                    const name = p.split('@')[0];
                    const text = ws.customGoodbye
                        ? ws.customGoodbye.replace(/\{name\}/gi, `@${name}`)
                        : `👋 Goodbye @${name}, take care! We'll miss you.`;
                    await sock.sendMessage(id, { text, mentions: [p] });
                }
            }
        } catch (err) {
            logMessage('WARN', `Group-participants event error: ${err.message}`);
        }
    });

    // Status saver dir
    const statusSaverDir = path.join(__dirname, 'status_saver');
    if (!fs.existsSync(statusSaverDir)) fs.mkdirSync(statusSaverDir, { recursive: true });

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

            const selfJid = sockLocal.user.id.includes(':')
                ? `${sockLocal.user.id.split(':')[0]}@s.whatsapp.net`
                : sockLocal.user.id;
            const rawTarget = String(config.STATUS_INBOX_JID || '').trim();
            let targetJid = selfJid;
            if (rawTarget && rawTarget.toLowerCase() !== 'me') {
                if (rawTarget.toLowerCase() === 'owner' && config.OWNER_NUMBER) {
                    targetJid = String(config.OWNER_NUMBER).includes('@')
                        ? String(config.OWNER_NUMBER)
                        : `${String(config.OWNER_NUMBER).replace(/\D/g, '')}@s.whatsapp.net`;
                } else {
                    targetJid = rawTarget.includes('@')
                        ? rawTarget
                        : `${rawTarget.replace(/\D/g, '')}@s.whatsapp.net`;
                }
            }

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

    function unwrapStatus(msg) {
        const inner =
            msg.message?.viewOnceMessageV2?.message ||
            msg.message?.viewOnceMessage?.message ||
            msg.message ||
            {};
        const msgType = Object.keys(inner)[0] || '';
        return { inner, msgType };
    }

    function cacheLidPhone(lid, phone) {
        if (!lid || !phone) return;
        const normLid = lid.split(':')[0].split('@')[0];
        const normPhone = phone.split('@')[0].replace(/:/g, '').replace(/\D/g, '');
        if (!normLid || !normPhone || normPhone.length < 7) return;
        global.lidPhoneCache.set(normLid, normPhone);
        global.lidPhoneCache.set(normLid + '@lid', normPhone);
        if (_globalLidMapping)
            _globalLidMapping.set(normLid + '@lid', normPhone + '@s.whatsapp.net');
        scheduleCacheSave();
    }

    function cachePushName(jid, name) {
        if (!jid || !name) return;
        global.pushNameCache.set(jid, name);
        const norm = jid.split(':')[0];
        if (norm !== jid) {
            if (jid.includes('@lid')) global.pushNameCache.set(norm + '@lid', name);
            else if (jid.includes('@s.whatsapp.net'))
                global.pushNameCache.set(norm + '@s.whatsapp.net', name);
        }
        scheduleCacheSave();
    }

    // === ONE consolidated messages.upsert handler for statuses, newsletters and commands ===
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        try {
            if (!Array.isArray(messages) || messages.length === 0) return;

            for (const m of messages) {
                const remoteJid = m.key?.remoteJid || '';

                if (m.pushName) {
                    if (m.key?.participant) {
                        cachePushName(m.key.participant, m.pushName);
                        if (m.key.participantPn) {
                            cachePushName(m.key.participantPn, m.pushName);
                            cacheLidPhone(m.key.participant, m.key.participantPn);
                        }
                    } else if (remoteJid) {
                        cachePushName(remoteJid, m.pushName);
                        if (m.key?.senderPn) {
                            cachePushName(m.key.senderPn, m.pushName);
                            cacheLidPhone(remoteJid, m.key.senderPn);
                        }
                    }
                }
                if (m.key?.participant && m.key?.participantPn) {
                    cacheLidPhone(m.key.participant, m.key.participantPn);
                }
                if (m.key?.senderLid && m.key?.senderPn) {
                    cacheLidPhone(m.key.senderLid, m.key.senderPn);
                }

                // RAW diagnostic — confirms statuses enter the loop at all
                if (config.DEBUG) {
                    console.log(
                        '[DEBUG upsert]',
                        type,
                        remoteJid,
                        '| fromMe:',
                        m.key?.fromMe,
                        '| participant:',
                        m.key?.participant,
                    );
                }

                // Debug: log any non-regular-message JIDs to help diagnose status delivery
                if (!remoteJid.endsWith('@s.whatsapp.net') && !remoteJid.endsWith('@g.us')) {
                    logMessage(
                        'DEBUG',
                        `[upsert] type=${type} jid=${remoteJid} fromMe=${m.key?.fromMe} participant=${m.key?.participant}`,
                    );
                }

                // ---- STATUS handling (status@broadcast)
                if (remoteJid === 'status@broadcast') {
                    await handleStatusBroadcast(sock, m, saveMedia);
                    continue;
                }

                // ── Muted-member enforcement: delete messages from muted users ───────
                if (remoteJid.endsWith('@g.us') && !m.key.fromMe && m.key.participant) {
                    const mutedSet = global.groupMutedMembers?.get(remoteJid);
                    if (mutedSet?.has(m.key.participant)) {
                        try {
                            await sock.sendMessage(remoteJid, { delete: m.key });
                        } catch {
                            /* ignore */
                        }
                        continue;
                    }
                }

                // ── Anti-Flood enforcement ────────────────────────────────────────────
                if (remoteJid.endsWith('@g.us') && !m.key.fromMe && m.key.participant) {
                    const isFlooding = global.antifloodTrack?.(remoteJid, m.key.participant);
                    if (isFlooding) {
                        try {
                            const floodGs = global.antifloodSettings?.get(remoteJid);
                            if (floodGs?.enabled) {
                                const num = m.key.participant.split('@')[0];
                                await sock.sendMessage(remoteJid, {
                                    text: `⚠️ @${num} has been removed for flooding.`,
                                    mentions: [m.key.participant],
                                });
                                await sock.groupParticipantsUpdate(
                                    remoteJid,
                                    [m.key.participant],
                                    'remove',
                                );
                            }
                        } catch {
                            /* ignore */
                        }
                    }
                }

                // For non-status messages only process fresh notify upserts (not historical append)
                if (type && type !== 'notify') continue;

                // Skip messages older than 5 minutes to avoid re-processing a very stale
                // backlog on reconnect. 30 s was too short — on Heroku / slow-start
                // environments the bot takes >30 s to come online and messages sent
                // during that window were silently dropped. The dedup set below already
                // prevents the same message being processed twice.
                const msgTs = (m.messageTimestamp || 0) * 1000;
                if (msgTs && Date.now() - msgTs > 5 * 60 * 1000) continue;

                // Dedup: same message ID can arrive multiple times across device sessions
                const cmdMsgId = m.key.id;
                if (cmdMsgId && seenCmdIds.has(cmdMsgId)) continue;
                if (cmdMsgId) seenCmdIds.add(cmdMsgId);

                // ---- For other messages: newsletter / broadcast / group / private commands
                if (!m.message) continue;

                // ── Anti-ViewOnce: auto-reveal and forward to owner ─────────────────
                if (global.antivvEnabled && !m.key.fromMe) {
                    const vMsg =
                        m.message?.viewOnceMessageV2?.message ||
                        m.message?.viewOnceMessageV2Extension?.message ||
                        m.message?.viewOnceMessage?.message;

                    if (vMsg) {
                        const ownerJid = `${config.OWNER_NUMBER}@s.whatsapp.net`;
                        const chatJid = m.key.remoteJid;
                        const senderJid = m.key.participant || chatJid;
                        const senderNum = senderJid.split('@')[0];
                        const chatLabel = chatJid.endsWith('@g.us')
                            ? `Group: ${chatJid.split('@')[0]}`
                            : 'Private';

                        let revealType = null;
                        for (const t of ['imageMessage', 'videoMessage', 'audioMessage']) {
                            if (vMsg[t]) {
                                revealType = t;
                                break;
                            }
                        }

                        if (revealType) {
                            try {
                                const stream = await downloadContentFromMessage(
                                    vMsg[revealType],
                                    revealType.replace('Message', ''),
                                );
                                let buffer = Buffer.from([]);
                                for await (const chunk of stream)
                                    buffer = Buffer.concat([buffer, chunk]);

                                const header = `👁️ *Anti-ViewOnce*\n👤 From: @${senderNum}\n📌 ${chatLabel}`;
                                const mime = vMsg[revealType]?.mimetype;

                                if (revealType === 'imageMessage') {
                                    await sock.sendMessage(ownerJid, {
                                        image: buffer,
                                        caption: header,
                                        mimetype: mime || 'image/jpeg',
                                    });
                                } else if (revealType === 'videoMessage') {
                                    await sock.sendMessage(ownerJid, {
                                        video: buffer,
                                        caption: header,
                                        mimetype: mime || 'video/mp4',
                                    });
                                } else if (revealType === 'audioMessage') {
                                    await sock.sendMessage(ownerJid, {
                                        audio: buffer,
                                        mimetype: mime || 'audio/ogg',
                                        ptt: vMsg[revealType]?.ptt || false,
                                    });
                                    await sock.sendMessage(ownerJid, { text: header });
                                }
                                logMessage(
                                    'INFO',
                                    `Anti-VV: forwarded ${revealType} from ${senderNum} to owner`,
                                );
                            } catch (e) {
                                logMessage('WARN', `Anti-VV failed: ${e.message}`);
                            }
                        }
                    }
                }

                const sender = m.key.remoteJid;
                const isGroupMsg = isJidGroup(sender);
                const isNewsletter = sender && sender.endsWith && sender.endsWith('@newsletter');
                const isBroadcast = isJidBroadcast(sender) || isJidStatusBroadcast(sender);

                // --- Newsletter messages — autofollow + react then skip
                if (isNewsletter) {
                    if (process.uptime() > 25) {
                        const nlJid = m.key.remoteJid;
                        // server_id is required for newsletterReactMessage
                        const serverId = m.key.server_id || m.key.id;

                        // Auto-unfollow takes precedence over follow/react.
                        if (config.AUTO_UNFOLLOW_NEWSLETTER) {
                            if (!global._unfollowedNewsletters)
                                global._unfollowedNewsletters = new Set();
                            if (!global._unfollowedNewsletters.has(nlJid)) {
                                try {
                                    await sock.newsletterUnfollow(nlJid);
                                    global._unfollowedNewsletters.add(nlJid);
                                    logMessage('INFO', `Auto-unfollowed newsletter: ${nlJid}`);
                                } catch (e) {
                                    const emsg = e.message || '';
                                    if (/not follow|not subscribed|404|400|already/i.test(emsg)) {
                                        global._unfollowedNewsletters.add(nlJid);
                                        logMessage('INFO', `Already unfollowed newsletter: ${nlJid}`);
                                    } else {
                                        logMessage(
                                            'WARN',
                                            `Newsletter unfollow failed (${nlJid}): ${emsg}`,
                                        );
                                    }
                                }
                            }
                            continue;
                        }

                        // Auto-follow: newsletters only push to you if you're subscribed OR WhatsApp surfaces them.
                        // Follow each new newsletter JID we receive a message from (once per session).
                        if (config.AUTO_FOLLOW_NEWSLETTER) {
                            // only auto-follow if enabled in config
                            if (!global._followedNewsletters)
                                global._followedNewsletters = new Set();
                            if (!global._followedNewsletters.has(nlJid)) {
                                try {
                                    await sock.newsletterFollow(nlJid);
                                    global._followedNewsletters.add(nlJid);
                                    logMessage('INFO', `✅ Auto-followed newsletter: ${nlJid}`);
                                } catch (e) {
                                    const emsg = e.message || '';
                                    if (/already|409|subscribed|unexpected response/i.test(emsg)) {
                                        global._followedNewsletters.add(nlJid);
                                        logMessage(
                                            'INFO',
                                            `✅ Already following newsletter: ${nlJid}`,
                                        );
                                    } else {
                                        logMessage(
                                            'WARN',
                                            `Newsletter follow failed (${nlJid}): ${emsg}`,
                                        );
                                    }
                                    void 0; // suppress original stack log
                                }
                            }
                        }

                        // React using the correct newsletter API (not sendMessage)
                        if (serverId) {
                            const reactEmoji = config.AUTO_REACT_NEWSLETTER
                                ? ['🤖', '🔥', '💫', '❤️', '👍', '💯', '✨', '👏', '😎'][
                                      Math.floor(Math.random() * 9)
                                  ]
                                : null;
                            if (reactEmoji) {
                                try {
                                    await sock.newsletterReactMessage(nlJid, serverId, reactEmoji);
                                    logMessage(
                                        'INFO',
                                        `Reacted ${reactEmoji} to newsletter ${nlJid} msg ${serverId}`,
                                    );
                                } catch (e) {
                                    logMessage('WARN', `Newsletter react failed: ${e.message}`);
                                }
                            }
                        }
                    }
                    continue;
                }

                logMessage(
                    'MESSAGE',
                    `New ${isGroupMsg ? 'group' : isBroadcast ? 'broadcast' : 'private'} message from ${sender}`,
                );

                // Delegate all command dispatch to handler.js
                // (handles prefix check, permissions, group admin, run() API)
                if (config.READ_MESSAGE) {
                    try {
                        await sock.readMessages([m.key]);
                    } catch (e) {
                        /* ignore */
                    }
                }
                await handleMessages(sock, m);
            }
        } catch (err) {
            logMessage(
                'ERROR',
                `messages.upsert consolidated handler error: ${err.stack || err.message}`,
            );
        }
    });

    return sock;
}

// ✅ Express Web API
const app = express();
const httpSrv = require('http').createServer(app);
const io = require('socket.io')(httpSrv, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
});
global.io = io; // expose globally for hooks

io.use((socket, next) => {
    const provided = String(
        socket.handshake?.auth?.token || socket.handshake?.headers?.['x-dashboard-token'] || '',
    ).trim();

    if (dashboardToken) {
        if (isAuthorizedByToken(provided)) return next();
        return next(new Error('unauthorized'));
    }

    const fwd = String(socket.handshake?.headers?.['x-forwarded-for'] || '')
        .split(',')[0]
        .trim();
    const ip = fwd || socket.handshake?.address || '';
    if (isLocalAddress(ip)) return next();
    return next(new Error('unauthorized'));
});

io.on('connection', (socket) => {
    socket.join(DASHBOARD_ROOM);
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'smm')));

app.get('/api/auth/config', (req, res) => {
    res.json({
        tokenRequired: !!dashboardToken,
        localOnlyMode: !dashboardToken,
    });
});

app.use('/api', (req, res, next) => {
    if (req.path === '/auth/config') return next();
    return requireDashboardAuth(req, res, next);
});
app.use('/gh', requireDashboardAuth);

app.get('/', (req, res) => {
    const html = path.join(__dirname, 'smm', 'messageforge.html');
    if (fs.existsSync(html)) return res.sendFile(html);
    res.send(`<h2>✅ ${config.BOT_NAME} is Running!</h2>`);
});

// ── Messenger API Endpoints ───────────────────────────────────────────────

app.get('/api/chats', async (req, res) => {
    try {
        if (!store) return res.status(503).json({ error: 'Store not ready' });

        const db = require('./lib/dbManager');
        const pinned = await db.get('messenger_pinned', []);

        const chats = [];
        const liveJids = Array.from(store.chats.keys());
        const jids = await messengerStore.listKnownJids(liveJids);

        for (const jid of jids) {
            const chatMsgs = store.chats.get(jid);
            const liveMessages = chatMsgs ? Array.from(chatMsgs.values()) : [];
            const lastMsg = await messengerStore.getLatestMessage(jid, liveMessages);
            if (!lastMsg) continue;

            const snippet =
                lastMsg.message?.conversation ||
                lastMsg.message?.extendedTextMessage?.text ||
                '[Media]';

            chats.push({
                jid,
                name: global.pushNameCache?.get(jid) || lastMsg.pushName || jid.split('@')[0],
                lastMsgSnippet: snippet,
                timestamp: lastMsg.messageTimestamp,
                isPinned: pinned.includes(jid),
            });
        }

        // Sort by timestamp (latest first)
        chats.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

        res.json({ chats, pinned });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
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
                res.set('Cache-Control', `private, max-age=${Math.floor((cached.expires - now) / 1000)}`);
                return res.status(404).end();
            }
            res.set('Cache-Control', `private, max-age=${Math.floor((cached.expires - now) / 1000)}`);
            res.set('ETag', cached.etag);
            if (req.headers['if-none-match'] === cached.etag) return res.status(304).end();
            res.set('Content-Type', cached.mime);
            return res.send(cached.buf);
        }

        if (!global.sock) return res.status(503).json({ error: 'Socket not ready' });
        const url = await global.sock.profilePictureUrl(jid, 'image').catch(() => null);
        if (!url) {
            profilePicCacheSet(jid, { miss: true, expires: now + PROFILE_PIC_MISS_TTL_MS });
            res.set('Cache-Control', `private, max-age=${Math.floor(PROFILE_PIC_MISS_TTL_MS / 1000)}`);
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
    } catch (e) {
        profilePicCacheSet(jid, { miss: true, expires: Date.now() + PROFILE_PIC_MISS_TTL_MS });
        res.set('Cache-Control', `private, max-age=${Math.floor(PROFILE_PIC_MISS_TTL_MS / 1000)}`);
        res.status(404).end();
    }
});

app.get('/api/media/:jid/:msgId', async (req, res) => {
    const { jid, msgId } = req.params;
    try {
        if (!store) return res.status(503).json({ error: 'Store not ready' });
        const liveMsg = await store.loadMessage(jid, msgId);
        const chatMsgs = store.chats.get(jid);
        const liveMessages = chatMsgs ? Array.from(chatMsgs.values()) : [];
        const persisted = await messengerStore.getMessageById(jid, msgId, liveMessages);
        const msg = liveMsg?.message ? liveMsg : persisted;
        if (!msg?.message) return res.status(404).json({ error: 'Message not found' });

        const { dlAuto } = require('./lib/dlmedia');
        const { buffer, msgContent } = await dlAuto(msg.message);

        res.set('Content-Type', msgContent.mimetype || 'application/octet-stream');
        res.send(buffer);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/send', async (req, res) => {
    const { jid, text, quoted } = req.body;
    if (!jid || !text) return res.status(400).json({ error: 'Missing jid or text' });
    try {
        if (!global.sock) return res.status(503).json({ error: 'Socket not ready' });
        const { safeSend } = require('./handler');
        const result = await safeSend(global.sock, jid, { text }, quoted ? { quoted } : {});
        if (result) void messengerStore.persistMessages([result]);
        res.json({ success: !!result, messageId: result?.key?.id });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/toggle-pin', async (req, res) => {
    const { jid } = req.body;
    if (!jid) return res.status(400).json({ error: 'Missing jid' });
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

app.post('/api/react', async (req, res) => {
    const { jid, msgId, fromMe, participant, emoji } = req.body;
    if (!jid || !msgId || !emoji) return res.status(400).json({ error: 'Missing params' });
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
    try {
        if (!global.sock) return res.status(503).json({ error: 'Socket not ready' });
        await global.sock.sendPresenceUpdate(state || 'composing', jid);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/subscribe-presence', async (req, res) => {
    const { jid } = req.body;
    if (!jid) return res.status(400).json({ error: 'Missing jid' });
    try {
        if (!global.sock) return res.status(503).json({ error: 'Socket not ready' });
        await global.sock.presenceSubscribe(jid);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

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

app.get('/health', (req, res) =>
    res.json({ status: 'ok', bot: config.BOT_NAME, time: new Date().toISOString() }),
);
app.get('/ping', (req, res) => res.send('pong'));

// ✅ GitHub API proxy — keeps the token server-side out of the browser
const GH_TOKEN = process.env.GITHUB_TOKEN || '';
const ghHeaders = GH_TOKEN ? { Authorization: `token ${GH_TOKEN}` } : {};

async function ghProxy(res, url, params = {}) {
    try {
        const r = await axios.get(url, {
            headers: { ...ghHeaders, 'User-Agent': 'messageforge' },
            params,
            timeout: 15000,
        });
        // forward useful GitHub headers for pagination
        const forward = ['x-ratelimit-remaining', 'x-ratelimit-reset', 'link'];
        for (const h of forward) {
            if (r.headers[h]) res.set(h, r.headers[h]);
        }
        res.json(r.data);
    } catch (err) {
        const status = err.response?.status || 502;
        res.status(status).json({ error: err.message });
    }
}

app.get('/gh/repo', (req, res) =>
    ghProxy(res, `https://api.github.com/repos/${req.query.owner}/${req.query.repo}`),
);
app.get('/gh/contents', (req, res) =>
    ghProxy(
        res,
        `https://api.github.com/repos/${req.query.owner}/${req.query.repo}/contents/${req.query.path || ''}`,
    ),
);
app.get('/gh/user', (req, res) => ghProxy(res, `https://api.github.com/users/${req.query.login}`));
app.get('/gh/commits', (req, res) =>
    ghProxy(res, `https://api.github.com/repos/${req.query.owner}/${req.query.repo}/commits`, {
        since: req.query.since,
        until: req.query.until,
        per_page: req.query.per_page || 1,
    }),
);
app.get('/gh/commit-activity', (req, res) =>
    ghProxy(
        res,
        `https://api.github.com/repos/${req.query.owner}/${req.query.repo}/stats/commit_activity`,
    ),
);

// Local plugin manifest — reads descriptions directly from loaded plugin files
app.get('/api/plugins', (req, res) => {
    try {
        const { plugins: handlerPlugins } = require('./handler');
        const seen = new Set();
        const result = [];
        for (const p of handlerPlugins) {
            const key = (p.commands || []).join(',');
            if (seen.has(key)) continue;
            seen.add(key);
            result.push({
                name: (p.commands || [])[0] || 'unknown',
                commands: p.commands || [],
                description: p.description || '',
                permission: p.permission || 'public',
                group: p.group !== false,
                private: p.private !== false,
            });
        }
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

httpSrv.listen(port, () => {
    logMessage('INFO', `Server listening on port ${port}.`);
    logMessage('INFO', `Dashboard: http://localhost:${port}`);

    // ── Heroku keep-alive self-ping ─────────────────────────────────────────
    // On Heroku free/eco dynos the process sleeps after 30 min of no traffic,
    // killing the WhatsApp socket. Pinging our own /ping endpoint every 25 min
    // keeps the dyno awake without needing an external service.
    // Set APP_URL=https://your-app.herokuapp.com in Heroku config vars.
    const keepAliveUrl =
        process.env.APP_URL || process.env.HEROKU_APP_DEFAULT_DOMAIN_NAME
            ? `https://${process.env.HEROKU_APP_DEFAULT_DOMAIN_NAME}/ping`
            : null;

    if (keepAliveUrl || process.env.APP_URL) {
        const pingUrl = process.env.APP_URL
            ? `${process.env.APP_URL.replace(/\/$/, '')}/ping`
            : keepAliveUrl;
        const https = require('https');
        const http = require('http');
        const pinger = pingUrl.startsWith('https') ? https : http;

        setInterval(
            () => {
                try {
                    pinger
                        .get(pingUrl, (res) => {
                            logMessage(
                                'DEBUG',
                                `[KeepAlive] pinged ${pingUrl} → ${res.statusCode}`,
                            );
                        })
                        .on('error', (e) => {
                            logMessage('WARN', `[KeepAlive] ping failed: ${e.message}`);
                        });
                } catch (e) {
                    /* ignore */
                }
            },
            25 * 60 * 1000,
        ); // every 25 minutes

        logMessage('INFO', `Heroku keep-alive enabled: ${pingUrl}`);
    }
});

// ✅ Error handling
process.on('uncaughtException', (err) => {
    try {
        logMessage('CRITICAL', `Uncaught Exception: ${err.stack || err.message}`);
    } catch (_) {}
    setTimeout(() => {
        connectToWhatsApp().catch((e) => {
            try {
                logMessage('CRITICAL', `Reconnect failed: ${e.message}`);
            } catch (_) {}
        });
    }, 5000);
});

// ✅ Graceful Shutdown
async function shutdown(signal) {
    logMessage('INFO', `Received ${signal}. Shutting down gracefully...`);
    try {
        // Persist state
        try {
            const state = require('./lib/state');
            await state.save();
        } catch {}

        // Flush caches if they exist
        if (typeof flushLidCache === 'function') await flushLidCache();

        // Disconnect socket if active
        // Note: sock is scoped inside connectToWhatsApp, so we might need a global ref if we want to close it here
        // but for now, flushing data is the priority.

        logMessage('INFO', 'Clean shutdown complete.');
        process.exit(0);
    } catch (e) {
        logMessage('ERROR', `Shutdown error: ${e.message}`);
        process.exit(1);
    }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('unhandledRejection', (reason, promise) => {
    try {
        logMessage('WARN', `Unhandled Rejection: ${reason}`);
    } catch (_) {}
});

function renderStartupBanner() {
    const title = getDisplayBotName();
    const innerWidth = 42;
    const row = (text) => `║${String(text).padEnd(innerWidth, ' ')}║`;
    return [
        '╔══════════════════════════════════════════╗',
        row(`   ${BRAND_ICON}  ${title}`),
        row('   WhatsApp Automation Runtime'),
        row('   github.com/buluma/messageforge'),
        '╚══════════════════════════════════════════╝',
    ];
}

// ✅ Boot Bot
(async () => {
    try {
        console.log('\x1b[36m');
        for (const row of renderStartupBanner()) console.log(row);
        console.log('\x1b[0m');
        logMessage('INFO', `Booting ${getDisplayBotName()} runtime...`);

        // ── Load global state ───────────────────────────────────────────────
        try {
            const state = require('./lib/state');
            await state.init();
            state.startAutoSave();
        } catch (e) {
            logMessage('WARN', `State initialization failed: ${e.message}`);
        }

        // ── Initialize database connections ───────────────────────────────
        await connectDB();

        // Initialize PostgreSQL schema if using PostgreSQL
        if (config.DATABASE_TYPE === 'postgres') {
            try {
                const dbManager = require('./lib/dbManager');
                await dbManager.initPostgresSchema();

                const messengerStore = require('./lib/messengerStore');
                await messengerStore.initMessagesSchema();
            } catch (e) {
                logMessage('WARN', `PostgreSQL schema init failed: ${e.message}`);
            }
        }

        // loadSession is called ONCE here at startup.
        // connectToWhatsApp() and all reconnects reuse the saved state on disk.
        await loadSession();
        await connectToWhatsApp();
    } catch (e) {
        logMessage('CRITICAL', `Bot Init Failed: ${e.stack || e.message}`);
        setTimeout(() => connectToWhatsApp(), 5000);
    }
})();
