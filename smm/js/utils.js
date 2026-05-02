// ── Toast notification system ─────────────────────────────────────
// Injects its own container into the DOM on first use.
let _toastContainer = null;

function getToastContainer() {
    if (!_toastContainer) {
        _toastContainer = document.createElement('div');
        _toastContainer.className = 'toast-container';
        document.body.appendChild(_toastContainer);
    }
    return _toastContainer;
}

function showToast(msg, type) {
    const container = getToastContainer();
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = msg;

    container.appendChild(el);

    // Trigger fade-in on next frame
    requestAnimationFrame(() => el.classList.add('toast-visible'));

    const dismiss = () => {
        el.classList.remove('toast-visible');
        el.addEventListener('transitionend', () => el.remove(), { once: true });
    };

    const timer = setTimeout(dismiss, 4000);
    el.addEventListener('click', () => { clearTimeout(timer); dismiss(); });
}

export const toast = {
    success: (msg) => showToast(msg, 'success'),
    error:   (msg) => showToast(msg, 'error'),
    warn:    (msg) => showToast(msg, 'warn'),
    info:    (msg) => showToast(msg, 'info'),
};

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function formatWAText(s) {
  // Escape first so injected HTML in message content is inert.
  let t = escapeHtml(s);

  // Extract code segments into placeholders so emphasis regexes cannot match
  // inside them. Tokens are not valid WA format chars, so no re-entry risk.
  const segments = [];
  const placeholder = (html) => {
    const token = `\x00${segments.length}\x00`;
    segments.push(html);
    return token;
  };

  // ```code block``` — must run before single-backtick rule.
  t = t.replace(/```([\s\S]*?)```/g, (_, inner) =>
    placeholder(`<pre><code>${inner}</code></pre>`)
  );
  // `inline code`
  t = t.replace(/`([^`]+)`/g, (_, inner) => placeholder(`<code>${inner}</code>`));

  // Emphasis rules — safe; code content is behind placeholders.
  t = t.replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>');
  t = t.replace(/_([^_\n]+)_/g, '<em>$1</em>');
  t = t.replace(/~([^~\n]+)~/g, '<s>$1</s>');

  // Newlines → <br> outside restored code blocks.
  t = t.replace(/([^>])\n/g, '$1<br>');

  // Restore code segments.
  t = t.replace(/\x00(\d+)\x00/g, (_, i) => segments[+i]);

  return t;
}

export function toTitleCase(str) {
  return String(str || '').replace(/[-_.]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

export function getInitials(name) {
  if (!name || !String(name).trim()) return 'U';
  const p = String(name).trim().split(/\s+/);
  if (p.length >= 2 && p[1].length > 0) return (p[0][0] + p[1][0]).toUpperCase();
  return (p[0].slice(0, 2) || 'U').toUpperCase();
}

const AVATAR_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#0ea5e9', '#14b8a6'];

export function getAvatarColor(jid) {
  let hash = 0;
  const s = String(jid || '');
  for (let i = 0; i < s.length; i++) hash = s.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export function jidShort(jid) {
  return String(jid || '').split('@')[0];
}

export function safeMomentFormat(ts, fmt = 'hh:mm A') {
  try {
    let secs = 0;

    if (typeof ts === 'number' && Number.isFinite(ts)) {
      secs = ts > 1e12 ? Math.floor(ts / 1000) : Math.floor(ts);
    } else if (typeof ts === 'string') {
      const n = Number(ts);
      if (Number.isFinite(n)) secs = n > 1e12 ? Math.floor(n / 1000) : Math.floor(n);
    } else if (ts && typeof ts === 'object') {
      if (typeof ts.low === 'number') secs = Math.floor(ts.low);
      else if (typeof ts.toString === 'function') {
        const n = Number(ts.toString());
        if (Number.isFinite(n)) secs = n > 1e12 ? Math.floor(n / 1000) : Math.floor(n);
      }
    }

    if (!secs || !Number.isFinite(secs)) return '';
    const m = moment(secs * 1000);
    return m.isValid() ? m.format(fmt) : '';
  } catch {
    return '';
  }
}

/**
 * Sets up a focus trap within an element.
 * @param {HTMLElement} root - The container element to trap focus within.
 * @param {HTMLElement} closeBtn - The button that closes the modal (focused on entry).
 * @returns {Function} - A cleanup function to remove listeners.
 */
export function setupFocusTrap(root, closeBtn) {
    const focusableEls = root.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    const firstFocusable = focusableEls[0];
    const lastFocusable = focusableEls[focusableEls.length - 1];

    const handleKeydown = (e) => {
        if (e.key !== 'Tab') return;

        if (e.shiftKey) {
            if (document.activeElement === firstFocusable) {
                lastFocusable.focus();
                e.preventDefault();
            }
        } else {
            if (document.activeElement === lastFocusable) {
                firstFocusable.focus();
                e.preventDefault();
            }
        }
    };

    root.addEventListener('keydown', handleKeydown);
    if (closeBtn) closeBtn.focus();
    else if (firstFocusable) firstFocusable.focus();

    return () => root.removeEventListener('keydown', handleKeydown);
}
