'use strict';

const fs = require('fs/promises');
const path = require('path');
const { BufferJSON, initAuthCreds, proto } = require('@whiskeysockets/baileys');

const TABLE_NAME = 'baileys_auth_state';

function fixFileName(file) {
    return file?.replace(/\//g, '__')?.replace(/:/g, '-');
}

function serialize(data) {
    return JSON.parse(JSON.stringify(data, BufferJSON.replacer));
}

function deserialize(data) {
    if (!data) return null;
    return JSON.parse(JSON.stringify(data), BufferJSON.reviver);
}

async function ensureSchema(pool) {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
            key TEXT PRIMARY KEY,
            data JSONB NOT NULL,
            updated_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);
}

async function readRow(pool, key) {
    const result = await pool.query(`SELECT data FROM ${TABLE_NAME} WHERE key = $1`, [key]);
    return result.rows[0]?.data ? deserialize(result.rows[0].data) : null;
}

async function writeRow(pool, key, data) {
    await pool.query(
        `INSERT INTO ${TABLE_NAME} (key, data, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
        [key, serialize(data)],
    );
}

async function deleteRow(pool, key) {
    await pool.query(`DELETE FROM ${TABLE_NAME} WHERE key = $1`, [key]);
}

async function importSessionDir(pool, sessionDir) {
    const creds = await readRow(pool, 'creds.json');
    if (creds) return 0;

    let files = [];
    try {
        files = await fs.readdir(sessionDir);
    } catch {
        return 0;
    }

    let imported = 0;
    for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const filePath = path.join(sessionDir, file);
        try {
            const raw = await fs.readFile(filePath, 'utf8');
            const parsed = JSON.parse(raw, BufferJSON.reviver);
            await writeRow(pool, file, parsed);
            imported++;
        } catch {
            /* skip invalid or transient auth files */
        }
    }

    return imported;
}

async function usePostgresAuthState(pool, sessionDir) {
    await ensureSchema(pool);
    await importSessionDir(pool, sessionDir);

    const creds = (await readRow(pool, 'creds.json')) || initAuthCreds();

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    await Promise.all(
                        ids.map(async (id) => {
                            let value = await readRow(pool, fixFileName(`${type}-${id}.json`));
                            if (type === 'app-state-sync-key' && value) {
                                value = proto.Message.AppStateSyncKeyData.fromObject(value);
                            }
                            data[id] = value;
                        }),
                    );
                    return data;
                },
                set: async (data) => {
                    const tasks = [];
                    for (const category in data) {
                        for (const id in data[category]) {
                            const value = data[category][id];
                            const key = fixFileName(`${category}-${id}.json`);
                            tasks.push(value ? writeRow(pool, key, value) : deleteRow(pool, key));
                        }
                    }
                    await Promise.all(tasks);
                },
            },
        },
        saveCreds: () => writeRow(pool, 'creds.json', creds),
    };
}

module.exports = {
    ensureSchema,
    usePostgresAuthState,
};
