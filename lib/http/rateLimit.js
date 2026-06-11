const { requestIp } = require('./requestIp');

// ── API rate limiter (120 req/min per IP, /api/* only) ────────────────────────
const _apiRateLimitMap = new Map();
const _rateLimitExempt = new Set(['/api/media/thumb', '/api/media/face']);

function globalApiRateLimit(req, res, next) {
    const base = '/' + req.path.split('/').slice(1, 4).join('/');
    if (req.path.startsWith('/media/')) return next();
    if (_rateLimitExempt.has(base)) return next();

    const ip = requestIp(req);
    const now = Date.now();
    const window = 60 * 1000;
    const limit = 120;

    let entry = _apiRateLimitMap.get(ip);
    if (!entry || now >= entry.resetAt) {
        entry = { count: 0, resetAt: now + window };
        _apiRateLimitMap.set(ip, entry);
    }

    entry.count++;
    if (entry.count > limit) {
        return res.status(429).json({ error: 'Too many requests' });
    }
    next();
}

// ── Write-path rate limiter (10 req/min per IP on mutating endpoints) ─────────
const _writeRateLimitMap = new Map();
const _writeRateLimitPaths = new Set([
    '/send',
    '/send-media',
    '/delete-message',
    '/react',
    '/typing',
    '/toggle-pin',
    '/toggle-archive',
    '/read',
    '/control/autopilot',
    '/quick-replies',
    '/chat-alias',
]);

function writeRateLimit(req, res, next) {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();

    const isWritePath = Array.from(_writeRateLimitPaths).some(
        (p) => req.path === p || req.path.startsWith(p + '/'),
    );
    if (!isWritePath) return next();

    const ip = requestIp(req);
    const now = Date.now();
    const window = 60 * 1000;
    const limit = 10;

    let entry = _writeRateLimitMap.get(ip);
    if (!entry || now >= entry.resetAt) {
        entry = { count: 0, resetAt: now + window };
        _writeRateLimitMap.set(ip, entry);
    }

    entry.count++;
    if (entry.count > limit) {
        return res.status(429).json({ error: 'Too many write requests' });
    }
    next();
}

module.exports = {
    globalApiRateLimit,
    writeRateLimit,
};
