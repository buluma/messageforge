export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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
  try { return moment((ts || 0) * 1000).format(fmt); }
  catch { return ''; }
}
