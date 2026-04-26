import { state } from './state.js';

export const events = new EventTarget();

const FORWARD = ['new-message', 'presence-update', 'reaction-update'];

export function initSocket() {
  if (state.socket) return state.socket;
  const sock = io({ transports: ['websocket', 'polling'] });
  sock.on('connect', () => console.log('[SOCKET] connected', sock.id));
  sock.on('disconnect', (reason) => console.warn('[SOCKET] disconnected:', reason));
  sock.on('connect_error', (err) => console.error('[SOCKET] connect_error:', err.message));
  for (const name of FORWARD) {
    sock.on(name, (data) => events.dispatchEvent(new CustomEvent(name, { detail: data })));
  }
  state.socket = sock;
  return sock;
}

export function on(event, handler) {
  events.addEventListener(event, (e) => handler(e.detail));
}
