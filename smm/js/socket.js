import { state } from './state.js';
import { getDashboardToken, setDashboardToken } from './api.js';
import { setupFocusTrap } from './utils.js';

export const events = new EventTarget();

const FORWARD = ['new-message', 'presence-update', 'reaction-update', 'qr'];
let authPromptShown = false;

function showAuthModal(sock) {
    const modal = document.getElementById('authModal');
    modal.hidden = false;
    const input = document.getElementById('authTokenInput');
    const btn = document.getElementById('authTokenSubmit');

    const cleanup = setupFocusTrap(modal, input);

    const submit = () => {
        const token = input.value.trim();
        if (!token) return;
        cleanup();
        modal.hidden = true;
        setDashboardToken(token);
        sock.auth = { token };
        authPromptShown = false;
        sock.connect();
    };
    btn.onclick = submit;
    input.onkeydown = (e) => {
        if (e.key === 'Enter') submit();
    };
}

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
        showAuthModal(sock);
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
