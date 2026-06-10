import { state } from './state.js';
import * as api from './api.js';
import { on } from './socket.js';
import {
    escapeHtml,
    formatWAText,
    getInitials,
    getAvatarColor,
    jidShort,
    safeMomentFormat,
    setupFocusTrap,
    toast,
} from './utils.js';

const PAGE_SIZE = 60;
let chatTimeTicker = null;
let activeChatRequest = null;
const SCROLL_BOTTOM_THRESHOLD = 72;

// ── Quick-reply template state ────────────────────────────────────
let quickReplies = [];
let qrPopupOpen = false;

// ── Full-text search state ────────────────────────────────────────
let searchMode = false; // true when showing message search results
let searchDebounceTimer = null;

// jid -> 'loaded' | 'failed'. Avoids re-issuing profile-pic requests per render.
const avatarStatus = new Map();
// jid -> DOM node. Lets renderChatList reuse nodes instead of rebuilding.
const chatItemNodes = new Map();
// jid -> number of unread messages received while the chat was not active.
const unreadCounts = new Map();
let chatAliases = {};

function updateDocumentTitle() {
    let total = 0;
    for (const count of unreadCounts.values()) {
        total += count;
    }
    const baseTitle = 'MessageForge — Admin';
    document.title = total > 0 ? `(${total}) ${baseTitle}` : baseTitle;
}

// ── Bootstrap ────────────────────────────────────────────────────
export function mountMessenger() {
    api.authConfig()
        .then((cfg) => {
            if (!cfg?.tokenRequired) return;
            if (!api.getDashboardToken()) {
                const token = window.prompt('Enter dashboard token');
                if (token && token.trim()) api.setDashboardToken(token.trim());
            }
        })
        .catch(() => {});

    api.me()
        .then((d) => {
            state.botJid = d?.jid || d?.lid || null;
        })
        .catch(() => {});

    on('new-message', (data) => {
        updateChatInList(data);
        if (state.activeJid === data.jid) {
            appendMessage(data.message);
        } else {
            unreadCounts.set(data.jid, (unreadCounts.get(data.jid) || 0) + 1);
            updateDocumentTitle();
        }
    });
    on('presence-update', ({ jid, presences }) => {
        if (jid !== state.activeJid) return;
        const values = Object.values(presences || {});

        const isTyping = values.some((p) => p.lastKnownPresence === 'composing');
        const el = document.getElementById('typingIndicator');
        el.innerHTML = isTyping
            ? `<span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span> typing`
            : '';

        const statusEl = document.getElementById('activeChatStatus');
        if (jid.endsWith('@g.us')) {
            const onlineCount = values.filter((p) =>
                p.lastKnownPresence === 'available' ||
                p.lastKnownPresence === 'composing' ||
                p.lastKnownPresence === 'paused',
            ).length;
            if (onlineCount > 0) statusEl.textContent = `${onlineCount} online`;
        } else {
            const p = values[0];
            if (!p) return;
            const presence = p.lastKnownPresence;
            if (presence === 'composing') statusEl.textContent = 'typing...';
            else if (presence === 'recording') statusEl.textContent = 'recording...';
            else if (presence === 'available' || presence === 'paused') statusEl.textContent = 'Online';
            else statusEl.textContent = 'Offline';
        }
    });
    on('reaction-update', ({ jid, msgId, emoji, sender }) => {
        if (jid !== state.activeJid) return;
        updateReactionBadge(msgId, emoji, sender);
    });

    // input handlers
    document.getElementById('sendMessage').onclick = sendMessage;
    document.getElementById('messageInput').onkeyup = (e) => {
        if (e.key === 'Enter') sendMessage();
    };
    document.getElementById('messageInput').oninput = handleTyping;
    document.getElementById('refreshChats').onclick = fetchChats;
    document.getElementById('chatSearch').oninput = handleSearch;
    document.getElementById('chatSearch').onkeydown = handleSearchKeydown;

    state.currentTab = 'active';
    document.getElementById('tabActive').onclick = () => {
        state.currentTab = 'active';
        document.getElementById('tabActive').classList.add('active');
        document.getElementById('tabActive').style.opacity = '1';
        document.getElementById('tabArchived').classList.remove('active');
        document.getElementById('tabArchived').style.opacity = '0.7';
        applyChatFilter(document.getElementById('chatSearch')?.value || '');
        renderChatList();
    };
    document.getElementById('tabArchived').onclick = () => {
        state.currentTab = 'archived';
        document.getElementById('tabArchived').classList.add('active');
        document.getElementById('tabArchived').style.opacity = '1';
        document.getElementById('tabActive').classList.remove('active');
        document.getElementById('tabActive').style.opacity = '0.7';
        applyChatFilter(document.getElementById('chatSearch')?.value || '');
        renderChatList();
    };
    document.getElementById('cancelReplyBtn').onclick = cancelReply;
    document.getElementById('renameChat').onclick = renameActiveChat;
    document.getElementById('togglePin').onclick = toggleActivePin;
    document.getElementById('toggleArchive').onclick = toggleActiveArchive;
    document.getElementById('loadOlderBtn').onclick = loadOlderMessages;
    document.getElementById('scrollToBottomBtn').onclick = () =>
        scrollThreadToBottom({ force: true });
    document.getElementById('messageThread').addEventListener('scroll', updateScrollBottomButton);

    // Quick-reply wiring
    mountQuickReplies();

    api.fetchChatAliases()
        .then((d) => {
            chatAliases = d?.aliases || {};
        })
        .catch(() => {});

    fetchChats();

    if (!chatTimeTicker) {
        chatTimeTicker = setInterval(() => {
            if (state.filteredChats?.length) refreshChatTimes();
        }, 30 * 1000);
    }
}

function isThreadNearBottom(thread) {
    return thread.scrollHeight - thread.scrollTop - thread.clientHeight <= SCROLL_BOTTOM_THRESHOLD;
}

function scrollThreadToBottom({ force = false } = {}) {
    const thread = document.getElementById('messageThread');
    if (!thread) return;
    if (force || isThreadNearBottom(thread)) {
        thread.scrollTop = thread.scrollHeight;
    }
    updateScrollBottomButton();
}

function updateScrollBottomButton() {
    const thread = document.getElementById('messageThread');
    const btn = document.getElementById('scrollToBottomBtn');
    if (!thread || !btn) return;
    if (!state.activeJid) {
        btn.hidden = true;
        return;
    }
    const hasScrollableContent = thread.scrollHeight > thread.clientHeight + 20;
    btn.hidden = !hasScrollableContent || isThreadNearBottom(thread);
}

function refreshChatTimes() {
    for (const chat of state.filteredChats) {
        const node = chatItemNodes.get(chat.jid);
        if (!node) continue;
        const timeEl = node.querySelector('.chat-item-time');
        const newLabel = formatChatTimeLabel(chat.timestamp);
        if (!timeEl) continue;
        if (newLabel) {
            timeEl.textContent = newLabel;
            timeEl.title = formatChatAbsolute(chat.timestamp);
        } else {
            timeEl.textContent = '';
        }
    }
}

// ── Chat list ─────────────────────────────────────────────────────
function sortedChats(chats) {
    return [...chats].sort((a, b) => {
        const ap = !!a.isPinned;
        const bp = !!b.isPinned;
        if (ap !== bp) return ap ? -1 : 1;
        return (b.timestamp || 0) - (a.timestamp || 0);
    });
}

async function fetchChats() {
    try {
        const data = await api.fetchChats();
        state.chats = sortedChats(data.chats || []);
        applyChatFilter(document.getElementById('chatSearch')?.value || '');
        renderChatList();
    } catch (e) {
        console.error('fetchChats failed', e);
    }
}

function avatarElId(jid) {
    return `av-${jid.replace(/\W/g, '')}`;
}

function buildChatItemNode(chat) {
    const item = document.createElement('div');
    item.dataset.jid = chat.jid;
    item.tabIndex = 0;
    item.role = 'button';
    item.ariaLabel = `Chat with ${chat.name || jidShort(chat.jid)}`;
    const avId = avatarElId(chat.jid);
    item.innerHTML = `
      <div class="avatar avatar-md" id="${avId}"></div>
      <div class="chat-item-body">
        <div class="chat-item-name">
          <span class="chat-item-title"></span>
          <div class="chat-item-meta">
            <span class="chat-item-time"></span>
            <span class="pin-icon" hidden>⭐</span>
          </div>
        </div>
        <div class="chat-item-row2">
          <div class="chat-item-snippet"></div>
          <span class="unread-badge" hidden></span>
        </div>
      </div>`;
    item.onclick = () => selectChat(chat);
    item.onkeydown = (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            selectChat(chat);
        }
    };
    return item;
}

function applyChatItem(node, chat) {
    const name = chat.name || jidShort(chat.jid);
    node.className = `chat-item ${state.activeJid === chat.jid ? 'active' : ''}`;
    node.onclick = () => selectChat(chat);

    const av = node.querySelector('.avatar');
    if (av && avatarStatus.get(chat.jid) !== 'loaded') {
        av.style.backgroundColor = getAvatarColor(chat.jid);
        if (!av.textContent) av.textContent = getInitials(name);
    }

    const titleEl = node.querySelector('.chat-item-title');
    if (titleEl && titleEl.textContent !== name) titleEl.textContent = name;

    const timeEl = node.querySelector('.chat-item-time');
    const timeLabel = formatChatTimeLabel(chat.timestamp);
    if (timeEl) {
        if (timeLabel) {
            timeEl.textContent = timeLabel;
            timeEl.title = formatChatAbsolute(chat.timestamp);
        } else {
            timeEl.textContent = '';
        }
    }

    const pinEl = node.querySelector('.pin-icon');
    if (pinEl) pinEl.hidden = !chat.isPinned;

    const snippetEl = node.querySelector('.chat-item-snippet');
    const snippet = chat.lastMsgSnippet || '';
    if (snippetEl && snippetEl.textContent !== snippet) snippetEl.textContent = snippet;

    const badgeEl = node.querySelector('.unread-badge');
    if (badgeEl) {
        const count = unreadCounts.get(chat.jid) || 0;
        if (count > 0) {
            badgeEl.textContent = count > 99 ? '99+' : String(count);
            badgeEl.hidden = false;
        } else {
            badgeEl.hidden = true;
        }
    }
}

function renderChatList() {
    const list = document.getElementById('chatList');
    if (!state.filteredChats.length) {
        list.innerHTML = '<div class="empty-state">No conversations</div>';
        chatItemNodes.clear();
        return;
    }

    const desired = new Set();
    const fragment = document.createDocumentFragment();
    const newJids = [];

    for (const chat of state.filteredChats) {
        desired.add(chat.jid);
        let node = chatItemNodes.get(chat.jid);
        if (!node) {
            node = buildChatItemNode(chat);
            chatItemNodes.set(chat.jid, node);
            newJids.push(chat.jid);
        }
        applyChatItem(node, chat);
        fragment.appendChild(node);
    }

    for (const [jid, node] of chatItemNodes) {
        if (!desired.has(jid)) {
            node.remove();
            chatItemNodes.delete(jid);
        }
    }

    list.replaceChildren(fragment);

    for (const jid of newJids) fetchProfilePic(jid, avatarElId(jid));
}

function applyChatFilter(rawQuery) {
    const q = String(rawQuery || '')
        .trim()
        .toLowerCase();
    
    let baseChats = state.chats;
    if (state.currentTab === 'archived') {
        baseChats = state.chats.filter(c => c.isArchived);
    } else {
        baseChats = state.chats.filter(c => !c.isArchived);
    }

    state.filteredChats = sortedChats(
        !q
            ? baseChats
            : baseChats.filter((c) => {
                  const name = (c.name || jidShort(c.jid)).toLowerCase();
                  return name.includes(q) || (c.lastMsgSnippet || '').toLowerCase().includes(q);
              }),
    );
}

function handleSearch(e) {
    const raw = e?.target?.value || '';
    // If search mode was active and the input is cleared, exit search mode
    if (searchMode && !raw.trim()) {
        clearSearchResults();
    }
    if (!searchMode) {
        applyChatFilter(raw);
        renderChatList();
    }
}

function handleSearchKeydown(e) {
    if (e.key !== 'Enter') return;
    const q = String(e.target?.value || '').trim();
    if (q.length >= 3) {
        runFullTextSearch(q);
    } else if (!q) {
        clearSearchResults();
    }
}

async function runFullTextSearch(q) {
    const resultsEl = document.getElementById('searchResults');
    const chatListEl = document.getElementById('chatList');
    if (!resultsEl || !chatListEl) return;

    resultsEl.innerHTML = '<div class="empty-state" style="padding:10px 14px;font-size:12px">Searching…</div>';
    resultsEl.hidden = false;
    chatListEl.hidden = true;
    searchMode = true;

    try {
        const data = await api.searchMessages(q, 20);
        const results = data?.results || [];

        if (!results.length) {
            resultsEl.innerHTML = '<div class="empty-state" style="padding:10px 14px;font-size:12px">No messages found</div>';
            appendSearchClearBtn(resultsEl);
            return;
        }

        const frag = document.createDocumentFragment();
        for (const r of results) {
            const item = document.createElement('div');
            item.className = 'search-result-item';
            item.tabIndex = 0;
            item.role = 'button';
            const name = escapeHtml(r.pushName || jidShort(r.jid));
            const snippet = escapeHtml((r.message?.text || '').slice(0, 80));
            const ts = r.message?.timestamp
                ? safeMomentFormat(r.message.timestamp)
                : '';
            item.innerHTML = `
                <div class="search-result-meta">
                    <span class="search-result-name">${name}</span>
                    <span class="search-result-time">${ts}</span>
                </div>
                <span class="search-result-snippet">${snippet}</span>
            `;
            const onClick = () => {
                const chat = state.chats.find((c) => c.jid === r.jid) || {
                    jid: r.jid,
                    name: r.pushName || jidShort(r.jid),
                };
                clearSearchResults();
                selectChat(chat);
            };
            item.onclick = onClick;
            item.onkeydown = (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onClick();
                }
            };
            frag.appendChild(item);
        }

        resultsEl.innerHTML = '';
        resultsEl.appendChild(frag);
        appendSearchClearBtn(resultsEl);
    } catch (err) {
        resultsEl.innerHTML = '<div class="empty-state" style="padding:10px 14px;font-size:12px">Search failed</div>';
        appendSearchClearBtn(resultsEl);
    }
}

function appendSearchClearBtn(container) {
    const btn = document.createElement('button');
    btn.className = 'search-clear-btn';
    btn.textContent = 'Clear search';
    btn.onclick = clearSearchResults;
    container.appendChild(btn);
}

function clearSearchResults() {
    const resultsEl = document.getElementById('searchResults');
    const chatListEl = document.getElementById('chatList');
    const searchInput = document.getElementById('chatSearch');
    if (resultsEl) {
        resultsEl.innerHTML = '';
        resultsEl.hidden = true;
    }
    if (chatListEl) chatListEl.hidden = false;
    if (searchInput) searchInput.value = '';
    searchMode = false;
    applyChatFilter('');
    renderChatList();
}

const NO_AVATAR_SUFFIXES = ['@newsletter', '@broadcast'];

function fetchProfilePic(jid, elId) {
    if (NO_AVATAR_SUFFIXES.some((s) => jid.endsWith(s))) {
        avatarStatus.set(jid, 'failed');
        return;
    }
    if (avatarStatus.get(jid) === 'failed') return;
    const url = `/api/profile-pic/${encodeURIComponent(jid)}`;
    if (avatarStatus.get(jid) === 'loaded') {
        const el = document.getElementById(elId);
        if (el) {
            el.style.backgroundImage = `url(${url})`;
            el.innerHTML = '';
        }
        return;
    }
    const img = new Image();
    img.onload = () => {
        avatarStatus.set(jid, 'loaded');
        const el = document.getElementById(elId);
        if (el) {
            el.style.backgroundImage = `url(${url})`;
            el.innerHTML = '';
        }
    };
    img.onerror = () => {
        avatarStatus.set(jid, 'failed');
    };
    img.src = url;
}

function updateChatInList(data) {
    const snippet =
        data.message?.message?.conversation ||
        data.message?.message?.extendedTextMessage?.text ||
        '[Media]';
    const incomingTs = data.message?.messageTimestamp || Math.floor(Date.now() / 1000);
    const existing = state.chats.find((c) => c.jid === data.jid);
    if (existing) {
        existing.lastMsgSnippet = snippet;
        existing.timestamp = incomingTs;
        state.chats = sortedChats(state.chats);
    } else {
        state.chats = sortedChats([
            {
                jid: data.jid,
                name: data.pushName,
                lastMsgSnippet: snippet,
                timestamp: incomingTs,
            },
            ...state.chats,
        ]);
    }
    applyChatFilter(document.getElementById('chatSearch')?.value || '');
    renderChatList();
}

function normalizeTimestampSeconds(ts) {
    if (typeof ts === 'number' && Number.isFinite(ts)) {
        return ts > 1e12 ? Math.floor(ts / 1000) : Math.floor(ts);
    }
    if (typeof ts === 'string') {
        const n = Number(ts);
        if (Number.isFinite(n)) return n > 1e12 ? Math.floor(n / 1000) : Math.floor(n);
        return 0;
    }
    if (ts && typeof ts === 'object') {
        if (typeof ts.low === 'number') return Math.floor(ts.low);
        if (typeof ts.toString === 'function') {
            const n = Number(ts.toString());
            if (Number.isFinite(n)) return n > 1e12 ? Math.floor(n / 1000) : Math.floor(n);
        }
    }
    return 0;
}

function formatChatTimeLabel(ts) {
    const secs = normalizeTimestampSeconds(ts);
    if (!secs) return '';
    const diff = Math.max(0, Math.floor(Date.now() / 1000) - secs);
    if (diff < 45) return 'now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d`;
    return safeMomentFormat(secs, 'DD MMM');
}

function formatChatAbsolute(ts) {
    const secs = normalizeTimestampSeconds(ts);
    if (!secs) return '';
    return safeMomentFormat(secs, 'ddd, DD MMM hh:mm A');
}

// ── Open chat ─────────────────────────────────────────────────────
async function selectChat(chat) {
    state.activeJid = chat.jid;
    unreadCounts.delete(chat.jid);
    updateDocumentTitle();
    // Re-render the list immediately so the badge clears on the selected item.
    renderChatList();
    cancelReply();
    api.subscribePresence(chat.jid).catch(() => {});

    // Cancel any previous in-flight chat load to prevent timeout races/stale swaps.
    if (activeChatRequest) {
        activeChatRequest.abort();
        activeChatRequest = null;
    }
    const controller = new AbortController();
    activeChatRequest = controller;

    document
        .querySelectorAll('.chat-item')
        .forEach((i) => i.classList.toggle('active', i.dataset.jid === chat.jid));

    document.getElementById('chatHeader').hidden = false;
    document.getElementById('chatInputArea').hidden = false;
    document.getElementById('activeChatName').textContent = chat.name || jidShort(chat.jid);
    document.getElementById('activeChatStatus').textContent = chat.jid.endsWith('@g.us')
        ? 'Group'
        : '—';
    document.getElementById('togglePin').textContent = chat.isPinned ? '⭐' : '☆';
    document.getElementById('toggleArchive').textContent = chat.isArchived ? '📦 Unarchive' : '📦 Archive';

    const av = document.getElementById('activeChatAvatar');
    av.style.backgroundColor = getAvatarColor(chat.jid);
    av.textContent = getInitials(chat.name);
    av.style.backgroundImage = '';
    fetchProfilePic(chat.jid, 'activeChatAvatar');

    document.getElementById('typingIndicator').innerHTML = '';
    const thread = document.getElementById('messageThread');
    thread.innerHTML = '<div class="empty-state">Loading messages…</div>';
    updateScrollBottomButton();
    const loadOlderBtn = document.getElementById('loadOlderBtn');
    loadOlderBtn.hidden = true;

    try {
        const data = await api.fetchMessages(chat.jid, {
            limit: PAGE_SIZE,
            signal: controller.signal,
        });
        if (state.activeJid !== chat.jid || activeChatRequest !== controller) return;
        thread.innerHTML = '';
        state.renderedMsgIds.clear();
        state.msgReactions.clear();
        state.chatPage.set(chat.jid, data.page || { hasMore: false, before: null });
        const msgs = data.messages || [];
        msgs.forEach((m) => appendMessage(m, { autoScroll: false }));
        scrollThreadToBottom({ force: true });
        document.getElementById('messageInput').focus();
        loadOlderBtn.hidden = !data.page?.hasMore;
        const lastIncoming = [...msgs].reverse().find((m) => !m.key.fromMe);
        if (lastIncoming) {
            api.markRead(chat.jid, lastIncoming.key.id, {
                fromMe: false,
                participant: lastIncoming.key.participant,
            }).catch(() => {});
        }
    } catch (e) {
        if (e?.code === 'ERR_CANCELED' || e?.name === 'AbortError') return;
        thread.innerHTML = '<div class="empty-state">Failed to load messages</div>';
        updateScrollBottomButton();
        loadOlderBtn.hidden = true;
    } finally {
        document.getElementById('messageInput').focus();
        if (activeChatRequest === controller) activeChatRequest = null;
    }
}

async function loadOlderMessages() {
    if (!state.activeJid) return;
    const page = state.chatPage.get(state.activeJid) || {};
    if (!page.hasMore || !page.before) return;

    const btn = document.getElementById('loadOlderBtn');
    btn.disabled = true;
    const thread = document.getElementById('messageThread');
    const prevHeight = thread.scrollHeight;

    try {
        const data = await api.fetchMessages(state.activeJid, {
            limit: PAGE_SIZE,
            before: page.before,
        });
        const msgs = data.messages || [];
        for (let i = msgs.length - 1; i >= 0; i -= 1) {
            appendMessage(msgs[i], { prepend: true, autoScroll: false });
        }
        state.chatPage.set(state.activeJid, data.page || { hasMore: false, before: null });
        btn.hidden = !data.page?.hasMore;
        const newHeight = thread.scrollHeight;
        thread.scrollTop = Math.max(0, newHeight - prevHeight);
        updateScrollBottomButton();
    } catch (e) {
        console.error('loadOlderMessages failed', e);
    } finally {
        btn.disabled = false;
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

async function renameActiveChat() {
    if (!state.activeJid) return;
    const current = state.chats.find((c) => c.jid === state.activeJid);
    const currentAlias = String(chatAliases[state.activeJid] || '').trim();
    const suggested = currentAlias || current?.name || jidShort(state.activeJid);
    const raw = window.prompt('Set chat label (leave blank to clear alias):', suggested);
    if (raw === null) return;

    const alias = raw.trim();
    try {
        const res = await api.setChatAlias(state.activeJid, alias);
        chatAliases = res?.aliases || chatAliases;
        await fetchChats();
        const next = state.chats.find((c) => c.jid === state.activeJid);
        document.getElementById('activeChatName').textContent =
            next?.name || jidShort(state.activeJid);
    } catch (e) {
        console.error('renameActiveChat failed', e);
    }
}

// ── Bubble rendering ──────────────────────────────────────────────
function appendMessage(m, options = {}) {
    const prepend = !!options.prepend;
    const autoScroll = options.autoScroll !== false;
    if (!m?.key?.id || state.renderedMsgIds.has(m.key.id)) return;
    state.renderedMsgIds.add(m.key.id);

    const thread = document.getElementById('messageThread');
    const shouldStickBottom = autoScroll && isThreadNearBottom(thread);
    const placeholder = thread.querySelector('.placeholder, .empty-state');
    if (placeholder) placeholder.remove();

    const b = document.createElement('div');
    b.className = `msg-bubble ${m.key.fromMe ? 'sent' : 'received'}`;
    b.dataset.id = m.key.id;
    if (m.key.participant) b.dataset.participant = m.key.participant;

    const msg = m.message || {};
    const text =
        msg.conversation ||
        msg.extendedTextMessage?.text ||
        msg.imageMessage?.caption ||
        msg.videoMessage?.caption ||
        '';

    const jid = state.activeJid || m.key.remoteJid;
    let media = '';
    if (msg.imageMessage) media = `<img src="/api/media/${encodeURIComponent(jid)}/${m.key.id}">`;
    else if (msg.videoMessage)
        media = `<video src="/api/media/${encodeURIComponent(jid)}/${m.key.id}" controls></video>`;
    else if (msg.audioMessage) {
        const ttl = msg.audioMessage.ptt ? ' title="Voice note"' : '';
        media = `<audio src="/api/media/${encodeURIComponent(jid)}/${m.key.id}" controls${ttl}></audio>`;
    } else if (msg.stickerMessage)
        media = `<img src="/api/media/${encodeURIComponent(jid)}/${m.key.id}" style="width:120px;height:120px;">`;
    else if (msg.documentMessage) {
        const fn = msg.documentMessage.fileName || 'document';
        media = `<a href="/api/media/${encodeURIComponent(jid)}/${m.key.id}" target="_blank" style="display:flex;gap:8px;align-items:center;background:rgba(0,0,0,0.2);padding:8px;border-radius:8px;text-decoration:none;color:inherit;">📄 <span>${escapeHtml(fn)}</span></a>`;
    }

    // Quoted reply preview
    const ctx =
        msg.extendedTextMessage?.contextInfo ||
        msg.imageMessage?.contextInfo ||
        msg.videoMessage?.contextInfo;
    const quoted = ctx?.quotedMessage;
    let quotedHtml = '';
    if (quoted) {
        const qText =
            quoted.conversation ||
            quoted.extendedTextMessage?.text ||
            quoted.imageMessage?.caption ||
            quoted.videoMessage?.caption ||
            (quoted.imageMessage ? '📷 Photo' : '') ||
            (quoted.videoMessage ? '🎥 Video' : '') ||
            (quoted.audioMessage ? '🎵 Audio' : '') ||
            (quoted.stickerMessage ? '🌟 Sticker' : '') ||
            (quoted.documentMessage ? '📄 Document' : '') ||
            '[Media]';
        const author = ctx.participant ? jidShort(ctx.participant) : '';
        quotedHtml = `<div class="quoted-msg">${author ? `<div class="quoted-author">${escapeHtml(author)}</div>` : ''}<div class="quoted-text">${formatWAText(qText)}</div></div>`;
    }

    const actionsHtml = `<div class="msg-actions"><span class="msg-action-btn reply-btn" title="Reply">↩️</span></div>`;
    const reactionPickerHtml = m.key.fromMe
        ? ''
        : `<div class="reaction-picker"><span>👍</span><span>❤️</span><span>😂</span><span>😮</span><span>😢</span><span>🙏</span></div>`;

    b.innerHTML = `
    ${quotedHtml}
    ${media}
    ${text ? `<div class="msg-text">${formatWAText(text)}</div>` : ''}
    <div class="msg-time">${safeMomentFormat(m.messageTimestamp)}</div>
    <div class="msg-reactions" id="reactions-${escapeHtml(m.key.id)}"></div>
    <div class="msg-bottom-bar">
      ${reactionPickerHtml}
      ${actionsHtml}
    </div>`;

    b.querySelector('.reply-btn').onclick = (e) => {
        e.stopPropagation();
        state.replyingTo = m;
        const rp = document.getElementById('replyPreview');
        rp.hidden = false;
        document.getElementById('replyText').textContent =
            `Replying: ${(text || '[Media]').slice(0, 60)}`;
        document.getElementById('messageInput').focus();
    };
    b.querySelectorAll('.reaction-picker span').forEach((el) => {
        el.onclick = (e) => {
            e.stopPropagation();
            doReact(m.key, el.textContent.trim());
        };
    });

    if (prepend) thread.insertBefore(b, thread.firstChild);
    else thread.appendChild(b);
    if (autoScroll && shouldStickBottom) thread.scrollTop = thread.scrollHeight;
    updateScrollBottomButton();
}

// ── Reactions ─────────────────────────────────────────────────────
async function doReact(key, emoji) {
    try {
        await api.reactTo(key.remoteJid || state.activeJid, key.id, emoji, {
            fromMe: !!key.fromMe,
            participant: key.participant,
        });
        updateReactionBadge(key.id, emoji, 'me');
    } catch (e) {
        console.error('react failed', e);
    }
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
        .map(([e, c]) => `<span class="msg-reaction-badge">${escapeHtml(e)}${c > 1 ? ` ${c}` : ''}</span>`)
        .join('');
}

// ── Delete ────────────────────────────────────────────────────────
async function doDelete(key, bubble) {
    try {
        await api.deleteMessage(key.remoteJid || state.activeJid, key.id, {
            fromMe: !!key.fromMe,
            participant: key.participant,
        });
        bubble.remove();
        state.renderedMsgIds.delete(key.id);
    } catch (e) {
        console.error('delete failed', e);
    }
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
        updateScrollBottomButton();
    }
    input.focus();
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

// ── Quick-reply templates ─────────────────────────────────────────

let qrPopupCleanup = null;
function mountQuickReplies() {
    const triggerBtn = document.getElementById('quickReplyBtn');
    const popup = document.getElementById('qrPopup');
    const manageBtn = document.getElementById('qrManageBtn');

    if (!triggerBtn || !popup) return;

    triggerBtn.onclick = (e) => {
        e.stopPropagation();
        qrPopupOpen = !qrPopupOpen;
        popup.hidden = !qrPopupOpen;
        if (qrPopupOpen) {
            loadQuickReplies();
            qrPopupCleanup = setupFocusTrap(popup, manageBtn);
        } else if (qrPopupCleanup) {
            qrPopupCleanup();
            qrPopupCleanup = null;
        }
    };

    manageBtn.onclick = (e) => {
        e.stopPropagation();
        popup.hidden = true;
        qrPopupOpen = false;
        if (qrPopupCleanup) {
            qrPopupCleanup();
            qrPopupCleanup = null;
        }
        openQrModal();
    };

    document.addEventListener('click', (e) => {
        if (qrPopupOpen && !popup.contains(e.target) && e.target !== triggerBtn) {
            popup.hidden = true;
            qrPopupOpen = false;
            if (qrPopupCleanup) {
                qrPopupCleanup();
                qrPopupCleanup = null;
            }
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (!qrPopupOpen) return;
        popup.hidden = true;
        qrPopupOpen = false;
        if (qrPopupCleanup) {
            qrPopupCleanup();
            qrPopupCleanup = null;
        }
    });

    // Modal wiring
    document.getElementById('qrModalClose').onclick = closeQrModal;
    document.getElementById('qrAddBtn').onclick = saveNewQuickReply;

    // Load templates at startup so the popup is ready
    loadQuickReplies();
}

async function loadQuickReplies() {
    try {
        quickReplies = await api.fetchQuickReplies();
    } catch {
        quickReplies = [];
    }
    renderQrPopupList();
    renderQrModalList();
}

function renderQrPopupList() {
    const listEl = document.getElementById('qrList');
    if (!listEl) return;

    if (!quickReplies.length) {
        listEl.innerHTML = '<div class="qr-empty">No templates yet. Click + Add to create one.</div>';
        return;
    }

    const frag = document.createDocumentFragment();
    for (const t of quickReplies) {
        const item = document.createElement('div');
        item.className = 'qr-item';
        item.innerHTML = `
            <div class="qr-item-label">${escapeHtml(t.label)}</div>
            <div class="qr-item-preview">${escapeHtml(t.text)}</div>
        `;
        item.onclick = () => insertQuickReply(t.text);
        frag.appendChild(item);
    }
    listEl.innerHTML = '';
    listEl.appendChild(frag);
}

function renderQrModalList() {
    const listEl = document.getElementById('qrModalList');
    if (!listEl) return;

    if (!quickReplies.length) {
        listEl.innerHTML = '<div class="empty-state" style="padding:14px">No templates yet.</div>';
        return;
    }

    const frag = document.createDocumentFragment();
    for (const t of quickReplies) {
        const item = document.createElement('div');
        item.className = 'qr-modal-item';
        const idx = quickReplies.indexOf(t);
        item.innerHTML = `
            <div class="qr-modal-item-order">
                <button class="qr-order-btn" data-dir="-1" title="Move up" ${idx === 0 ? 'disabled' : ''}>▲</button>
                <button class="qr-order-btn" data-dir="1" title="Move down" ${idx === quickReplies.length - 1 ? 'disabled' : ''}>▼</button>
            </div>
            <div class="qr-modal-item-body">
                <div class="qr-modal-item-label">${escapeHtml(t.label)}</div>
                <div class="qr-modal-item-text">${escapeHtml(t.text)}</div>
            </div>
            <button class="qr-modal-item-del" title="Delete">✕</button>
        `;
        item.querySelector('.qr-modal-item-del').onclick = () => removeQuickReply(t.id);
        item.querySelectorAll('.qr-order-btn').forEach((btn) => {
            btn.onclick = () => moveQuickReply(idx, Number(btn.dataset.dir));
        });
        frag.appendChild(item);
    }
    listEl.innerHTML = '';
    listEl.appendChild(frag);
}

async function moveQuickReply(idx, dir) {
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= quickReplies.length) return;
    [quickReplies[idx], quickReplies[newIdx]] = [quickReplies[newIdx], quickReplies[idx]];
    renderQrPopupList();
    renderQrModalList();
    try {
        await api.reorderQuickReplies(quickReplies);
    } catch {
        toast.error('Failed to save order');
    }
}

function insertQuickReply(text) {
    const input = document.getElementById('messageInput');
    if (!input) return;
    input.value = text;
    input.focus();
    document.getElementById('qrPopup').hidden = true;
    qrPopupOpen = false;
}

let qrModalCleanup = null;
function openQrModal() {
    const modal = document.getElementById('qrModal');
    if (!modal) return;
    modal.hidden = false;
    renderQrModalList();
    qrModalCleanup = setupFocusTrap(modal, document.getElementById('qrModalClose'));
}

function closeQrModal() {
    const modal = document.getElementById('qrModal');
    if (modal) modal.hidden = true;
    if (qrModalCleanup) {
        qrModalCleanup();
        qrModalCleanup = null;
    }
    // Clear add form
    const labelInput = document.getElementById('qrNewLabel');
    const textInput = document.getElementById('qrNewText');
    if (labelInput) labelInput.value = '';
    if (textInput) textInput.value = '';
}

async function saveNewQuickReply() {
    const label = String(document.getElementById('qrNewLabel')?.value || '').trim();
    const text = String(document.getElementById('qrNewText')?.value || '').trim();
    if (!label || !text) {
        toast.warn('Label and text are required');
        return;
    }
    try {
        const t = await api.addQuickReply(label, text);
        quickReplies.push(t);
        renderQrPopupList();
        renderQrModalList();
        document.getElementById('qrNewLabel').value = '';
        document.getElementById('qrNewText').value = '';
        toast.success('Template saved');
    } catch {
        toast.error('Failed to save template');
    }
}

async function removeQuickReply(id) {
    try {
        await api.deleteQuickReply(id);
        quickReplies = quickReplies.filter((t) => t.id !== id);
        renderQrPopupList();
        renderQrModalList();
        toast.success('Template deleted');
    } catch {
        toast.error('Failed to delete template');
    }
}

async function toggleActiveArchive() {
    if (!state.activeJid) return;
    const current = state.chats.find((c) => c.jid === state.activeJid);
    const isArchiving = !(current?.isArchived);
    try {
        const { data } = await axios.post('/api/toggle-archive', {
            jid: state.activeJid,
            archive: isArchiving
        });
        if (data.success) {
            await fetchChats();
            const next = state.chats.find((c) => c.jid === state.activeJid);
            if (next) {
                document.getElementById('toggleArchive').textContent = next.isArchived ? '📦 Unarchive' : '📦 Archive';
            }
        }
    } catch (e) {
        console.error('toggle archive error', e);
        alert('Failed to toggle archive');
    }
}
