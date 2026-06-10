'use strict';

function getCommand(ctx) {
    return String(ctx?.command || '')
        .trim()
        .toLowerCase();
}

function getCommandRaw(ctx) {
    return String(ctx?.command || '').trim();
}

module.exports = {
    getCommand,
    getCommandRaw,
};
