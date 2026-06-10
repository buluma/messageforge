const { handleMessages } = require('./handler');

(async () => {
    try {
        const events = [];
        const mockSock = {
            user: { id: '254759704347@s.whatsapp.net' },
            sendMessage: async (jid, content, options) => {
                events.push({ jid, content, options });
                return { key: { id: 'mock123' } };
            },
            sendPresenceUpdate: async () => {},
            readMessages: async () => {}
        };

        const createMockMessage = (text) => ({
            key: { remoteJid: '254111222333@s.whatsapp.net', fromMe: false, id: Math.random().toString(36).substring(7) },
            message: { conversation: text },
            pushName: 'Tester'
        });

        console.log('Testing .ping...');
        await handleMessages(mockSock, createMockMessage('.ping'));
        
        console.log('Testing .facts...');
        await handleMessages(mockSock, createMockMessage('.facts'));
        
        console.log('Testing .calc...');
        await handleMessages(mockSock, createMockMessage('.calc 5 * 10'));

        console.log('Results:');
        console.log(JSON.stringify(events, null, 2));
    } catch (e) {
        console.error(e);
    }
})();
