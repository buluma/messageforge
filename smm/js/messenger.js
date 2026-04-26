import { state } from './state.js';
import * as api from './api.js';
import { on } from './socket.js';
import {
  escapeHtml, getInitials, getAvatarColor, jidShort, safeMomentFormat
} from './utils.js';

// ── Bootstrap ────────────────────────────────────────────────────
export function mountMessenger() {
  api.me().then(d => { state.botJid = d?.jid || d?.lid || null; }).catch(() => {});

  on('new-message', (data) => {
    updateChatInList(data);
    if (state.activeJid === data.jid) appendMessage(data.message);
  });
  on('presence-update', ({ jid, presences }) => {
    if (jid !== state.activeJid) return;
    const isTyping = Object.values(presences || {}).some(p => p.lastKnownPresence === 'composing');
    const el = document.getElementById('typingIndicator');
    el.innerHTML = isTyping
      ? `<span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span> typing`
      : '';
  });
  on('reaction-update', ({ jid, msgId, emoji, sender }) => {
    if (jid !== state.activeJid) return;
    updateReactionBadge(msgId, emoji, sender);
  });

  // input handlers
  document.getElementById('sendMessage').onclick = sendMessage;
  document.getElementById('messageInput').onkeyup = (e) => { if (e.key === 'Enter') sendMessage(); };
  document.getElementById('messageInput').oninput = handleTyping;
  document.getElementById('refreshChats').onclick = fetchChats;
  document.getElementById('chatSearch').oninput = handleSearch;
  document.getElementById('cancelReplyBtn').onclick = cancelReply;
  document.getElementById('togglePin').onclick = toggleActivePin;

  fetchChats();
}

// ── Chat list ─────────────────────────────────────────────────────
async function fetchChats() {
  try {
    const data = await api.fetchChats();
    state.chats = data.chats || [];
    state.filteredChats = state.chats;
    renderChatList();
  } catch (e) {
    console.error('fetchChats failed', e);
  }
}

function renderChatList() {
  const list = document.getElementById('chatList');
  if (!state.filteredChats.length) {
    list.innerHTML = '<div class="empty-state">No conversations</div>';
    return;
  }
  list.innerHTML = '';
  for (const chat of state.filteredChats) {
    const name = chat.name || jidShort(chat.jid);
    const item = document.createElement('div');
    item.className = `chat-item ${state.activeJid === chat.jid ? 'active' : ''}`;
    item.dataset.jid = chat.jid;
    const avId = `av-${chat.jid.replace(/\W/g, '')}`;
    item.innerHTML = `
      <div class="avatar avatar-md" id="${avId}" style="background-color:${getAvatarColor(chat.jid)}">${escapeHtml(getInitials(name))}</div>
      <div class="chat-item-body">
        <div class="chat-item-name">
          <span>${escapeHtml(name)}</span>
          ${chat.isPinned ? '<span class="pin-icon">⭐</span>' : ''}
        </div>
        <div class="chat-item-snippet">${escapeHtml(chat.lastMsgSnippet || '')}</div>
      </div>`;
    item.onclick = () => selectChat(chat);
    list.appendChild(item);
    fetchProfilePic(chat.jid, avId);
  }
}

function handleSearch(e) {
  const q = e.target.value.trim().toLowerCase();
  state.filteredChats = !q ? state.chats : state.chats.filter(c => {
    const name = (c.name || jidShort(c.jid)).toLowerCase();
    return name.includes(q) || (c.lastMsgSnippet || '').toLowerCase().includes(q);
  });
  renderChatList();
}

function fetchProfilePic(jid, elId) {
  const url = `/api/profile-pic/${encodeURIComponent(jid)}`;
  const img = new Image();
  img.onload = () => {
    const el = document.getElementById(elId);
    if (el) { el.style.backgroundImage = `url(${url})`; el.innerHTML = ''; }
  };
  img.src = url;
}

function updateChatInList(data) {
  const snippet = data.message?.message?.conversation
    || data.message?.message?.extendedTextMessage?.text
    || '[Media]';
  const existing = state.chats.find(c => c.jid === data.jid);
  if (existing) {
    existing.lastMsgSnippet = snippet;
    state.chats = [existing, ...state.chats.filter(c => c.jid !== data.jid)];
  } else {
    state.chats.unshift({ jid: data.jid, name: data.pushName, lastMsgSnippet: snippet });
  }
  state.filteredChats = state.chats;
  renderChatList();
}

// ── Open chat ─────────────────────────────────────────────────────
async function selectChat(chat) {
  state.activeJid = chat.jid;
  cancelReply();
  api.subscribePresence(chat.jid).catch(() => {});

  document.querySelectorAll('.chat-item').forEach(i =>
    i.classList.toggle('active', i.dataset.jid === chat.jid));

  document.getElementById('chatHeader').hidden = false;
  document.getElementById('chatInputArea').hidden = false;
  document.getElementById('activeChatName').textContent = chat.name || jidShort(chat.jid);
  document.getElementById('activeChatStatus').textContent = chat.jid.endsWith('@g.us') ? 'Group' : 'Online';
  document.getElementById('togglePin').textContent = chat.isPinned ? '⭐' : '☆';

  const av = document.getElementById('activeChatAvatar');
  av.style.backgroundColor = getAvatarColor(chat.jid);
  av.textContent = getInitials(chat.name);
  av.style.backgroundImage = '';
  fetchProfilePic(chat.jid, 'activeChatAvatar');

  document.getElementById('typingIndicator').innerHTML = '';
  const thread = document.getElementById('messageThread');
  thread.innerHTML = '<div class="empty-state">Loading messages…</div>';

  try {
    const data = await api.fetchMessages(chat.jid);
    thread.innerHTML = '';
    state.renderedMsgIds.clear();
    state.msgReactions.clear();
    const msgs = data.messages || [];
    msgs.forEach(appendMessage);
    thread.scrollTop = thread.scrollHeight;
    const lastIncoming = [...msgs].reverse().find(m => !m.key.fromMe);
    if (lastIncoming) {
      api.markRead(chat.jid, lastIncoming.key.id, {
        fromMe: false, participant: lastIncoming.key.participant
      }).catch(() => {});
    }
  } catch (e) {
    thread.innerHTML = '<div class="empty-state">Failed to load messages</div>';
  }
}

async function toggleActivePin() {
  if (!state.activeJid) return;
  try {
    const res = await api.togglePin(state.activeJid);
    const isPinned = res.pinned?.includes(state.activeJid);
    document.getElementById('togglePin').textContent = isPinned ? '⭐' : '☆';
    fetchChats();
  } catch (e) {}
}

// ── Bubble rendering ──────────────────────────────────────────────
function appendMessage(m) {
  if (!m?.key?.id || state.renderedMsgIds.has(m.key.id)) return;
  state.renderedMsgIds.add(m.key.id);

  const thread = document.getElementById('messageThread');
  const placeholder = thread.querySelector('.placeholder, .empty-state');
  if (placeholder) placeholder.remove();

  const b = document.createElement('div');
  b.className = `msg-bubble ${m.key.fromMe ? 'sent' : 'received'}`;
  b.dataset.id = m.key.id;
  if (m.key.participant) b.dataset.participant = m.key.participant;

  const msg = m.message || {};
  const text = msg.conversation
    || msg.extendedTextMessage?.text
    || msg.imageMessage?.caption
    || msg.videoMessage?.caption
    || '';

  const jid = state.activeJid || m.key.remoteJid;
  let media = '';
  if (msg.imageMessage) media = `<img src="/api/media/${encodeURIComponent(jid)}/${m.key.id}">`;
  else if (msg.videoMessage) media = `<video src="/api/media/${encodeURIComponent(jid)}/${m.key.id}" controls></video>`;
  else if (msg.audioMessage) {
    const ttl = msg.audioMessage.ptt ? ' title="Voice note"' : '';
    media = `<audio src="/api/media/${encodeURIComponent(jid)}/${m.key.id}" controls${ttl}></audio>`;
  }
  else if (msg.stickerMessage) media = `<img src="/api/media/${encodeURIComponent(jid)}/${m.key.id}" style="width:120px;height:120px;">`;
  else if (msg.documentMessage) {
    const fn = msg.documentMessage.fileName || 'document';
    media = `<a href="/api/media/${encodeURIComponent(jid)}/${m.key.id}" target="_blank" style="display:flex;gap:8px;align-items:center;background:rgba(0,0,0,0.2);padding:8px;border-radius:8px;text-decoration:none;color:inherit;">📄 <span>${escapeHtml(fn)}</span></a>`;
  }

  // Quoted reply preview
  const ctx = msg.extendedTextMessage?.contextInfo
           || msg.imageMessage?.contextInfo
           || msg.videoMessage?.contextInfo;
  const quoted = ctx?.quotedMessage;
  let quotedHtml = '';
  if (quoted) {
    const qText = quoted.conversation
      || quoted.extendedTextMessage?.text
      || quoted.imageMessage?.caption
      || quoted.videoMessage?.caption
      || (quoted.imageMessage ? '📷 Photo' : '')
      || (quoted.videoMessage ? '🎥 Video' : '')
      || (quoted.audioMessage ? '🎵 Audio' : '')
      || (quoted.stickerMessage ? '🌟 Sticker' : '')
      || (quoted.documentMessage ? '📄 Document' : '')
      || '[Media]';
    const author = ctx.participant ? jidShort(ctx.participant) : '';
    quotedHtml = `<div class="quoted-msg">${author ? `<div class="quoted-author">${escapeHtml(author)}</div>` : ''}<div class="quoted-text">${escapeHtml(qText)}</div></div>`;
  }

  const actionsHtml = m.key.fromMe
    ? `<div class="msg-actions"><span class="msg-action-btn reply-btn" title="Reply">↩️</span><span class="msg-action-btn danger delete-btn" title="Delete">🗑</span></div>`
    : `<div class="msg-actions"><span class="msg-action-btn reply-btn" title="Reply">↩️</span></div>`;

  b.innerHTML = `
    <div class="reaction-picker"><span>👍</span><span>❤️</span><span>😂</span><span>😮</span><span>😢</span><span>🙏</span></div>
    ${quotedHtml}
    ${media}
    ${text ? `<div>${escapeHtml(text)}</div>` : ''}
    <div class="msg-time">${safeMomentFormat(m.messageTimestamp)}</div>
    <div class="msg-reactions" id="reactions-${m.key.id}"></div>
    ${actionsHtml}`;

  b.querySelector('.reply-btn').onclick = (e) => {
    e.stopPropagation();
    state.replyingTo = m;
    const rp = document.getElementById('replyPreview');
    rp.hidden = false;
    document.getElementById('replyText').textContent = `Replying: ${(text || '[Media]').slice(0, 60)}`;
  };
  b.querySelectorAll('.reaction-picker span').forEach(el => {
    el.onclick = (e) => { e.stopPropagation(); doReact(m.key, el.textContent.trim()); };
  });
  if (m.key.fromMe) {
    b.querySelector('.delete-btn').onclick = (e) => { e.stopPropagation(); doDelete(m.key, b); };
  }

  thread.appendChild(b);
  thread.scrollTop = thread.scrollHeight;
}

// ── Reactions ─────────────────────────────────────────────────────
async function doReact(key, emoji) {
  try {
    await api.reactTo(key.remoteJid || state.activeJid, key.id, emoji, {
      fromMe: !!key.fromMe, participant: key.participant,
    });
    updateReactionBadge(key.id, emoji, 'me');
  } catch (e) { console.error('react failed', e); }
}

function updateReactionBadge(msgId, emoji, sender) {
  if (!state.msgReactions.has(msgId)) state.msgReactions.set(msgId, new Map());
  const reacts = state.msgReactions.get(msgId);
  if (emoji) reacts.set(sender, emoji);
  else reacts.delete(sender);

  const container = document.getElementById(`reactions-${msgId}`);
  if (!container) return;
  const counts = {};
  for (const e of reacts.values()) counts[e] = (counts[e] || 0) + 1;
  container.innerHTML = Object.entries(counts)
    .map(([e, c]) => `<span class="msg-reaction-badge">${e}${c > 1 ? ` ${c}` : ''}</span>`)
    .join('');
}

// ── Delete ────────────────────────────────────────────────────────
async function doDelete(key, bubble) {
  try {
    await api.deleteMessage(key.remoteJid || state.activeJid, key.id, {
      fromMe: !!key.fromMe, participant: key.participant,
    });
    bubble.remove();
    state.renderedMsgIds.delete(key.id);
  } catch (e) { console.error('delete failed', e); }
}

// ── Send ──────────────────────────────────────────────────────────
async function sendMessage() {
  const input = document.getElementById('messageInput');
  const text = input.value.trim();
  if (!text || !state.activeJid) return;
  const quoted = state.replyingTo;
  input.value = '';
  cancelReply();

  const tempId = 'temp-' + Date.now();
  appendMessage({
    key: { id: tempId, fromMe: true },
    message: { conversation: text },
    messageTimestamp: Math.floor(Date.now() / 1000),
  });
  updateChatInList({
    jid: state.activeJid,
    message: { message: { conversation: text } },
  });

  try {
    const res = await api.sendText(state.activeJid, text, quoted);
    if (res?.messageId) state.renderedMsgIds.add(res.messageId);
  } catch (e) {
    state.renderedMsgIds.delete(tempId);
    document.querySelector(`[data-id="${tempId}"]`)?.remove();
  }
}

function cancelReply() {
  state.replyingTo = null;
  document.getElementById('replyPreview').hidden = true;
}

function handleTyping() {
  if (!state.activeJid) return;
  api.sendTypingState(state.activeJid, 'composing').catch(() => {});
  clearTimeout(state.typingTimer);
  state.typingTimer = setTimeout(() => {
    api.sendTypingState(state.activeJid, 'paused').catch(() => {});
  }, 2000);
}
