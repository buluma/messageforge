const api = axios.create({ baseURL: '', timeout: 15000 });
export default api;

// ── Identity / chats ──────────────────────────────────────────────
export const me = () => api.get('/api/me').then(r => r.data);
export const fetchChats = () => api.get('/api/chats').then(r => r.data);
export const fetchMessages = (jid) => api.get(`/api/chat/${encodeURIComponent(jid)}/messages`).then(r => r.data);

// ── Send / actions ────────────────────────────────────────────────
export const sendText = (jid, text, quoted) =>
  api.post('/api/send', { jid, text, ...(quoted ? { quoted } : {}) }).then(r => r.data);

export const reactTo = (jid, msgId, emoji, opts = {}) =>
  api.post('/api/react', { jid, msgId, emoji, fromMe: !!opts.fromMe, participant: opts.participant }).then(r => r.data);

export const deleteMessage = (jid, msgId, opts = {}) =>
  api.post('/api/delete-message', { jid, msgId, fromMe: !!opts.fromMe, participant: opts.participant }).then(r => r.data);

export const sendTypingState = (jid, state = 'composing') =>
  api.post('/api/typing', { jid, state }).then(r => r.data);

export const markRead = (jid, msgId, opts = {}) =>
  api.post('/api/read', { jid, msgId, fromMe: !!opts.fromMe, participant: opts.participant }).then(r => r.data);

export const subscribePresence = (jid) =>
  api.post('/api/subscribe-presence', { jid }).then(r => r.data);

export const togglePin = (jid) =>
  api.post('/api/toggle-pin', { jid }).then(r => r.data);

// ── Dashboard sources ─────────────────────────────────────────────
export const fetchPlugins = () => api.get('/api/plugins').then(r => r.data);
export const ghRepo = (owner, repo) => api.get(`/gh/repo?owner=${owner}&repo=${repo}`).then(r => r.data);
export const ghUser = (login) => api.get(`/gh/user?login=${login}`).then(r => r.data);
export const ghCommitActivity = (owner, repo) =>
  api.get(`/gh/commit-activity?owner=${owner}&repo=${repo}`).then(r => r.data);
export const ghCommits = (owner, repo, perPage = 100) =>
  api.get(`/gh/commits?owner=${owner}&repo=${repo}&per_page=${perPage}`).then(r => r.data);
