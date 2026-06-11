const path = require('path');
const config = require('../../config');
const { plugins: handlerPlugins, getCommandCollisions } = require('../../handler');
const { dashboardToken } = require('../http/dashboardAuth');
const { dirSizeBytes } = require('./utils');
const { getMetrics } = require('../metrics');

module.exports = function opsRoutes(app, { getSock }) {
    app.get('/api/ops/health', (req, res) => {
        const memory = process.memoryUsage();
        const dataDir = path.join(__dirname, '..', '..', 'data');
        const logsDir = path.join(__dirname, '..', '..', 'logs');
        const sessionDir = path.join(__dirname, '..', '..', 'session');
        const sock = getSock();

        res.json({
            status: sock ? 'ok' : 'degraded',
            time: new Date().toISOString(),
            uptimeSeconds: Math.floor(process.uptime()),
            node: process.version,
            bot: {
                name: config.BOT_NAME,
                socketReady: !!sock,
                user: sock?.user?.id || null,
            },
            counts: {
                plugins: handlerPlugins.length,
                commandCollisions: getCommandCollisions(handlerPlugins).length,
                bannedUsers: global.bannedUsers?.size || 0,
                autoReplySchedules: Object.keys(global.autoReplySchedules || {}).length,
            },
            metrics: getMetrics(),
            integrations: {
                telegramAutoSend: process.env.TELEGRAM_AUTO_SEND === 'true',
                telegramConfigured:
                    !!process.env.TELEGRAM_BOT_TOKEN && !!process.env.TELEGRAM_CHAT_ID,
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

    app.get('/health', (req, res) =>
        res.json({ status: 'ok', bot: config.BOT_NAME, time: new Date().toISOString() }),
    );

    app.get('/ping', (req, res) => res.send('pong'));
};
