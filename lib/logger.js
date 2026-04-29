/**
 * Provides a standardized logging function with Nairobi/EAT timestamping.
 * Timezone: Africa/Nairobi (UTC+3)
 */
const getTimestamp = () => {
    return new Date().toLocaleString('en-KE', {
        timeZone: 'Africa/Nairobi',
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
};

const getShortTime = () => {
    return new Date().toLocaleString('en-KE', {
        timeZone: 'Africa/Nairobi',
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
};

const c = {
    reset: '\x1b[0m',
    gray: '\x1b[90m',
    cyan: '\x1b[36m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    magenta: '\x1b[35m',
    blue: '\x1b[34m',
    dimRed: '\x1b[2;31m',
};

const rainbowColors = [c.cyan, c.yellow, c.green, c.magenta, c.blue];

function getHashColor(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    return rainbowColors[Math.abs(hash) % rainbowColors.length];
}

const TAG_WIDTH = 1;

function formatTag(icon, name) {
    return `${icon}  ${name.padEnd(TAG_WIDTH, ' ')}`;
}

function extractError(msgOrErr) {
    if (msgOrErr instanceof Error) {
        const stack = msgOrErr.stack || msgOrErr.message;
        return `\n${c.dimRed}${stack}${c.reset}`;
    }
    return msgOrErr;
}

const logger = {
    info: (msg) => console.log(`${c.gray}[${getShortTime()}]${c.reset} ${c.cyan}${formatTag('ℹ️', 'INFO')}${c.reset} ${extractError(msg)}`),
    warn: (msg) => console.log(`${c.gray}[${getShortTime()}]${c.reset} ${c.yellow}${formatTag('⚠️', 'WARN')}${c.reset} ${extractError(msg)}`),
    error: (msg) => console.log(`${c.gray}[${getShortTime()}]${c.reset} ${c.red}${formatTag('❌', 'ERROR')}${c.reset} ${extractError(msg)}`),
    success: (msg) => console.log(`${c.gray}[${getShortTime()}]${c.reset} ${c.green}${formatTag('✅', 'SUCCESS')}${c.reset} ${extractError(msg)}`),
    custom: (tag, msg) => {
        const color = getHashColor(tag);
        console.log(`${c.gray}[${getShortTime()}]${c.reset} ${color}${formatTag('⚙️', tag)}${c.reset} ${extractError(msg)}`);
    },
    log: (msg) => console.log(`${c.gray}[${getShortTime()}]${c.reset} ${extractError(msg)}`),
};


module.exports = {
    ...logger,
    getTimestamp, // export for messageforge.js to use
};
