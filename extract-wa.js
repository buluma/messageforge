const fs = require('fs');

const content = fs.readFileSync('messageforge.js', 'utf8').split('\n');

const baileysStart = 22;
const storeEnd = 67; // makeInMemoryStore

const waLogicStart = 113; // if (typeof global.antivvEnabled ...
let waLogicEnd = 0;
for (let i = waLogicStart; i < content.length; i++) {
    if (content[i].includes('// ✅ Express Web API')) {
        waLogicEnd = i - 1; // Just before this comment
        break;
    }
}

// Extract Baileys + store
const baileysLines = content.slice(baileysStart, storeEnd + 1);
const waLogicLines = content.slice(waLogicStart, waLogicEnd);

const connectionHeader = `// Extracted WhatsApp Connection Module
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
const { logMessage } = require('../logger') || { logMessage: console.log };

// Provide a mock emitDashboard if it relies on global.io
function emitDashboard(event, payload) {
    if (!global.io) return;
    global.io.to('dashboard-authenticated').emit(event, payload);
}

`;

const connectionExports = `
module.exports = {
    connectToWhatsApp,
    scheduleReconnect,
    closeSocket,
    store,
    msgRetryCounterCache
};
`;

const connectionContent = [
    connectionHeader,
    ...baileysLines,
    ...waLogicLines,
    connectionExports
].join('\n');

fs.mkdirSync('lib/whatsapp', { recursive: true });
fs.writeFileSync('lib/whatsapp/connection.js', connectionContent);

// Now remove the extracted lines from messageforge.js
const newContent = [
    ...content.slice(0, baileysStart),
    ...content.slice(storeEnd + 1, waLogicStart),
    '// ── WhatsApp Connection ───────────────────────────────────────────────────',
    'const { connectToWhatsApp, scheduleReconnect, store } = require(\'./lib/whatsapp/connection\');',
    ...content.slice(waLogicEnd)
].join('\n');

fs.writeFileSync('messageforge.js', newContent);
console.log('WhatsApp connection extracted to lib/whatsapp/connection.js');
