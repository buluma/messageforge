'use strict';

const { spawnSync } = require('child_process');

const nodeArgs = [];
if (process.allowedNodeEnvironmentFlags?.has('--no-experimental-webstorage')) {
    nodeArgs.push('--no-experimental-webstorage');
}

const result = spawnSync(
    process.execPath,
    [...nodeArgs, require.resolve('jest/bin/jest'), ...process.argv.slice(2)],
    { stdio: 'inherit' },
);

if (result.error) {
    console.error(result.error.message);
    process.exit(1);
}

process.exit(result.status ?? 1);
