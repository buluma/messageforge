const api = axios.create({ baseURL: '', timeout: 15000 });
export default api;

const TOKEN_KEY = 'shadow_dashboard_token';

function tokenFromUrl() {
    try {
        const token = new URLSearchParams(window.location.search).get('token');
        return token ? token.trim() : '';
    } catch {
        return '';
    }
}

export function getDashboardToken() {
    try {
        const urlToken = tokenFromUrl();
        if (urlToken) {
            localStorage.setItem(TOKEN_KEY, urlToken);
            return urlToken;
        }
        return (localStorage.getItem(TOKEN_KEY) || '').trim();
    } catch {
        return '';
    }
}

export function setDashboardToken(token) {
    const clean = String(token || '').trim();
    if (!clean) return;
    try {
        localStorage.setItem(TOKEN_KEY, clean);
    } catch {}
}

function attachToken(config) {
    const token = getDashboardToken();
    if (!token) return config;
    config.headers = config.headers || {};
    config.headers['x-dashboard-token'] = token;
    return config;
}

api.interceptors.request.use(attachToken);

api.interceptors.response.use(
    (res) => res,
    async (error) => {
        const original = error?.config || {};
        if (error?.response?.status === 401 && !original._retriedAuth) {
            original._retriedAuth = true;
            const token = window.prompt('Dashboard token required');
            if (token && token.trim()) {
                setDashboardToken(token.trim());
                original.headers = original.headers || {};
                original.headers['x-dashboard-token'] = token.trim();
                return api(original);
            }
        }
        throw error;
    },
);

// ── Identity / chats ──────────────────────────────────────────────
export const authConfig = () => api.get('/api/auth/config').then((r) => r.data);
export const me = () => api.get('/api/me').then((r) => r.data);
export const fetchChats = (options = {}) =>
    api
        .get('/api/chats', {
            timeout: options.timeout || 30000,
            ...(options.signal ? { signal: options.signal } : {}),
        })
        .then((r) => r.data);
export const fetchMessages = (jid, options = {}) => {
    const params = new URLSearchParams();
    if (options.limit) params.set('limit', options.limit);
    if (options.before) params.set('before', options.before);
    const qs = params.toString();
    const url = `/api/chat/${encodeURIComponent(jid)}/messages${qs ? `?${qs}` : ''}`;
    return api
        .get(url, {
            timeout: options.timeout || 45000,
            ...(options.signal ? { signal: options.signal } : {}),
        })
        .then((r) => r.data);
};

export const fetchChatMedia = (jid) => {
    return api.get(`/api/chats/${encodeURIComponent(jid)}/media`).then((r) => r.data);
};

// ── Send / actions ────────────────────────────────────────────────
export const sendText = (jid, text, quoted) =>
    api.post('/api/send', { jid, text, ...(quoted ? { quoted } : {}) }).then((r) => r.data);

export const reactTo = (jid, msgId, emoji, opts = {}) =>
    api
        .post('/api/react', {
            jid,
            msgId,
            emoji,
            fromMe: !!opts.fromMe,
            participant: opts.participant,
        })
        .then((r) => r.data);

export const deleteMessage = (jid, msgId, opts = {}) =>
    api
        .post('/api/delete-message', {
            jid,
            msgId,
            fromMe: !!opts.fromMe,
            participant: opts.participant,
        })
        .then((r) => r.data);

export const sendTypingState = (jid, state = 'composing') =>
    api.post('/api/typing', { jid, state }).then((r) => r.data);

export const markRead = (jid, msgId, opts = {}) =>
    api
        .post('/api/read', { jid, msgId, fromMe: !!opts.fromMe, participant: opts.participant })
        .then((r) => r.data);

export const subscribePresence = (jid) =>
    api.post('/api/subscribe-presence', { jid }).then((r) => r.data);

export const togglePin = (jid) => api.post('/api/toggle-pin', { jid }).then((r) => r.data);
export const fetchChatAliases = () => api.get('/api/chat-aliases').then((r) => r.data);
export const setChatAlias = (jid, alias) =>
    api.post('/api/chat-alias', { jid, alias }).then((r) => r.data);

// ── Full-text search ──────────────────────────────────────────────
export const searchMessages = (q, limit = 20) =>
    api.get(`/api/search?q=${encodeURIComponent(q)}&limit=${limit}`).then((r) => r.data);

// ── Quick-reply templates ─────────────────────────────────────────
export const fetchQuickReplies = () => api.get('/api/quick-replies').then((r) => r.data);
export const addQuickReply = (label, text) =>
    api.post('/api/quick-replies', { label, text }).then((r) => r.data);
export const deleteQuickReply = (id) =>
    api.delete(`/api/quick-replies/${encodeURIComponent(id)}`).then((r) => r.data);
export const reorderQuickReplies = (templates) =>
    api.put('/api/quick-replies', templates).then((r) => r.data);

// ── Plugin reload ─────────────────────────────────────────────────
export const reloadPlugins = () => api.get('/api/plugins/reload').then((r) => r.data);

// ── Dashboard sources ─────────────────────────────────────────────
export const fetchPlugins = () => api.get('/api/plugins').then((r) => r.data);
export const localCommitActivity = (weeks = 12) =>
    api.get(`/api/local-commit-activity?weeks=${encodeURIComponent(weeks)}`).then((r) => r.data);
export const ghRepo = (owner, repo) =>
    api.get(`/gh/repo?owner=${owner}&repo=${repo}`).then((r) => r.data);
export const ghUser = (login) => api.get(`/gh/user?login=${login}`).then((r) => r.data);
export const ghCommitActivity = (owner, repo) =>
    api.get(`/gh/commit-activity?owner=${owner}&repo=${repo}`).then((r) => r.data);
export const ghCommits = (owner, repo, perPage = 100, since = '') => {
    const q = new URLSearchParams({ owner, repo, per_page: perPage });
    if (since) q.set('since', since);
    return api.get(`/gh/commits?${q}`).then((r) => r.data);
};
