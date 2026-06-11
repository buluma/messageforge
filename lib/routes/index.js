const chatsRoutes = require('./chats');
const messengerRoutes = require('./messenger');
const opsRoutes = require('./ops');
const pluginsRoutes = require('./plugins');
const githubRoutes = require('./github');
const quickRepliesRoutes = require('./quickReplies');
const staticRoutes = require('./static');

function mountAll(app, deps) {
    chatsRoutes(app, deps);
    messengerRoutes(app, deps);
    opsRoutes(app, deps);
    pluginsRoutes(app, deps);
    githubRoutes(app, deps);
    quickRepliesRoutes(app, deps);
    staticRoutes(app, deps);
}

module.exports = { mountAll };
