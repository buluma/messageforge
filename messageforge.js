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
const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib'); // Added for session decompression
const { execFile } = require('child_process');
const express = require('express');
const axios = require('axios');
const P = require('pino');
const NodeCache = require('node-cache');
const {
    handleMessages,
    groupCache,
    plugins: handlerPlugins,
    getCommandCollisions,
} = require('./handler');
const { handleStatusBroadcast } = require('./lib/statusManager');
const { connectDB, getPgPool } = require('./lib/database');
const { usePostgresAuthState } = require('./lib/baileysPostgresAuth');
const { createMediaRoutes, MEDIA_EXTS, scanMediaDir } = require('./lib/mediaRoutes');
const { makeMessageCache, makeGetMessage, bindAntiDelete } = require('./lib/antiDelete');
const { createStatusSaver } = require('./lib/statusRoutes');
const { createFaceRoutes } = require('./lib/faceRoutes');
const { buildIndex: facesBuildIndex } = require('./lib/faceIndexer');
const {
    downloadMediaBuffer,
    enqueueAntiViewOnceJob,
    findViewOnceMedia,
    normalizeOwnerJid,
    sendRevealedMedia,
} = require('./lib/viewonce');
const messengerStore = require('./lib/messengerStore');
const { requestIp, isLocalAddress } = require('./lib/http/requestIp');
const { requireDashboardAuth, dashboardToken } = require('./lib/http/dashboardAuth');
const { globalApiRateLimit, writeRateLimit } = require('./lib/http/rateLimit');
const { securityHeaders } = require('./lib/http/securityHeaders');
const config = require('./config.js');
const logger = require('./lib/logger');
const BRAND_NAME = 'MessageForge';
const BRAND_ICON = '◉';
const DASHBOARD_ROOM = 'dashboard-authenticated';
const MEDIA_DATA_DIR = path.join(__dirname, 'data');

function logMessage(type, message) {
    const typeStr = String(type).toUpperCase();
    if (typeStr === 'INFO') logger.info(message);
    else if (typeStr === 'WARN') logger.warn(message);
    else if (typeStr === 'ERROR' || typeStr === 'CRITICAL') logger.error(message);
    else if (typeStr === 'SUCCESS') logger.success(message);
    else logger.custom(typeStr, message);
}

function validateEnv() {
    if (!config.OWNER_NUMBER) {
        logMessage('WARN', 'OWNER_NUMBER is not set. Owner-only features will be unavailable.');
    }
    if (process.env.NODE_ENV === 'production' && !dashboardToken) {
        logMessage('ERROR', 'NODE_ENV=production requires DASHBOARD_TOKEN.');
        process.exit(1);
    }
    if (config.DATABASE_TYPE === 'postgres' && !config.POSTGRES_HOST) {
        logMessage('WARN', 'DATABASE_TYPE=postgres but POSTGRES_HOST is not set.');
    }
}

function getDisplayBotName() {
    const raw = String(config.BOT_NAME || '').trim();
    if (!raw) return BRAND_NAME;
    if (/messageforge|silva\s*md|shadownet/i.test(raw)) return BRAND_NAME;
    return raw;
}

// ── WhatsApp Connection ───────────────────────────────────────────────────
const {
    connectToWhatsApp,
    scheduleReconnect,
    closeSocket,
    store,
} = require('./lib/whatsapp/connection');

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
    // Send pending QR code if available (emitted before dashboard connected)
    if (global._pendingQR) {
        socket.emit('qr', global._pendingQR);
    }
});

app.use(express.json({ limit: '70mb' }));

// ── Security headers ──────────────────────────────────────────────────────────
app.use(securityHeaders);

// ── API rate limiter (120 req/min per IP, /api/* only) ────────────────────────
app.use('/api', globalApiRateLimit);

// ── Write-path rate limiter (10 req/min per IP on mutating endpoints) ─────────
app.use('/api', writeRateLimit);

// ── QR code endpoint (for WhatsApp pairing) ────────────────────────
app.get('/api/qr', (req, res) => {
    if (global._pendingQR) {
        res.json({ qr: global._pendingQR.qr, raw: global._pendingQR.raw });
    } else {
        res.status(404).json({ error: 'No QR code available yet' });
    }
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

// ── Mount Extracted Routes ───────────────────────────────────────────────
require('./lib/routes').mountAll(app, {
    store,
    getSock: () => global.sock,
    requireDashboardAuth,
    facesBuildIndex,
});

httpSrv.listen(config.PORT, () => {
    logMessage('INFO', `Server listening on port ${config.PORT}.`);
    logMessage('INFO', `Dashboard: http://localhost:${config.PORT}`);

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
        ignored: (filepath) => {
            const rel = path.relative(MEDIA_DATA_DIR, filepath).replace(/\\/g, '/');
            return (
                rel.startsWith('.thumbs/') ||
                rel.startsWith('.faces/') ||
                rel.startsWith('face-models/') ||
                rel.startsWith('messenger-history/')
            );
        },
        persistent: true,
        usePolling: true,
        interval: 2000,
        awaitWriteFinish: { stabilityThreshold: 1500, pollInterval: 500 },
    });
    mediaWatcher.on('error', (err) => {
        logMessage('WARN', `Media watcher disabled: ${err.message}`);
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

        closeSocket(global.sock);
        global.sock = null;
        global.whatsappConnected = false;

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

        await connectToWhatsApp();
    } catch (e) {
        logMessage('CRITICAL', `Bot Init Failed: ${e.stack || e.message}`);
        scheduleReconnect(5000);
    }
})();
