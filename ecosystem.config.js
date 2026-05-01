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
            env: {
                NODE_ENV: 'production',
                PORT: 25680,
            },
        },
    ],
};
