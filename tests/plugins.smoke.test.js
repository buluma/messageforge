'use strict';

const fs = require('fs');
const path = require('path');

// These are intentionally lightweight “shape” tests:
// - ensure every plugin file can be required without throwing
// - ensure each exports the expected plugin object shape
// We do not execute plugin run() functions here (they often hit network/media).

jest.mock('../config', () => ({
    PREFIX: '.',
    MODE: 'public',
    OWNER_NUMBER: '254712345678',
    AUTO_TYPING: false,
    AUTO_RECORDING: false,
    BOT_NUMBER: '',
    SUDO: '',
    THEME: 'messageforge',
    DATABASE_TYPE: 'local',
    STRICT_COMMAND_COLLISIONS: false,
}));

jest.mock('../lib/theme', () => ({
    fmt: (s) => s,
    getStr: jest.fn((key) => key),
    getActiveTheme: jest.fn(() => ({ global: {} })),
}));

jest.mock('../lib/logger', () => ({
    custom: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
}));

// Baileys ships as ESM; Jest cannot parse it when plugins pull it in at load time.
jest.mock('@whiskeysockets/baileys', () => ({
    downloadContentFromMessage: jest.fn(),
    jidNormalizedUser: jest.fn((jid) => jid),
}));

// jsdom 29+ pulls ESM-only deps that Jest cannot parse in this smoke harness.
jest.mock('jsdom', () => ({
    JSDOM: jest.fn(() => ({ window: { document: { querySelector: jest.fn() } } })),
}));

const pluginDir = path.join(__dirname, '..', 'plugins');
const allowlistPath = path.join(__dirname, '__fixtures__', 'plugin-export-allowlist.json');

function loadAllowlist() {
    try {
        if (!fs.existsSync(allowlistPath)) return new Set();
        const data = JSON.parse(fs.readFileSync(allowlistPath, 'utf8'));
        return new Set(Array.isArray(data) ? data : []);
    } catch {
        return new Set();
    }
}

function normalizeExport(mod) {
    if (!mod) return [];
    if (Array.isArray(mod)) return mod;
    if (Array.isArray(mod.default)) return mod.default;
    return [mod.default || mod];
}

function normalizePlugin(plugin) {
    if (!plugin) return plugin;
    if (!plugin.commands && plugin.name) plugin.commands = [plugin.name];
    if (!plugin.run && typeof plugin.handler === 'function') plugin.run = plugin.handler;
    return plugin;
}

function isValidPluginShape(plugin) {
    if (!plugin || typeof plugin.run !== 'function') return false;
    if (plugin.isEvent) return true;
    return Array.isArray(plugin.commands) && plugin.commands.length > 0;
}

function discoverPluginFiles() {
    return fs
        .readdirSync(pluginDir)
        .filter((name) => name.endsWith('.js'))
        .sort();
}

describe('plugins (smoke)', () => {
    const pluginFiles = discoverPluginFiles();
    const allowlist = loadAllowlist();

    test('discovers every plugins/*.js file', () => {
        expect(pluginFiles.length).toBeGreaterThan(0);
    });

    test.each(pluginFiles)('%s exports valid plugin objects', (filename) => {
        if (allowlist.has(filename)) return;

        const relPath = path.join('..', 'plugins', filename);
        let exp;
        try {
            exp = require(relPath);
        } catch (err) {
            throw new Error(`[${filename}] failed to require: ${err.message}`);
        }

        const pluginList = normalizeExport(exp);
        if (!pluginList.length) {
            throw new Error(`[${filename}] exported no plugin objects`);
        }

        for (const raw of pluginList) {
            const plugin = normalizePlugin(raw);
            if (!isValidPluginShape(plugin)) {
                throw new Error(
                    `[${filename}] invalid plugin shape — need (commands + run) or (isEvent + run)`,
                );
            }
            if (!plugin.isEvent) {
                expect(Array.isArray(plugin.commands)).toBe(true);
                expect(plugin.commands.length).toBeGreaterThan(0);
            }
            expect(typeof plugin.run).toBe('function');
        }
    });
});
