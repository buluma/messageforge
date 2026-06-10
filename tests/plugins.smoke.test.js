'use strict';

// These are intentionally lightweight “shape” tests:
// - ensure common plugins can be required without throwing
// - ensure each exports the expected plugin object shape (commands + run)
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
    DATABASE_TYPE: 'json',
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

function normalizeExport(mod) {
    if (!mod) return [];
    if (Array.isArray(mod)) return mod;
    if (Array.isArray(mod.default)) return mod.default;
    return [mod.default || mod];
}

describe('plugins (smoke)', () => {
    const pluginRelPaths = [
        // Alive / status
        '../plugins/alive',
        '../plugins/afk',

        // Core moderation / protection
        '../plugins/antibot',
        '../plugins/antidelete',

        // AI
        '../plugins/messageforge-ai',

        // Group utilities
        '../plugins/groupinfo',

        // Search / info
        '../plugins/anime',

        // Downloaders
        '../plugins/ytmp3',

        // Analytics / persistence
        '../plugins/usage-analytics',
        '../plugins/group-analytics',
    ];

    test.each(pluginRelPaths)('%s exports valid plugin objects', (relPath) => {
        const exp = require(relPath);
        const pluginList = normalizeExport(exp);

        expect(pluginList.length).toBeGreaterThan(0);
        for (const plugin of pluginList) {
            expect(plugin).toBeTruthy();
            expect(Array.isArray(plugin.commands)).toBe(true);
            expect(plugin.commands.length).toBeGreaterThan(0);
            expect(typeof plugin.run).toBe('function');
        }
    });
});
