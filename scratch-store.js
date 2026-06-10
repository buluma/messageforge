const { makeInMemoryStore } = require('@whiskeysockets/baileys');
const store = makeInMemoryStore({});
console.log('store.chats type:', store.chats.constructor.name);
console.log('store.messages type:', store.messages.constructor.name);
