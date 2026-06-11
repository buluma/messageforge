const { requestIp, isLocalAddress } = require('./requestIp');

const dashboardToken = String(process.env.DASHBOARD_TOKEN || '').trim();

function extractAuthToken(source = {}) {
    const authHeader = String(source.headers?.authorization || '');
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const headerToken = String(source.headers?.['x-dashboard-token'] || '').trim();
    return bearer || headerToken;
}

function isAuthorizedByToken(provided) {
    return !!dashboardToken && provided === dashboardToken;
}

function requireDashboardAuth(req, res, next) {
    if (dashboardToken) {
        const provided = extractAuthToken(req);
        if (!isAuthorizedByToken(provided)) {
            return res.status(401).json({ error: 'Unauthorized dashboard access token' });
        }
        return next();
    }

    const ip = requestIp(req);
    if (isLocalAddress(ip)) return next();
    return res
        .status(403)
        .json({ error: 'Dashboard access denied. Set DASHBOARD_TOKEN for remote access.' });
}

module.exports = {
    dashboardToken,
    extractAuthToken,
    isAuthorizedByToken,
    requireDashboardAuth,
};
