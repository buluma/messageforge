// Extracted WhatsApp Connection Module
const { File: BufferFile } = require('node:buffer');
if (!global.File) global.File = BufferFile;

const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');
const P = require('pino');
const NodeCache = require('node-cache');
const config = require('../../config');
const {
    handleMessages,
    groupCache,
    plugins: handlerPlugins,
    getCommandCollisions,
} = require('../../handler');
const metrics = require('../../lib/metrics');
const { handleStatusBroadcast } = require('../statusManager');
const { connectDB, getPgPool } = require('../database');
const { usePostgresAuthState } = require('../baileysPostgresAuth');
const { makeMessageCache, makeGetMessage, bindAntiDelete } = require('../antiDelete');
const { createStatusSaver } = require('../statusRoutes');
const {
    downloadMediaBuffer,
    enqueueAntiViewOnceJob,
    findViewOnceMedia,
    normalizeOwnerJid,
    sendRevealedMedia,
} = require('../viewonce');
const messengerStore = require('../messengerStore');


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

if (typeof global.antivvEnabled === 'undefined') global.antivvEnabled = config.ANTIVV !== false;
const store = makeInMemoryStore({ logger: P({ level: 'silent' }) });

// Tracks whether a pairing code has been successfully requested, persisted across reconnections.
let _pairingRequested = false;
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
            metrics.inc('sendGuardThrottled');
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
const DASHBOARD_ROOM = 'dashboard-authenticated';

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

    const { getTimestamp, info, warn, error, success, custom } = require('../logger');
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
    if (process.env.NODE_ENV === 'production' && !dashboardToken) {
        logMessage(
            'ERROR',
            'NODE_ENV=production requires DASHBOARD_TOKEN. Set a strong token or use NODE_ENV=development for local runs.',
        );
        process.exit(1);
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
    let pairingRequested = _pairingRequested;

    // Use the session directory for multi-file auth state
    const { state, saveCreds } = await getBaileysAuthState();
    // Persist creds immediately so identity survives reconnections.
    // Without this, creds.update never fires for unregistered sockets,
    // the creds file never gets created, and every reconnect generates
    // a new keypair — invalidating any QR the user might have scanned.
    // This call ensures the file exists before the first QR is emitted.
    try {
        // saveCreds is a no-arg async function that writes state.creds to disk
        await saveCreds();
        logMessage('INFO', 'Initial creds persisted to disk.');
    } catch (e) {
        logMessage('WARN', `Failed to persist initial creds: ${e.message}`);
    }
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

        if (
            qr &&
            config.PAIRING_CODE &&
            !pairingRequested &&
            !sock?.authState?.creds?.registered
        ) {
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
                logMessage('WARN', 'PAIRING_CODE=true but PAIRING_NUMBER is empty; falling back to QR.');
            }
        }

        // Handle QR code — display in terminal and emit to dashboard
        if (qr) {
            console.log('[QR] received, length:', qr.length);
            try {
                const QRCode = require('qrcode');
                logMessage('INFO', '📱 SCAN THIS QR CODE WITH YOUR WHATSAPP:');
                const asciiQR = await QRCode.toString(qr, { type: 'terminal', small: true });
                console.log(asciiQR);
                // Generate data URL first, then store — prevents race where
                // /api/qr returns the raw string (which won't display as an image).
                const qrDataUrl = await QRCode.toDataURL(qr, { width: 300, margin: 2 });
                global._pendingQR = { qr: qrDataUrl, raw: qr };
                emitDashboard('qr', global._pendingQR);
                console.log('[QR] data URL ready, length:', qr.length);
            } catch (e) {
                console.log('[QR] handler error:', e.message);
        }
        if (connection === 'close') {
            closeSocket(sock);
            seenCleanupTimer = null;
            if (currentSock === sock) {
                currentSock = null;
            }
            if (global.sock === sock) global.sock = null;
            // Clear pending QR — it's tied to the old socket's ephemeral keypair
            global._pendingQR = null;
            emitDashboard('qr', null);
            logMessage(
                'WARN',
                `Connection closed: ${lastDisconnect?.error?.output?.statusCode || 'Unknown'}`,
            );
            const _registered = sock?.authState?.creds?.registered;
            if (
                lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut ||
                !_registered
            ) {
                const isUnregistered = !_registered;
                // Check creds file directly to see if we're waiting for a pairing code
                let credsHasPairingCode = false;
                let savedPairingCode = null;
                try {
                    const credsRaw = fs.readFileSync(credsPath, 'utf8');
                    const creds = JSON.parse(credsRaw);
                    savedPairingCode = creds.pairingCode;
                    credsHasPairingCode = !!savedPairingCode && !creds.registered;
                } catch {}
                if (isUnregistered && credsHasPairingCode) {
                    // The pairing code was saved but the companion handshake never
                    // completed (401 before server responded). The code only exists
                    // locally — WhatsApp has no pending pairing for it.
                    // Clear the stale creds so the next attempt uses QR (register)
                    // instead of trying to login and failing.
                    logMessage('WARN', `Stale pairing code ${savedPairingCode} never registered on WhatsApp.`);
                    logMessage('INFO', 'Clearing stale pairing state and retrying with QR...');
                    try {
                        const raw = fs.readFileSync(credsPath, 'utf8');
                        const c = JSON.parse(raw);
                        delete c.pairingCode;
                        delete c.me;
                        c.registered = false;
                        fs.writeFileSync(credsPath, JSON.stringify(c, null, 2));
                        logMessage('INFO', 'Stale creds cleared.');
                    } catch (e) {
                        logMessage('WARN', `Failed to clear creds: ${e.message}`);
                    }
                    scheduleReconnect(2_000);
                } else {
                    logMessage('INFO', 'Reconnecting...');
                    scheduleReconnect(isUnregistered ? 10_000 : 2_000);
                }
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

module.exports = {
    connectToWhatsApp,
    scheduleReconnect,
    closeSocket,
    store,
    msgRetryCounterCache
};
