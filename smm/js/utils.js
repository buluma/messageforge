export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function formatWAText(s) {
  // Escape first so injected HTML in message content is inert.
  let t = escapeHtml(s);
  // ```code block``` — must run before single-backtick rule.
  t = t.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
  // `inline code`
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  // *bold*
  t = t.replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>');
  // _italic_
  t = t.replace(/_([^_\n]+)_/g, '<em>$1</em>');
  // ~strikethrough~
  t = t.replace(/~([^~\n]+)~/g, '<s>$1</s>');
  // Newlines → <br> (skip inside <pre> blocks by only replacing outside them).
  t = t.replace(/([^>])\n/g, '$1<br>');
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
