const path = require('path');
const fs = require('fs');
const config = require('../../config');

module.exports = function staticRoutes(app) {
    app.get('/', (req, res) => {
        const html = path.join(__dirname, 'smm', 'messageforge.html');
        if (fs.existsSync(html)) return res.sendFile(html);
        res.send(`<h2>✅ ${config.BOT_NAME} is Running!</h2>`);
    });
};
