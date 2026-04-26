export const state = {
  socket: null,
  activeJid: null,
  chats: [],
  filteredChats: [],
  replyingTo: null,
  typingTimer: null,
  botJid: null,
  renderedMsgIds: new Set(),
  msgReactions: new Map(),
  allPlugins: [],
  commitsChart: null,
  pluginFilter: 'all',
};
