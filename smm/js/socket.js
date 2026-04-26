import { state } from './state.js';
import { getDashboardToken, setDashboardToken } from './api.js';

export const events = new EventTarget();

const FORWARD = ['new-message', 'presence-update', 'reaction-update'];
let authPromptShown = false;

export function initSocket() {
    if (state.socket) return state.socket;
    const token = getDashboardToken();
    const opts = { transports: ['websocket', 'polling'] };
    if (token) opts.auth = { token };
    const sock = io(opts);
    sock.on('connect', () => console.log('[SOCKET] connected', sock.id));
    sock.on('disconnect', (reason) => console.warn('[SOCKET] disconnected:', reason));
    sock.on('connect_error', (err) => {
        console.error('[SOCKET] connect_error:', err.message);
        if (err?.message !== 'unauthorized') return;
        if (authPromptShown) return;
        authPromptShown = true;
        const input = window.prompt('Dashboard token required');
        if (!input || !input.trim()) return;
        const nextToken = input.trim();
        setDashboardToken(nextToken);
        sock.auth = { token: nextToken };
        authPromptShown = false;
        sock.connect();
    });
    for (const name of FORWARD) {
        sock.on(name, (data) => events.dispatchEvent(new CustomEvent(name, { detail: data })));
    }
    state.socket = sock;
    return sock;
}

export function on(event, handler) {
    events.addEventListener(event, (e) => handler(e.detail));
}
