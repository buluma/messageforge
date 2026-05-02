const path = require('path');

const LOG_DIR = path.join(__dirname, 'logs');

module.exports = {
    apps: [
        {
            name: 'messageforge',
            script: 'messageforge.js',
            cwd: __dirname,
            instances: 1,
            exec_mode: 'fork',
            autorestart: true,
            watch: false,
            max_memory_restart: '2G',
            out_file: path.join(LOG_DIR, 'pm2-out.log'),
            error_file: path.join(LOG_DIR, 'pm2-error.log'),
            log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS Z',
            env: {
                NODE_ENV: 'production',
                PORT: 25680,
            },
        },
    ],
};
