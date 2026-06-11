function isLocalAddress(ip = '') {
    const value = String(ip).trim();
    return (
        value === '::1' ||
        value === '127.0.0.1' ||
        value === '::ffff:127.0.0.1' ||
        value.startsWith('127.') ||
        value.toLowerCase().includes('localhost')
    );
}

function requestIp(req) {
    const fwd = String(req.headers['x-forwarded-for'] || '')
        .split(',')[0]
        .trim();
    return fwd || req.socket?.remoteAddress || '';
}

module.exports = {
    isLocalAddress,
    requestIp,
};
