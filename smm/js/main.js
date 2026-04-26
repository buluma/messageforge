import { initSocket } from './socket.js';
import { mountMessenger } from './messenger.js';
import { mountDashboard } from './dashboard.js';

// ── View switching via rail nav ────────────────────────────────────
function setView(name) {
  document.querySelectorAll('.view').forEach(v => {
    v.classList.toggle('active', v.id === `view-${name}`);
  });
  document.querySelectorAll('.rail-btn[data-view]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === name);
  });
}

document.querySelectorAll('.rail-btn[data-view]').forEach(btn => {
  btn.onclick = () => setView(btn.dataset.view);
});

// ── Init ───────────────────────────────────────────────────────────
initSocket();
mountMessenger();
mountDashboard();

// Expose for debugging from console
window.__shadow = { setView };
