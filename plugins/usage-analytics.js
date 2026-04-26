'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../config');

const DATA_FILE = path.join(__dirname, '..', 'data', 'usage-analytics.json');
const MAX_FAILURES = 200;
const MAX_ERROR_LEN = 160;
const DEFAULT_ALERTING = Object.freeze({
    enabled: true,
    thresholdCount: 5,
    windowMinutes: 10,
    cooldownMinutes: 15,
    ownerJid: '',
});
const alertCooldown = new Map();

function nowIso() {
    return new Date().toISOString();
}

function normalizeAlerting(input = {}) {
    const thresholdCount = Math.min(
        Math.max(parseInt(input.thresholdCount, 10) || DEFAULT_ALERTING.thresholdCount, 1),
        100,
    );
    const windowMinutes = Math.min(
        Math.max(parseInt(input.windowMinutes, 10) || DEFAULT_ALERTING.windowMinutes, 1),
        1440,
    );
    const cooldownMinutes = Math.min(
        Math.max(parseInt(input.cooldownMinutes, 10) || DEFAULT_ALERTING.cooldownMinutes, 1),
        1440,
    );
    const ownerJid = typeof input.ownerJid === 'string' ? input.ownerJid.trim().toLowerCase() : '';

    return {
        enabled: input.enabled !== false,
        thresholdCount,
        windowMinutes,
        cooldownMinutes,
        ownerJid,
    };
}

function createEmptyData() {
    const ts = nowIso();
    return {
        version: 1,
        createdAt: ts,
        updatedAt: ts,
        totals: {
            commands: 0,
            success: 0,
            failure: 0,
        },
        commands: {},
        plugins: {},
        groups: {},
        failures: [],
        alerting: normalizeAlerting(),
    };
}

function loadData() {
    try {
        const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        if (!parsed || typeof parsed !== 'object') return createEmptyData();
        if (!parsed.totals) parsed.totals = { commands: 0, success: 0, failure: 0 };
        if (!parsed.commands) parsed.commands = {};
        if (!parsed.plugins) parsed.plugins = {};
        if (!parsed.groups) parsed.groups = {};
        if (!Array.isArray(parsed.failures)) parsed.failures = [];
        parsed.alerting = normalizeAlerting(parsed.alerting);
        if (!parsed.createdAt) parsed.createdAt = nowIso();
        if (!parsed.updatedAt) parsed.updatedAt = parsed.createdAt;
        return parsed;
    } catch {
        return createEmptyData();
    }
}

let analytics = loadData();
let saveTimer = null;

function flushData() {
    try {
        fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
        fs.writeFileSync(DATA_FILE, JSON.stringify(analytics, null, 2), 'utf8');
    } catch (err) {
        console.error(`[UsageAnalytics] save failed: ${err.message}`);
    }
}

function scheduleSave() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
        saveTimer = null;
        flushData();
    }, 1000);
}

function cleanError(err) {
    if (!err) return 'unknown error';
    return String(err).replace(/\s+/g, ' ').trim().slice(0, MAX_ERROR_LEN);
}

function fmtDate(input) {
    const d = new Date(input);
    return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleString();
}

function toPct(part, whole) {
    if (!whole) return '0.0';
    return ((part / whole) * 100).toFixed(1);
}

function getTopEntries(record, limit) {
    return Object.entries(record || {})
        .sort((a, b) => (b[1] || 0) - (a[1] || 0))
        .slice(0, limit);
}

function shortJid(jid) {
    if (!jid) return 'unknown';
    if (!jid.includes('@')) return jid;
    const [left, right] = jid.split('@');
    if (!left) return jid;
    if (left.length <= 8) return jid;
    return `${left.slice(0, 4)}...${left.slice(-3)}@${right}`;
}

function pluginLabel(pluginKey) {
    if (!pluginKey) return 'unknown';
    if (pluginKey === 'unknown') return 'unknown';
    return pluginKey.endsWith('.js') ? pluginKey : `${pluginKey}.js`;
}

function findPluginKey(query) {
    const q = String(query || '')
        .trim()
        .toLowerCase();
    if (!q) return { key: null, matches: [] };

    if (analytics.plugins[q]) return { key: q, matches: [] };
    if (!q.endsWith('.js') && analytics.plugins[`${q}.js`]) {
        return { key: `${q}.js`, matches: [] };
    }

    const matches = Object.keys(analytics.plugins).filter((k) => k.includes(q));
    if (matches.length === 1) return { key: matches[0], matches: [] };
    return { key: null, matches };
}

function resolveOwnerJid(settings) {
    if (settings?.ownerJid) return settings.ownerJid;
    const ownerRaw =
        (process.env.OWNER_NUMBER || '').trim() ||
        (typeof config.OWNER_NUMBER === 'string' ? config.OWNER_NUMBER.trim() : '') ||
        global.botNum ||
        '';
    const digits = ownerRaw.replace(/\D/g, '');
    if (!digits) return null;
    return `${digits}@s.whatsapp.net`;
}

function recordExecution(event) {
    const cmd = String(event?.command || '')
        .trim()
        .toLowerCase();
    if (!cmd) return;

    const ts = event.timestamp || nowIso();
    const success = !!event.success;
    const durationMs = Number.isFinite(event.durationMs)
        ? Math.max(0, Math.round(event.durationMs))
        : 0;
    const pluginKey = String(event?.pluginFile || event?.plugin || 'unknown')
        .trim()
        .toLowerCase();
    const plugin = pluginLabel(pluginKey);
    const errorText = cleanError(event?.error);
    const jid = event.jid || '';
    const isGroup = !!event.isGroup;
    const actor = event.from || '';

    analytics.totals.commands += 1;
    if (success) analytics.totals.success += 1;
    else analytics.totals.failure += 1;

    if (!analytics.commands[cmd]) {
        analytics.commands[cmd] = {
            count: 0,
            success: 0,
            failure: 0,
            totalMs: 0,
            lastUsedAt: null,
            byGroup: {},
        };
    }
    const cmdRec = analytics.commands[cmd];
    cmdRec.count += 1;
    cmdRec.totalMs += durationMs;
    cmdRec.lastUsedAt = ts;
    if (success) cmdRec.success += 1;
    else cmdRec.failure += 1;

    if (!analytics.plugins[pluginKey]) {
        analytics.plugins[pluginKey] = {
            count: 0,
            success: 0,
            failure: 0,
            totalMs: 0,
            lastUsedAt: null,
            commands: {},
            byGroup: {},
        };
    }
    const pluginRec = analytics.plugins[pluginKey];
    pluginRec.count += 1;
    pluginRec.totalMs += durationMs;
    pluginRec.lastUsedAt = ts;
    pluginRec.commands[cmd] = (pluginRec.commands[cmd] || 0) + 1;
    if (success) pluginRec.success += 1;
    else pluginRec.failure += 1;

    if (isGroup && jid) {
        if (!analytics.groups[jid]) {
            analytics.groups[jid] = {
                count: 0,
                success: 0,
                failure: 0,
                lastUsedAt: null,
                commands: {},
            };
        }
        const groupRec = analytics.groups[jid];
        groupRec.count += 1;
        groupRec.lastUsedAt = ts;
        if (success) groupRec.success += 1;
        else groupRec.failure += 1;
        groupRec.commands[cmd] = (groupRec.commands[cmd] || 0) + 1;
        cmdRec.byGroup[jid] = (cmdRec.byGroup[jid] || 0) + 1;
        pluginRec.byGroup[jid] = (pluginRec.byGroup[jid] || 0) + 1;
    }

    if (!success) {
        analytics.failures.unshift({
            ts,
            command: cmd,
            plugin,
            jid,
            from: actor,
            error: errorText,
        });
        if (analytics.failures.length > MAX_FAILURES) {
            analytics.failures.length = MAX_FAILURES;
        }
    }

    analytics.updatedAt = ts;
    scheduleSave();
    return {
        ts,
        success,
        command: cmd,
        plugin,
        jid,
        error: errorText,
    };
}

async function maybeSendFailureAlert(event, rec) {
    if (!rec || rec.success) return;

    const settings = analytics.alerting || normalizeAlerting();
    if (!settings.enabled) return;

    const sock = event?.sock;
    if (!sock?.sendMessage) return;

    const ownerJid = resolveOwnerJid(settings);
    if (!ownerJid) return;

    const nowMs = Date.now();
    const windowMs = settings.windowMinutes * 60 * 1000;
    const cooldownMs = settings.cooldownMinutes * 60 * 1000;
    const key = `${rec.command}|${rec.plugin}`;

    const recent = analytics.failures.filter((f) => {
        if (f.command !== rec.command) return false;
        if ((f.plugin || 'unknown') !== rec.plugin) return false;
        const ts = new Date(f.ts).getTime();
        return Number.isFinite(ts) && nowMs - ts <= windowMs;
    });

    if (recent.length < settings.thresholdCount) return;

    const lastAlertAt = alertCooldown.get(key) || 0;
    if (nowMs - lastAlertAt < cooldownMs) return;

    const groupSet = new Set();
    let privateCount = 0;
    for (const item of recent) {
        if (typeof item.jid === 'string' && item.jid.endsWith('@g.us')) groupSet.add(item.jid);
        else privateCount += 1;
    }

    const groups = [...groupSet];
    const groupPreview = groups.length
        ? groups
              .slice(0, 8)
              .map((g) => `• ${shortJid(g)}`)
              .join('\n')
        : '• none';

    const text =
        '🚨 *Command Failure Alert*\n\n' +
        `Command: .${rec.command}\n` +
        `Plugin: ${rec.plugin}\n` +
        `Failures: ${recent.length} in ${settings.windowMinutes}m (threshold ${settings.thresholdCount})\n` +
        `Latest error: ${rec.error}\n` +
        `Unique groups affected: ${groups.length}\n` +
        `Private failures: ${privateCount}\n` +
        `Cooldown: ${settings.cooldownMinutes}m per command+plugin\n` +
        `Time: ${fmtDate(nowMs)}\n\n` +
        '*Affected groups:*\n' +
        groupPreview +
        '\n\nUse `.usage failures 20` for details.';

    try {
        await sock.sendMessage(ownerJid, { text });
        alertCooldown.set(key, nowMs);
    } catch (err) {
        console.error(`[UsageAnalytics] alert send failed: ${err.message}`);
    }
}

function formatTopCommands(limit) {
    return Object.entries(analytics.commands)
        .sort((a, b) => (b[1]?.count || 0) - (a[1]?.count || 0))
        .slice(0, limit)
        .map(([cmd, rec], i) => {
            const avgMs = rec.count ? Math.round(rec.totalMs / rec.count) : 0;
            return `${i + 1}. .${cmd} — ${rec.count} uses, ${rec.failure} fails, ~${avgMs}ms`;
        });
}

function formatTopGroups(limit) {
    return Object.entries(analytics.groups)
        .sort((a, b) => (b[1]?.count || 0) - (a[1]?.count || 0))
        .slice(0, limit)
        .map(([jid, rec], i) => {
            const distinct = Object.keys(rec.commands || {}).length;
            return `${i + 1}. ${shortJid(jid)} — ${rec.count} cmds, ${distinct} commands`;
        });
}

function formatTopPlugins(limit) {
    return Object.entries(analytics.plugins)
        .sort((a, b) => (b[1]?.count || 0) - (a[1]?.count || 0))
        .slice(0, limit)
        .map(([pluginKey, rec], i) => {
            const avgMs = rec.count ? Math.round(rec.totalMs / rec.count) : 0;
            return `${i + 1}. ${pluginLabel(pluginKey)} — ${rec.count} uses, ${rec.failure} fails, ~${avgMs}ms`;
        });
}

module.exports = {
    commands: ['usage', 'usagestats', 'usagegroup'],
    description: 'Command usage analytics (owner only)',
    usage: '.usage summary | .usage plugins 10 | .usage alerts status',
    permission: 'owner',
    group: true,
    private: true,

    onCommandExecuted: async (event) => {
        const rec = recordExecution(event);
        await maybeSendFailureAlert(event, rec);
    },

    run: async (sock, message, args, ctx) => {
        const { jid, contextInfo, isGroup } = ctx;
        const sub = (args[0] || 'summary').toLowerCase();
        const send = (text) => sock.sendMessage(jid, { text, contextInfo }, { quoted: message });

        if (sub === 'help') {
            return send(
                '*Usage Analytics*\n\n' +
                    '1. `.usage summary` — overall stats\n' +
                    '2. `.usage top [limit]` — top commands\n' +
                    '3. `.usage plugins [limit]` — top plugins\n' +
                    '4. `.usage plugin <name>` — plugin details\n' +
                    '5. `.usage alerts status` — failure alert settings\n' +
                    '6. `.usage alerts on|off`\n' +
                    '7. `.usage alerts threshold <fails> <minutes>`\n' +
                    '8. `.usage alerts cooldown <minutes>`\n' +
                    '9. `.usage alerts owner <number|jid|reset>`\n' +
                    '10. `.usage group [jid]` — one group stats\n' +
                    '11. `.usage command <name>` — command details\n' +
                    '12. `.usage failures [limit]` — recent command failures\n' +
                    '13. `.usage reset confirm` — clear all analytics data',
            );
        }

        if (sub === 'alerts') {
            const action = (args[1] || 'status').toLowerCase();
            const current = analytics.alerting || normalizeAlerting();
            const updateAndSave = () => {
                analytics.alerting = normalizeAlerting(current);
                analytics.updatedAt = nowIso();
                scheduleSave();
            };

            if (action === 'status' || action === 'show') {
                const ownerTarget = current.ownerJid || 'auto from OWNER_NUMBER';
                return send(
                    '🚨 *Failure Alert Settings*\n\n' +
                        `Enabled: ${current.enabled ? 'ON' : 'OFF'}\n` +
                        `Threshold: ${current.thresholdCount} failures / ${current.windowMinutes} minutes\n` +
                        `Cooldown: ${current.cooldownMinutes} minutes per command+plugin\n` +
                        `Owner target: ${ownerTarget}\n\n` +
                        'Examples:\n' +
                        '• `.usage alerts on`\n' +
                        '• `.usage alerts threshold 5 10`\n' +
                        '• `.usage alerts cooldown 15`\n' +
                        '• `.usage alerts owner 2547XXXXXXXX`',
                );
            }

            if (action === 'on') {
                current.enabled = true;
                updateAndSave();
                return send('✅ Failure alerts enabled.');
            }

            if (action === 'off') {
                current.enabled = false;
                updateAndSave();
                return send('✅ Failure alerts disabled.');
            }

            if (action === 'threshold') {
                const failures = parseInt(args[2], 10);
                const minutes = parseInt(args[3], 10);
                if (!Number.isFinite(failures) || !Number.isFinite(minutes)) {
                    return send('Usage: `.usage alerts threshold <failures> <minutes>`');
                }
                current.thresholdCount = failures;
                current.windowMinutes = minutes;
                updateAndSave();
                return send(
                    `✅ Alert threshold set to ${current.thresholdCount} failures in ${current.windowMinutes} minutes.`,
                );
            }

            if (action === 'cooldown') {
                const minutes = parseInt(args[2], 10);
                if (!Number.isFinite(minutes)) {
                    return send('Usage: `.usage alerts cooldown <minutes>`');
                }
                current.cooldownMinutes = minutes;
                updateAndSave();
                return send(`✅ Alert cooldown set to ${current.cooldownMinutes} minutes.`);
            }

            if (action === 'owner') {
                const raw = (args[2] || '').trim().toLowerCase();
                if (!raw) return send('Usage: `.usage alerts owner <number|jid|reset>`');

                if (['reset', 'default', 'clear'].includes(raw)) {
                    current.ownerJid = '';
                    updateAndSave();
                    return send('✅ Alert owner target reset to OWNER_NUMBER.');
                }

                if (raw.includes('@')) {
                    current.ownerJid = raw;
                    updateAndSave();
                    return send(`✅ Alert owner target set to ${raw}`);
                }

                const digits = raw.replace(/\D/g, '');
                if (digits.length < 6) return send('❌ Invalid owner number.');
                current.ownerJid = `${digits}@s.whatsapp.net`;
                updateAndSave();
                return send(`✅ Alert owner target set to +${digits}`);
            }

            if (action === 'test') {
                const ownerJid = resolveOwnerJid(current);
                if (!ownerJid) return send('❌ No owner target configured.');
                try {
                    await sock.sendMessage(ownerJid, {
                        text:
                            '🧪 *Failure Alert Test*\n\n' +
                            'This is a test alert from usage analytics.\n' +
                            `Time: ${fmtDate(Date.now())}`,
                    });
                    return send('✅ Test alert sent.');
                } catch (err) {
                    return send(`❌ Failed to send test alert: ${err.message}`);
                }
            }

            return send('Unknown alerts option. Use `.usage help`.');
        }

        if (sub === 'summary') {
            const total = analytics.totals.commands || 0;
            const success = analytics.totals.success || 0;
            const failure = analytics.totals.failure || 0;
            const cmdCount = Object.keys(analytics.commands).length;
            const pluginCount = Object.keys(analytics.plugins).length;
            const groupCount = Object.keys(analytics.groups).length;
            const alerting = analytics.alerting || normalizeAlerting();
            const topCommands = formatTopCommands(8);
            const topPlugins = formatTopPlugins(6);
            const topGroups = formatTopGroups(5);

            return send(
                '📊 *Usage Analytics Summary*\n\n' +
                    `Total commands: ${total}\n` +
                    `Success: ${success} (${toPct(success, total)}%)\n` +
                    `Failures: ${failure} (${toPct(failure, total)}%)\n` +
                    `Tracked commands: ${cmdCount}\n` +
                    `Tracked plugins: ${pluginCount}\n` +
                    `Active groups: ${groupCount}\n` +
                    `Alerts: ${alerting.enabled ? 'ON' : 'OFF'} (${alerting.thresholdCount}/${alerting.windowMinutes}m, cooldown ${alerting.cooldownMinutes}m)\n` +
                    `Updated: ${fmtDate(analytics.updatedAt)}\n\n` +
                    '*Top commands:*\n' +
                    (topCommands.length ? topCommands.join('\n') : 'No data yet.') +
                    '\n\n*Top plugins:*\n' +
                    (topPlugins.length ? topPlugins.join('\n') : 'No plugin data yet.') +
                    '\n\n*Top groups:*\n' +
                    (topGroups.length ? topGroups.join('\n') : 'No group data yet.'),
            );
        }

        if (sub === 'top') {
            const limit = Math.min(Math.max(parseInt(args[1], 10) || 15, 1), 50);
            const lines = formatTopCommands(limit);
            return send(
                `📈 *Top Commands* (max ${limit})\n\n` +
                    (lines.length ? lines.join('\n') : 'No command usage recorded yet.'),
            );
        }

        if (sub === 'plugins' || sub === 'ptop') {
            const limit = Math.min(Math.max(parseInt(args[1], 10) || 15, 1), 50);
            const lines = formatTopPlugins(limit);
            return send(
                `🧱 *Top Plugins* (max ${limit})\n\n` +
                    (lines.length ? lines.join('\n') : 'No plugin usage recorded yet.'),
            );
        }

        if (sub === 'plugin') {
            const query = args.slice(1).join(' ');
            if (!query) return send('Usage: `.usage plugin <plugin_name>`');

            const resolved = findPluginKey(query);
            if (!resolved.key) {
                if (resolved.matches.length > 1) {
                    const preview = resolved.matches
                        .slice(0, 10)
                        .map((k, i) => `${i + 1}. ${pluginLabel(k)}`)
                        .join('\n');
                    return send(
                        `Multiple plugins matched:\n\n${preview}\n\nTry a more specific name.`,
                    );
                }
                return send(`No plugin analytics data for "${query}".`);
            }

            const rec = analytics.plugins[resolved.key];
            const avgMs = rec.count ? Math.round(rec.totalMs / rec.count) : 0;
            const groupCount = Object.keys(rec.byGroup || {}).length;
            const topCommands = getTopEntries(rec.commands || {}, 10).map(
                ([cmd, count], i) => `${i + 1}. .${cmd} — ${count}`,
            );
            const topGroups = getTopEntries(rec.byGroup || {}, 5).map(
                ([groupJid, count], i) => `${i + 1}. ${shortJid(groupJid)} — ${count}`,
            );

            return send(
                `🧱 *Plugin: ${pluginLabel(resolved.key)}*\n\n` +
                    `Uses: ${rec.count}\n` +
                    `Success: ${rec.success} (${toPct(rec.success, rec.count)}%)\n` +
                    `Failures: ${rec.failure} (${toPct(rec.failure, rec.count)}%)\n` +
                    `Avg runtime: ~${avgMs}ms\n` +
                    `Groups used in: ${groupCount}\n` +
                    `Distinct commands: ${Object.keys(rec.commands || {}).length}\n` +
                    `Last used: ${fmtDate(rec.lastUsedAt)}\n\n` +
                    '*Top commands in this plugin:*\n' +
                    (topCommands.length ? topCommands.join('\n') : 'No command data.') +
                    '\n\n*Top groups for this plugin:*\n' +
                    (topGroups.length ? topGroups.join('\n') : 'No group usage yet.'),
            );
        }

        if (sub === 'group') {
            const targetJid = args[1] || (isGroup ? jid : null);
            if (!targetJid) {
                return send('Usage: `.usage group <group_jid>` (or run this in a group)');
            }

            const group = analytics.groups[targetJid];
            if (!group) {
                return send(`No analytics data for ${targetJid}`);
            }

            const top = getTopEntries(group.commands, 10).map(
                ([cmd, count], i) => `${i + 1}. .${cmd} — ${count}`,
            );

            return send(
                `👥 *Group Usage: ${shortJid(targetJid)}*\n\n` +
                    `Commands: ${group.count}\n` +
                    `Success: ${group.success} (${toPct(group.success, group.count)}%)\n` +
                    `Failures: ${group.failure} (${toPct(group.failure, group.count)}%)\n` +
                    `Distinct commands: ${Object.keys(group.commands || {}).length}\n` +
                    `Last activity: ${fmtDate(group.lastUsedAt)}\n\n` +
                    '*Top group commands:*\n' +
                    (top.length ? top.join('\n') : 'No command data.'),
            );
        }

        if (sub === 'command' || sub === 'cmd') {
            const name = (args[1] || '').toLowerCase();
            if (!name) return send('Usage: `.usage command <command_name>`');

            const rec = analytics.commands[name];
            if (!rec) return send(`No analytics data for .${name}`);

            const groupCount = Object.keys(rec.byGroup || {}).length;
            const topGroups = getTopEntries(rec.byGroup || {}, 5).map(
                ([groupJid, count], i) => `${i + 1}. ${shortJid(groupJid)} — ${count}`,
            );
            const avgMs = rec.count ? Math.round(rec.totalMs / rec.count) : 0;

            return send(
                `🧩 *Command: .${name}*\n\n` +
                    `Uses: ${rec.count}\n` +
                    `Success: ${rec.success} (${toPct(rec.success, rec.count)}%)\n` +
                    `Failures: ${rec.failure} (${toPct(rec.failure, rec.count)}%)\n` +
                    `Avg runtime: ~${avgMs}ms\n` +
                    `Groups used in: ${groupCount}\n` +
                    `Last used: ${fmtDate(rec.lastUsedAt)}\n\n` +
                    '*Top groups for this command:*\n' +
                    (topGroups.length ? topGroups.join('\n') : 'No group usage yet.'),
            );
        }

        if (sub === 'failures') {
            const limit = Math.min(Math.max(parseInt(args[1], 10) || 10, 1), 50);
            const rows = analytics.failures.slice(0, limit).map((f, i) => {
                const scope = f.jid?.endsWith('@g.us') ? shortJid(f.jid) : 'private';
                return `${i + 1}. [${fmtDate(f.ts)}] .${f.command} [${f.plugin || 'unknown'}] (${scope})\n   ${f.error}`;
            });
            return send(
                `🚨 *Recent Failures* (max ${limit})\n\n` +
                    (rows.length ? rows.join('\n') : 'No failures recorded.'),
            );
        }

        if (sub === 'reset') {
            if ((args[1] || '').toLowerCase() !== 'confirm') {
                return send(
                    'This will wipe analytics data. Run `.usage reset confirm` to continue.',
                );
            }
            analytics = createEmptyData();
            if (saveTimer) {
                clearTimeout(saveTimer);
                saveTimer = null;
            }
            flushData();
            return send('✅ Usage analytics data reset.');
        }

        return send('Unknown option. Use `.usage help`.');
    },
};
