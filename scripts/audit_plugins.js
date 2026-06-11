#!/usr/bin/env node
'use strict';

// Lightweight plugin metadata audit.
//
// Goal: catch permission + scope combos that are almost certainly accidental,
// without forcing a big refactor or changing runtime behavior.
//
// Usage:
//   node scripts/audit_plugins.js
//
// Exit code:
//   0 = no findings
//   1 = findings (warnings or errors)

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const PLUGINS_DIR = path.join(REPO_ROOT, 'plugins');
const INTENTIONAL_PRIVATE_PUBLIC = new Set(['autoreply-scheduler.js', 'statussave.js']);

function boolToTri(v) {
    if (v === true) return 'true';
    if (v === false) return 'false';
    return 'unset';
}

function normalizePermission(p) {
    return String(p || 'public')
        .trim()
        .toLowerCase();
}

function main() {
    const files = fs
        .readdirSync(PLUGINS_DIR)
        .filter((f) => f.endsWith('.js'))
        .sort((a, b) => a.localeCompare(b));

    const findings = [];
    const loadErrors = [];

    for (const file of files) {
        const abs = path.join(PLUGINS_DIR, file);
        // Ensure we re-require each plugin with fresh file state.
        // Some plugins maintain globals; this audit only cares about exported metadata.
        try {
            delete require.cache[require.resolve(abs)];
        } catch {
            /* ignore */
        }
        let plugin;
        try {
            plugin = require(abs);
        } catch (err) {
            loadErrors.push({ file, err: err && err.message ? err.message : String(err) });
            continue;
        }

        if (!plugin || typeof plugin !== 'object') continue;

        const commands = Array.isArray(plugin.commands) ? plugin.commands : [];
        const primary = commands[0] || '(no commands)';

        const perm = normalizePermission(plugin.permission);
        const group = plugin.group;
        const priv = plugin.private;
        const botAdmin = !!plugin.botAdmin;

        const allowGroup = group !== false;
        const allowPrivate = priv !== false;

        // Heuristics:
        // - 'admin' permission is only meaningful in groups. In private chats, ctx.isAdmin is false,
        //   so 'admin' effectively becomes owner-only. That might be intentional, but usually it's accidental.
        if (perm === 'admin' && allowPrivate) {
            findings.push({
                severity: 'warn',
                file,
                primary,
                code: 'ADMIN_IN_PRIVATE',
                message:
                    "permission:'admin' but private chats are allowed. In DMs this behaves like owner-only; consider `private:false` or `permission:'owner'`.",
                meta: {
                    permission: perm,
                    group: boolToTri(group),
                    private: boolToTri(priv),
                    botAdmin: boolToTri(plugin.botAdmin),
                },
            });
        }

        // - botAdmin only makes sense in groups.
        if (botAdmin && allowPrivate) {
            findings.push({
                severity: 'warn',
                file,
                primary,
                code: 'BOT_ADMIN_IN_PRIVATE',
                message: 'botAdmin:true but private chats are allowed. Consider `private:false`.',
                meta: {
                    permission: perm,
                    group: boolToTri(group),
                    private: boolToTri(priv),
                    botAdmin: boolToTri(plugin.botAdmin),
                },
            });
        }

        // - group-only restriction on a public command is often surprising (but might be fine).
        if (
            perm === 'public' &&
            allowPrivate &&
            !allowGroup &&
            !INTENTIONAL_PRIVATE_PUBLIC.has(file)
        ) {
            findings.push({
                severity: 'warn',
                file,
                primary,
                code: 'PUBLIC_PRIVATE_ONLY',
                message:
                    "permission:'public' but group:false (private-only public command). Verify intent.",
                meta: {
                    permission: perm,
                    group: boolToTri(group),
                    private: boolToTri(priv),
                    botAdmin: boolToTri(plugin.botAdmin),
                },
            });
        }

        // - unknown permission string: handler treats it as public (to avoid lockouts), so flag.
        if (!['public', 'admin', 'owner'].includes(perm)) {
            findings.push({
                severity: 'error',
                file,
                primary,
                code: 'UNKNOWN_PERMISSION',
                message: `Unknown permission '${perm}'. Handler treats this as public; likely a bug.`,
                meta: {
                    permission: perm,
                    group: boolToTri(group),
                    private: boolToTri(priv),
                    botAdmin: boolToTri(plugin.botAdmin),
                },
            });
        }
    }

    if (loadErrors.length) {
        for (const e of loadErrors) {
            findings.push({
                severity: 'error',
                file: e.file,
                primary: '(load failed)',
                code: 'PLUGIN_LOAD_ERROR',
                message: `Failed to require plugin: ${e.err}`,
                meta: {},
            });
        }
    }

    if (!findings.length) {
        console.log('OK: no plugin hygiene findings.');
        process.exit(0);
    }

    console.log(`Found ${findings.length} plugin hygiene finding(s):\n`);
    for (const f of findings) {
        const head = `[${String(f.severity).toUpperCase()}] ${f.file} (${f.primary})`;
        console.log(head);
        console.log(`  ${f.code}: ${f.message}`);
        if (f.meta && Object.keys(f.meta).length) {
            console.log(
                `  meta: permission=${f.meta.permission} group=${f.meta.group} private=${f.meta.private} botAdmin=${f.meta.botAdmin}`,
            );
        }
        console.log('');
    }

    process.exit(1);
}

main();
