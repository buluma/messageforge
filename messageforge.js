// MessageForge runtime entrypoint with WhatsApp connection and dashboard wiring
const { File: BufferFile } = require('node:buffer');
global.File = BufferFile;
process.title = 'messageforge';
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
    jidNormalizedUser,
    makeCacheableSignalKeyStore,
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
const { execFile } = require('child_process');
const express = require('express');
const axios = require('axios');
const P = require('pino');
const NodeCache = require('node-cache');
const { handleMessages, groupCache, plugins: handlerPlugins } = require('./handler');
const { handleStatusBroadcast } = require('./lib/statusManager');
const { connectDB, getPgPool } = require('./lib/database');
const { usePostgresAuthState } = require('./lib/baileysPostgresAuth');
const { createMediaRoutes, MEDIA_EXTS, scanMediaDir } = require('./lib/mediaRoutes');
const { makeMessageCache, makeGetMessage, bindAntiDelete } = require('./lib/antiDelete');
const { createStatusSaver } = require('./lib/statusRoutes');
const { createFaceRoutes } = require('./lib/faceRoutes');
const {
    downloadMediaBuffer,
    enqueueAntiViewOnceJob,
    findViewOnceMedia,
    normalizeOwnerJid,
    sendRevealedMedia,
} = require('./lib/viewonce');
const messengerStore = require('./lib/messengerStore');
const config = require('./config.js');
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
const msgRetryCounterCache = new NodeCache({
    stdTTL: 60 * 60,
    checkperiod: 5 * 60,
    useClones: false,
});

let currentSock = null;
let isConnectingToWhatsApp = false;
let reconnectTimer = null;
let flushRuntimeCaches = () => {};
let lastStartupWelcomeAt = 0;
let lastProfileSyncAt = 0;
const STARTUP_WELCOME_MIN_INTERVAL_MS = 10 * 60 * 1000;
const PROFILE_SYNC_MIN_INTERVAL_MS = 30 * 60 * 1000;
const SEND_GUARD_MAX_PER_MIN = config.SEND_GUARD_MAX_PER_MIN;
const SEND_GUARD_PRIORITY_MAX_PER_MIN = 120;
const SEND_GUARD_JITTER_MIN_MS = 100;
const SEND_GUARD_JITTER_MAX_MS = 500;
const SEND_GUARD_PRIORITY_JITTER_MIN_MS = 20;
const SEND_GUARD_PRIORITY_JITTER_MAX_MS = 80;

function clearReconnectTimer() {
    if (!reconnectTimer) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
}

function scheduleReconnect(delayMs = 5000) {
    if (reconnectTimer || isConnectingToWhatsApp) return;
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connectToWhatsApp().catch((e) => {
            logMessage('CRITICAL', `Reconnect failed: ${e.stack || e.message}`);
            scheduleReconnect(Math.min(delayMs * 2, 60000));
        });
    }, delayMs);
}

function closeSocket(sock) {
    if (!sock) return;
    if (sock.__messageforgeSeenCleanupTimer) {
        clearInterval(sock.__messageforgeSeenCleanupTimer);
        sock.__messageforgeSeenCleanupTimer = null;
    }
    if (sock.__messageforgeCacheTimerEarly) {
        clearTimeout(sock.__messageforgeCacheTimerEarly);
        sock.__messageforgeCacheTimerEarly = null;
    }
    if (sock.__messageforgeWelcomeOffTimer) {
        clearTimeout(sock.__messageforgeWelcomeOffTimer);
        sock.__messageforgeWelcomeOffTimer = null;
    }
    try {
        sock.ev?.removeAllListeners?.();
    } catch {}
    try {
        sock.end?.();
    } catch {}
    try {
        sock.ws?.close?.();
    } catch {}
}

function createSendPacer(maxPerMinute, jitterMinMs, jitterMaxMs) {
    const sentAt = [];
    return async function paceSend() {
        let now = Date.now();
        while (sentAt.length && now - sentAt[0] > 60000) sentAt.shift();
        if (sentAt.length >= maxPerMinute) {
            const wait = Math.max(0, 60000 - (now - sentAt[0])) + 50;
            await new Promise((resolve) => setTimeout(resolve, wait));
            now = Date.now();
            while (sentAt.length && now - sentAt[0] > 60000) sentAt.shift();
        }

        const jitter = Math.floor(Math.random() * (jitterMaxMs - jitterMinMs + 1)) + jitterMinMs;
        await new Promise((resolve) => setTimeout(resolve, jitter));
        sentAt.push(Date.now());
    };
}

function isPrioritySend(content) {
    return !!(content?.delete || content?.react);
}

function installSendGuard(sock) {
    if (!sock?.sendMessage || sock.__messageforgeSendGuarded) return sock;

    const rawSendMessage = sock.sendMessage.bind(sock);
    const paceNormalSend = createSendPacer(
        SEND_GUARD_MAX_PER_MIN,
        SEND_GUARD_JITTER_MIN_MS,
        SEND_GUARD_JITTER_MAX_MS,
    );
    const pacePrioritySend = createSendPacer(
        SEND_GUARD_PRIORITY_MAX_PER_MIN,
        SEND_GUARD_PRIORITY_JITTER_MIN_MS,
        SEND_GUARD_PRIORITY_JITTER_MAX_MS,
    );
    let queue = Promise.resolve();
    let priorityQueue = Promise.resolve();

    sock.sendMessage = (jid, content, opts) => {
        const task = async () => {
            await (isPrioritySend(content) ? pacePrioritySend() : paceNormalSend());
            return rawSendMessage(jid, content, opts);
        };

        const selectedQueue = isPrioritySend(content) ? priorityQueue : queue;
        const result = selectedQueue.then(task, task);
        if (isPrioritySend(content)) {
            priorityQueue = result.catch(() => {});
        } else {
            queue = result.catch(() => {});
        }
        return result;
    };

    Object.defineProperty(sock, '__messageforgeSendGuarded', {
        value: true,
        enumerable: false,
        configurable: false,
    });
    Object.defineProperty(sock, '__messageforgeRawSendMessage', {
        value: rawSendMessage,
        enumerable: false,
        configurable: false,
    });

    return sock;
}

const prefix = config.PREFIX || '.';
const tempDir = path.join(os.tmpdir(), 'messageforge-cache');
const port = config.PORT;
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
const messageCache = makeMessageCache({ ttlMs: config.MESSAGE_CACHE_TTL_MS });

// ✅ Message Logger Setup
const logDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir);

const LOG_MAX_FILE_BYTES = Math.max(
    256 * 1024,
    Number(config.LOG_MAX_FILE_BYTES) || 5 * 1024 * 1024,
);
const LOG_MAX_AGE_MS = Math.max(1, Number(config.LOG_MAX_AGE_DAYS) || 2) * 24 * 60 * 60 * 1000;
const LOG_MAX_TOTAL_BYTES = Math.max(
    LOG_MAX_FILE_BYTES * 2,
    Number(config.LOG_MAX_TOTAL_BYTES) || 200 * 1024 * 1024,
);

function getLogFileName(date) {
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

    const plainMsg = message instanceof Error ? message.stack || message.message : message;
    const plainLog = `[${ts}] [${typeStr}] ${plainMsg}\n`;
    let logFile = path.join(logDir, getLogFileName(new Date()));
    try {
        // Rotate when file exceeds configured byte limit.
        if (fs.existsSync(logFile)) {
            const stat = fs.statSync(logFile);
            if (stat.size >= LOG_MAX_FILE_BYTES) {
                const rotatedFile = logFile.replace('.log', `_${Date.now()}.log`);
                fs.renameSync(logFile, rotatedFile);
                logFile = path.join(logDir, getLogFileName(new Date()));
            }
        }
        fs.appendFileSync(logFile, plainLog);
    } catch (e) {
        console.error('Failed writing log:', e.message);
    }
}

function cleanupLogs() {
    try {
        const now = Date.now();
        const files = fs
            .readdirSync(logDir)
            .filter((file) => file.endsWith('.log'))
            .map((file) => {
                const filePath = path.join(logDir, file);
                const stat = fs.statSync(filePath);
                return { file, filePath, mtimeMs: stat.mtimeMs, size: stat.size };
            })
            .sort((a, b) => a.mtimeMs - b.mtimeMs);

        for (const item of files) {
            if (now - item.mtimeMs > LOG_MAX_AGE_MS) {
                fs.unlinkSync(item.filePath);
                logMessage('INFO', `Cleaned old log: ${item.file}`);
            }
        }

        const survivors = fs
            .readdirSync(logDir)
            .filter((file) => file.endsWith('.log'))
            .map((file) => {
                const filePath = path.join(logDir, file);
                const stat = fs.statSync(filePath);
                return { file, filePath, mtimeMs: stat.mtimeMs, size: stat.size };
            })
            .sort((a, b) => a.mtimeMs - b.mtimeMs);

        let currentTotal = survivors.reduce((sum, f) => sum + f.size, 0);
        for (const item of survivors) {
            if (currentTotal <= LOG_MAX_TOTAL_BYTES) break;
            fs.unlinkSync(item.filePath);
            currentTotal -= item.size;
            logMessage('INFO', `Pruned log by total-size cap: ${item.file}`);
        }
    } catch {
        // ignore
    }
}

const globalContextInfo = {};

// ── Startup environment validation ────────────────────────────────────────────
function validateEnv() {
    if (!config.OWNER_NUMBER) {
        logMessage('WARN', 'OWNER_NUMBER is not set. Owner-only features will be unavailable.');
    }
    const sid = (config.SESSION_ID || '').trim();
    if (!sid && !fs.existsSync(credsPath)) {
        logMessage(
            'WARN',
            'SESSION_ID is not set and no session/creds.json found. QR scan required.',
        );
    }
    if (config.DATABASE_TYPE === 'postgres' && !config.POSTGRES_HOST) {
        logMessage(
            'WARN',
            'DATABASE_TYPE=postgres but POSTGRES_HOST is not set. Database connection will fail.',
        );
    }
}

const VALID_JID_RE = /^[^@]+@(s\.whatsapp\.net|g\.us|lid|newsletter)$/;
function isValidJid(jid) {
    return typeof jid === 'string' && VALID_JID_RE.test(jid);
}

const VALID_PRESENCE_STATES = new Set(['typing', 'recording', 'paused', 'composing']);

// ✅ Ensure Temp Directory Exists
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
setInterval(
    () => {
        try {
            fs.readdirSync(tempDir).forEach((file) => fs.unlinkSync(path.join(tempDir, file)));
        } catch {
            /* ignore */
        }
    },
    5 * 60 * 1000,
);

// ✅ Auto-delete stale logs and cap total log footprint
cleanupLogs();
setInterval(
    () => cleanupLogs(),
    60 * 60 * 1000, // check every hour
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
        sock.__messageforgeWelcomeOffTimer = setTimeout(async () => {
            try {
                if (currentSock !== sock) return;
                await sock.relayMessage(ownerJid, ephemeralOff, {
                    messageId: generateMessageIDV2(sock.user?.id),
                });
            } catch {
                /* ok */
            } finally {
                if (sock.__messageforgeWelcomeOffTimer) sock.__messageforgeWelcomeOffTimer = null;
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

async function getBaileysAuthState() {
    if (config.DATABASE_TYPE === 'postgres') {
        const pool = getPgPool();
        if (pool) {
            try {
                const authState = await usePostgresAuthState(pool, sessionDir);
                logMessage('INFO', 'Using PostgreSQL-backed Baileys auth state.');
                return authState;
            } catch (err) {
                logMessage(
                    'WARN',
                    `PostgreSQL Baileys auth unavailable, falling back to session files: ${err.message}`,
                );
            }
        } else {
            logMessage('WARN', 'DATABASE_TYPE=postgres but PostgreSQL pool is unavailable.');
        }
    }

    return useMultiFileAuthState(sessionDir);
}

async function connectToWhatsApp() {
    if (isConnectingToWhatsApp) return currentSock;
    isConnectingToWhatsApp = true;
    clearReconnectTimer();
    try {
        return await createWhatsAppSocket();
    } finally {
        isConnectingToWhatsApp = false;
    }
}

// ✅ Connect to WhatsApp (main)
async function createWhatsAppSocket() {
    const seenStatusIds = new Set();
    const seenCmdIds = new Set();
    let seenCleanupTimer = null;
    let pairingRequested = false;

    // Use the session directory for multi-file auth state
    const { state, saveCreds } = await getBaileysAuthState();
    const { version } = await fetchLatestBaileysVersion();
    const baileysLogger = P({ level: config.DEBUG ? 'debug' : 'silent' });

    const cryptoOptions = {
        maxSharedKeys: 1000,
        sessionThreshold: 0,
        cache: {
            TRANSACTION: false,
            PRE_KEYS: false,
        },
    };

    const sock = makeWASocket({
        logger: baileysLogger,
        // QR printing in terminal is deprecated upstream; handle via connection.update instead.
        browser: Browsers.macOS('Safari'),
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, baileysLogger),
        },
        version,
        msgRetryCounterCache,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 120000,
        markOnlineOnConnect: config.ALWAYS_ONLINE,
        syncFullHistory: false,
        generateHighQualityLinkPreview: false,
        getMessage: makeGetMessage({ messageCache, store }),
        shouldIgnoreJid: (jid) =>
            typeof jid === 'string' &&
            isJidBroadcast(jid) &&
            !isJidStatusBroadcast(jid) &&
            !jid.endsWith('@newsletter'),
        ...cryptoOptions,
    });
    installSendGuard(sock);

    if (currentSock && currentSock !== sock) {
        closeSocket(currentSock);
    }
    currentSock = sock;
    global.sock = sock;
    seenCleanupTimer = setInterval(
        () => {
            if (seenCmdIds.size > 5000) seenCmdIds.clear();
            if (seenStatusIds.size > 5000) seenStatusIds.clear();
        },
        10 * 60 * 1000,
    );
    sock.__messageforgeSeenCleanupTimer = seenCleanupTimer;

    // ── Persist messenger history and realtime dashboard events ──────────────
    const onPersistMessagesUpsert = ({ messages: newMsgs }) => {
        messengerStore
            .persistMessages(newMsgs)
            .catch((e) => logMessage('WARN', `[persist] failed to save messages: ${e.message}`));
    };

    const onDashboardMessagesUpsert = async ({ messages: newMsgs, type }) => {
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
    };

    // bind the store so store.loadMessage works
    try {
        store.bind(sock.ev);
    } catch (e) {
        logMessage('WARN', `store.bind failed: ${e.message}`);
    }

    const onPresenceUpdate = ({ id, presences }) => {
        emitDashboard('presence-update', { jid: id, presences });
    };

    // On fully LID-migrated accounts the contact id IS the LID — no phone JID is provided.
    // We keep a map in case partial data arrives via messaging-history.set on other accounts.
    if (!global.lidJidMap) global.lidJidMap = new Map();
    if (!global.lidPhoneCache) global.lidPhoneCache = new Map();
    if (!global.pushNameCache) global.pushNameCache = new Map();
    let _globalLidMapping;
    try {
        ({ globalLidMapping: _globalLidMapping } = require('./lib/lid-mapping-store'));
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

    function scheduleCacheSave() {
        if (sock.__messageforgeCacheTimerEarly) return;
        sock.__messageforgeCacheTimerEarly = setTimeout(() => {
            sock.__messageforgeCacheTimerEarly = null;
            flushCachesToDisk();
        }, 30000);
    }

    flushRuntimeCaches = flushCachesToDisk;

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
                if (jid) cachePushName(jid, name);
                if (lid) cachePushName(lid, name);
            }
        }
        if (contacts.length > 0 && mapped > 0) {
            const LID_JID_MAP_MAX = config.LID_JID_MAP_MAX;
            const LID_PHONE_CACHE_MAX = config.LID_PHONE_CACHE_MAX;
            if (global.lidJidMap.size > LID_JID_MAP_MAX) {
                const evict = Math.floor(LID_JID_MAP_MAX * 0.1);
                const keys = Array.from(global.lidJidMap.keys()).slice(0, evict);
                for (const k of keys) global.lidJidMap.delete(k);
            }
            if (global.lidPhoneCache.size > LID_PHONE_CACHE_MAX) {
                const evict = Math.floor(LID_PHONE_CACHE_MAX * 0.1);
                const keys = Array.from(global.lidPhoneCache.keys()).slice(0, evict);
                for (const k of keys) global.lidPhoneCache.delete(k);
            }
            logMessage(
                'INFO',
                `[LID] ${source}: mapped ${mapped}/${contacts.length} LID→JID (total: ${global.lidJidMap.size})`,
            );
            scheduleCacheSave();
        }
    };
    const onContactsUpsert = (c) => trackContacts(c, 'contacts.upsert');
    const onContactsUpdate = (c) => trackContacts(c, 'contacts.update');
    const onMessagingHistorySet = ({ contacts }) => {
        if (contacts?.length) trackContacts(contacts, 'messaging-history.set');
    };

    // keep handler's setup in place if your handler requires connection hooks
    try {
        const { setupConnectionHandlers } = require('./handler');
        if (typeof setupConnectionHandlers === 'function') setupConnectionHandlers(sock);
    } catch {
        logMessage('DEBUG', 'No setupConnectionHandlers exported from handler (ok).');
    }

    // connection update
    const onConnectionUpdate = async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr && config.PAIRING_CODE && !pairingRequested && !sock?.authState?.creds?.registered) {
            const number = String(config.PAIRING_NUMBER || '').replace(/\D/g, '');
            if (number) {
                try {
                    pairingRequested = true;
                    const code = await sock.requestPairingCode(number);
                    logMessage('INFO', `Pairing code for ${number}: ${code}`);
                } catch (e) {
                    pairingRequested = false;
                    logMessage('WARN', `Failed to request pairing code: ${e.message}`);
                }
            } else {
                logMessage(
                    'WARN',
                    'PAIRING_CODE=true but PAIRING_NUMBER is empty; falling back to QR.',
                );
            }
        }

        // Handle QR code
        if (qr) {
            const QRCode = require('qrcode');
            logMessage('INFO', '📱 SCAN THIS QR CODE WITH YOUR WHATSAPP:');
            try {
                const asciiQR = await QRCode.toString(qr, { type: 'terminal', small: true });
                console.log(asciiQR); // Keep QR art in console for readability
            } catch {
                logMessage('INFO', `QR Code string: ${qr}`);
            }
        }
        if (connection === 'close') {
            closeSocket(sock);
            seenCleanupTimer = null;
            if (currentSock === sock) {
                currentSock = null;
                if (global.sock === sock) global.sock = null;
            }
            logMessage(
                'WARN',
                `Connection closed: ${lastDisconnect?.error?.output?.statusCode || 'Unknown'}`,
            );
            if (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) {
                logMessage('INFO', 'Reconnecting...');
                scheduleReconnect(2000);
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

            const now = Date.now();
            if (now - lastProfileSyncAt > PROFILE_SYNC_MIN_INTERVAL_MS) {
                lastProfileSyncAt = now;
                await updateProfileStatus(sock);
            } else {
                logMessage('DEBUG', 'Skipped profile bio sync; recently updated.');
            }

            if (now - lastStartupWelcomeAt > STARTUP_WELCOME_MIN_INTERVAL_MS) {
                lastStartupWelcomeAt = now;
                await sendWelcomeMessage(sock);
            } else {
                logMessage('DEBUG', 'Skipped owner welcome; recently sent.');
            }

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
    };

    const onCredsUpdate = (credsUpdate) => saveCreds(credsUpdate);

    // ✅ Anti-delete/anti-edit handler (messages.update)
    // Forward reactions to dashboard via the proper Baileys event
    const onMessagesReaction = (reactions) => {
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
    };

    const antiDelete = bindAntiDelete(sock, messageCache, {
        store,
        logMessage,
        globalContextInfo,
        downloadContentFromMessage,
    });
    const onCacheMessagesUpsert = antiDelete.onCacheMessagesUpsert;
    const onMessagesUpdate = antiDelete.onMessagesUpdate;
    const onMessagesDelete = antiDelete.onMessagesDelete;

    // ✅ Group participant events: anti-demote, welcome, goodbye
    const onGroupParticipantsUpdate = async (update) => {
        const { id, participants, action } = update;
        try {
            // Invalidate group metadata cache so next fetch reflects new membership
            groupCache.delete(id);

            // Run plugin onGroupParticipantsUpdate hooks (e.g. greet, antibot)
            for (const p of handlerPlugins) {
                if (typeof p.onGroupParticipantsUpdate !== 'function') continue;
                try {
                    await p.onGroupParticipantsUpdate(sock, update);
                } catch {
                    /* ignore */
                }
            }

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
    };

    const { saveMedia } = createStatusSaver({
        rootDir: __dirname,
        downloadContentFromMessage,
        logMessage,
    });

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
        const normJid = jidNormalizedUser(jid);
        const phone = normJid.split('@')[0].split(':')[0].replace(/\D/g, '');
        const candidates = new Set([jid, normJid]);
        if (phone) {
            candidates.add(phone);
            candidates.add(`${phone}@s.whatsapp.net`);
            candidates.add(`${phone}@lid`);
        }
        for (const key of candidates) {
            if (key) global.pushNameCache.set(key, name);
        }
        scheduleCacheSave();
    }

    // === ONE consolidated messages.upsert handler for statuses, newsletters and commands ===
    const onConsolidatedMessagesUpsert = async ({ messages, type }) => {
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
                    } else if (remoteJid && !m.key?.fromMe) {
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
                    logMessage(
                        'DEBUG',
                        `[upsert] ${type} ${remoteJid} | fromMe: ${m.key?.fromMe} | participant: ${m.key?.participant}`,
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
                    const reveal = findViewOnceMedia(m.message, { allowPlainMedia: true });

                    if (config.DEBUG) {
                        logMessage(
                            'DEBUG',
                            `[Anti-VV] Keys: ${reveal?.message ? Object.keys(reveal.message).join(', ') : 'none'}`,
                        );
                    }

                    if (reveal) {
                        const ownerJid = normalizeOwnerJid(config.OWNER_NUMBER);
                        const chatJid = m.key.remoteJid;
                        const senderJid = m.key.participant || chatJid;
                        const senderNum = senderJid.split('@')[0];
                        const chatLabel = chatJid.endsWith('@g.us')
                            ? `Group: ${chatJid.split('@')[0]}`
                            : 'Private';
                        const header = `👁️ *Anti-ViewOnce*\n👤 From: @${senderNum}\n📌 ${chatLabel}`;

                        enqueueAntiViewOnceJob(
                            async () => {
                                if (!ownerJid) throw new Error('OWNER_NUMBER is not configured');
                                const buffer = await downloadMediaBuffer(
                                    reveal.content,
                                    reveal.mediaType,
                                    {
                                        maxBytes: config.ANTIVV_MAX_BYTES,
                                    },
                                );
                                await sendRevealedMedia(
                                    sock,
                                    ownerJid,
                                    {
                                        ...reveal,
                                        buffer,
                                        caption: header,
                                    },
                                    { audioCaptionAsText: true },
                                );
                                logMessage(
                                    'INFO',
                                    `Anti-VV: forwarded ${reveal.type} from ${senderNum} to owner`,
                                );
                                try {
                                    const fs = require('fs');
                                    const path = require('path');
                                    const dlDir = path.join(process.cwd(), 'downloads', 'viewonce');
                                    fs.mkdirSync(dlDir, { recursive: true });
                                    const ext =
                                        reveal.mediaType === 'image'
                                            ? '.jpg'
                                            : reveal.mediaType === 'video'
                                              ? '.mp4'
                                              : reveal.mediaType === 'audio'
                                                ? '.ogg'
                                                : '.bin';
                                    const filePath = path.join(
                                        dlDir,
                                        `${senderNum}_${Date.now()}${ext}`,
                                    );
                                    fs.writeFileSync(filePath, buffer);
                                    logMessage(
                                        'INFO',
                                        `Anti-VV: saved ${reveal.type} to ${filePath}`,
                                    );
                                } catch (e) {
                                    logMessage(
                                        'WARN',
                                        `Anti-VV: failed to save to disk: ${e.message}`,
                                    );
                                }
                            },
                            {
                                maxQueue: config.ANTIVV_QUEUE_LIMIT,
                                onDrop: () =>
                                    logMessage('WARN', 'Anti-VV queue full; dropped media forward'),
                                onError: (e) => {
                                    logMessage('WARN', `Anti-VV failed: ${e.message}`);
                                },
                            },
                        );
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
                                        logMessage(
                                            'INFO',
                                            `Already unfollowed newsletter: ${nlJid}`,
                                        );
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
                    } catch {
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
    };

    sock.ev.process(async (events) => {
        if (events['connection.update']) {
            await onConnectionUpdate(events['connection.update']);
        }
        if (events['presence.update']) {
            await onPresenceUpdate(events['presence.update']);
        }
        if (events['contacts.upsert']) {
            await onContactsUpsert(events['contacts.upsert']);
        }
        if (events['contacts.update']) {
            await onContactsUpdate(events['contacts.update']);
        }
        const handleChatsArchive = async (chatsArray) => {
            if (!chatsArray || !chatsArray.length) return;
            const db = require('./lib/dbManager');
            let archived = await db.get('messenger_archived', []);
            let changed = false;
            for (const c of chatsArray) {
                if (c.id) {
                    const isArch = c.archive !== undefined ? c.archive : c.archived;
                    if (isArch === true && !archived.includes(c.id)) {
                        archived.push(c.id);
                        changed = true;
                    } else if (isArch === false && archived.includes(c.id)) {
                        archived = archived.filter((j) => j !== c.id);
                        changed = true;
                    }
                }
            }
            if (changed) await db.set('messenger_archived', archived);
        };

        if (events['chats.update']) await handleChatsArchive(events['chats.update']);
        if (events['chats.upsert']) await handleChatsArchive(events['chats.upsert']);

        if (events['messaging-history.set']) {
            await onMessagingHistorySet(events['messaging-history.set']);
            await handleChatsArchive(events['messaging-history.set'].chats);
        }
        if (events['creds.update']) {
            await onCredsUpdate(events['creds.update']);
        }
        if (events['messages.reaction']) {
            await onMessagesReaction(events['messages.reaction']);
        }
        if (events['messages.update']) {
            await onMessagesUpdate(events['messages.update']);
        }
        if (events['messages.delete']) {
            await onMessagesDelete(events['messages.delete']);
        }
        if (events['group-participants.update']) {
            await onGroupParticipantsUpdate(events['group-participants.update']);
        }
        if (events['messages.upsert']) {
            onPersistMessagesUpsert(events['messages.upsert']);
            onCacheMessagesUpsert(events['messages.upsert']);
            await onDashboardMessagesUpsert(events['messages.upsert']);
            await onConsolidatedMessagesUpsert(events['messages.upsert']);
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

app.use(express.json({ limit: '70mb' }));

// ── Security headers ──────────────────────────────────────────────────────────
app.use((req, res, next) => {
    res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self' cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' fonts.googleapis.com; font-src fonts.gstatic.com; img-src 'self' data: avatars.githubusercontent.com; connect-src 'self' api.github.com wss:; media-src 'self' blob:",
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    next();
});

// ── API rate limiter (120 req/min per IP, /api/* only) ────────────────────────
// Static image routes (thumbnails, face crops) are excluded — they're called
// by the browser for every gallery tile and would exhaust the budget instantly.
const _apiRateLimitMap = new Map();
const _rateLimitExempt = new Set(['/api/media/thumb', '/api/media/face']);
app.use('/api', (req, res, next) => {
    const base = '/' + req.path.split('/').slice(1, 4).join('/');
    if (req.path.startsWith('/media/')) return next();
    if (_rateLimitExempt.has(base)) return next();

    const ip = requestIp(req);
    const now = Date.now();
    const window = 60 * 1000;
    const limit = 120;

    let entry = _apiRateLimitMap.get(ip);
    if (!entry || now >= entry.resetAt) {
        entry = { count: 0, resetAt: now + window };
        _apiRateLimitMap.set(ip, entry);
    }

    entry.count++;
    if (entry.count > limit) {
        return res.status(429).json({ error: 'Too many requests' });
    }
    next();
});

app.use(express.static(path.join(__dirname, 'smm')));
app.use('/media-files', requireDashboardAuth, express.static(path.join(__dirname, 'data')));

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

function dirSizeBytes(dir) {
    try {
        if (!fs.existsSync(dir)) return 0;
        let total = 0;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) total += dirSizeBytes(full);
            else if (entry.isFile()) total += fs.statSync(full).size;
        }
        return total;
    } catch {
        return null;
    }
}

app.get('/api/ops/health', (req, res) => {
    const memory = process.memoryUsage();
    const dataDir = path.join(__dirname, 'data');
    const logsDir = path.join(__dirname, 'logs');
    const sessionDir = path.join(__dirname, 'session');

    res.json({
        status: global.sock ? 'ok' : 'degraded',
        time: new Date().toISOString(),
        uptimeSeconds: Math.floor(process.uptime()),
        node: process.version,
        bot: {
            name: config.BOT_NAME,
            socketReady: !!global.sock,
            user: global.sock?.user?.id || null,
        },
        counts: {
            plugins: plugins.length,
            bannedUsers: global.bannedUsers?.size || 0,
            autoReplySchedules: Object.keys(global.autoReplySchedules || {}).length,
        },
        integrations: {
            telegramAutoSend: process.env.TELEGRAM_AUTO_SEND === 'true',
            telegramConfigured: !!process.env.TELEGRAM_BOT_TOKEN && !!process.env.TELEGRAM_CHAT_ID,
            dashboardTokenRequired: !!dashboardToken,
        },
        storage: {
            dataBytes: dirSizeBytes(dataDir),
            logsBytes: dirSizeBytes(logsDir),
            sessionBytes: dirSizeBytes(sessionDir),
        },
        memory: {
            rss: memory.rss,
            heapUsed: memory.heapUsed,
            heapTotal: memory.heapTotal,
            external: memory.external,
        },
    });
});

app.get('/', (req, res) => {
    const html = path.join(__dirname, 'smm', 'messageforge.html');
    if (fs.existsSync(html)) return res.sendFile(html);
    res.send(`<h2>✅ ${config.BOT_NAME} is Running!</h2>`);
});

// ── Messenger API Endpoints ───────────────────────────────────────────────

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

        const db = require('./lib/dbManager');
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
            const resolvedName = aliasName || (await resolveChatName(jid, liveMessages, lastMsg));

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
        res.set('Cache-Control', `private, max-age=${Math.floor(PROFILE_PIC_MISS_TTL_MS / 1000)}`);
        res.status(404).end();
    }
});

const {
    buildIndex: facesBuildIndex,
    getPersons,
    getFaceCoverage,
    renamePerson,
    mergePerson,
    deletePerson,
    linkPersonJid,
    getStatus: facesStatus,
    FACES_DIR,
} = require('./lib/faceIndexer');
app.use(
    '/api/media',
    createFaceRoutes({
        mediaDataDir: path.join(__dirname, 'data'),
        scanMediaDir,
        mediaExts: MEDIA_EXTS,
        facesDir: FACES_DIR,
        facesBuildIndex,
        facesStatus,
        getPersons,
        getFaceCoverage,
        renamePerson,
        mergePerson,
        deletePerson,
        linkPersonJid,
    }),
);

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

app.post('/api/send', async (req, res) => {
    const { jid, text, quoted } = req.body;
    if (!jid || !text) return res.status(400).json({ error: 'Missing jid or text' });
    if (!isValidJid(jid)) return res.status(400).json({ error: 'Invalid jid' });
    try {
        if (!global.sock) return res.status(503).json({ error: 'Socket not ready' });
        const { safeSend } = require('./handler');
        const result = await safeSend(global.sock, jid, { text }, quoted ? { quoted } : {});
        if (result)
            messengerStore
                .persistMessages([result])
                .catch((e) => logMessage('WARN', `[persist] send persist failed: ${e.message}`));
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
        const { safeSend } = require('./handler');
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

const MEDIA_DATA_DIR = path.join(__dirname, 'data');

app.use(
    '/api/media',
    createMediaRoutes({ mediaDataDir: MEDIA_DATA_DIR, requireDashboardAuth, facesBuildIndex }),
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

// ── Quick-reply templates ─────────────────────────────────────────────────────

const QUICK_REPLIES_FILE = path.join(__dirname, 'data', 'quick-replies.json');

function readQuickReplies() {
    try {
        if (!fs.existsSync(QUICK_REPLIES_FILE)) return [];
        const raw = JSON.parse(fs.readFileSync(QUICK_REPLIES_FILE, 'utf8'));
        return Array.isArray(raw) ? raw : [];
    } catch {
        return [];
    }
}

function writeQuickReplies(templates) {
    const dir = path.dirname(QUICK_REPLIES_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(QUICK_REPLIES_FILE, JSON.stringify(templates, null, 2));
}

app.get('/api/quick-replies', (req, res) => {
    res.json(readQuickReplies());
});

app.post('/api/quick-replies', (req, res) => {
    const label = String(req.body?.label || '').trim();
    const text = String(req.body?.text || '').trim();
    if (!label || !text) return res.status(400).json({ error: 'label and text are required' });

    const templates = readQuickReplies();
    const id = Date.now().toString(36);
    templates.push({ id, label, text });
    writeQuickReplies(templates);
    res.json({ id, label, text });
});

app.delete('/api/quick-replies/:id', (req, res) => {
    const { id } = req.params;
    const templates = readQuickReplies();
    const next = templates.filter((t) => t.id !== id);
    if (next.length === templates.length) {
        return res.status(404).json({ error: 'Template not found' });
    }
    writeQuickReplies(next);
    res.json({ success: true });
});

app.put('/api/quick-replies', (req, res) => {
    const templates = req.body;
    if (!Array.isArray(templates)) return res.status(400).json({ error: 'Array required' });
    const valid = templates.filter((t) => t && typeof t.id === 'string' && t.label && t.text);
    writeQuickReplies(valid);
    res.json(valid);
});

// ── Plugin hot-reload manual trigger ─────────────────────────────────────────

app.get('/api/plugins/reload', (req, res) => {
    try {
        const { reloadAllPlugins } = require('./handler');
        reloadAllPlugins();
        res.json({ success: true, message: 'All plugins reloaded' });
    } catch (err) {
        res.status(500).json({ error: err.message });
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

app.get('/api/local-commit-activity', (req, res) => {
    const weeksRaw = Number(req.query.weeks || 12);
    const weeks = Number.isFinite(weeksRaw) ? Math.min(Math.max(weeksRaw, 1), 52) : 12;
    const sinceDate = new Date(Date.now() - weeks * 7 * 24 * 60 * 60 * 1000);
    const sinceIso = sinceDate.toISOString();

    execFile(
        'git',
        ['log', '--since', sinceIso, '--pretty=format:%cI'],
        { cwd: __dirname, timeout: 12000 },
        (err, stdout) => {
            if (err) return res.status(500).json({ error: 'Failed to read local git activity' });
            const lines = String(stdout || '')
                .split('\n')
                .map((s) => s.trim())
                .filter(Boolean);
            res.json({ commits: lines });
        },
    );
});

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
                } catch {
                    /* ignore */
                }
            },
            25 * 60 * 1000,
        ); // every 25 minutes

        logMessage('INFO', `Heroku keep-alive enabled: ${pingUrl}`);
    }

    // ── Auto-index faces on new media files ─────────────────────────────────
    // Watch the data/ directory and trigger incremental face indexing whenever
    // a supported media file is written (e.g. by TikTok plugin or upload endpoint).
    const chokidar = require('chokidar');
    const mediaWatcher = chokidar.watch(MEDIA_DATA_DIR, {
        ignoreInitial: true,
        ignored: /(^|[/\\])\../, // skip dot-dirs (face models, thumbs, etc.)
        persistent: true,
        awaitWriteFinish: { stabilityThreshold: 1500, pollInterval: 200 },
    });
    mediaWatcher.on('add', (filepath) => {
        const ext = path.extname(filepath).toLowerCase();
        if (!MEDIA_EXTS.has(ext)) return;
        const rel = path.relative(MEDIA_DATA_DIR, filepath).replace(/\\/g, '/');
        const url = `/media-files/${rel}`;
        const type = MEDIA_EXTS.get(ext);
        facesBuildIndex([{ url, type }]).catch(() => {});
    });
    logMessage('INFO', 'Watching data/ for new media to auto-index faces.');
});

// ✅ Error handling
process.on('uncaughtException', (err) => {
    try {
        logMessage('CRITICAL', `Uncaught Exception: ${err.stack || err.message}`);
    } catch {}
    scheduleReconnect(5000);
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

        clearReconnectTimer();
        flushRuntimeCaches();

        closeSocket(currentSock || global.sock);
        currentSock = null;
        global.sock = null;

        logMessage('INFO', 'Clean shutdown complete.');
        process.exit(0);
    } catch (e) {
        logMessage('ERROR', `Shutdown error: ${e.message}`);
        process.exit(1);
    }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('unhandledRejection', (reason, _promise) => {
    try {
        logMessage('WARN', `Unhandled Rejection: ${reason}`);
    } catch {}
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
        const rows = renderStartupBanner();
        logMessage('INFO', `\x1b[36m\n${rows.join('\n')}\x1b[0m`);
        logMessage('INFO', `Booting ${getDisplayBotName()} runtime...`);
        validateEnv();

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
        scheduleReconnect(5000);
    }
})();
