'use strict';

const fs = require('fs/promises');
const path = require('path');
const { BufferJSON, initAuthCreds, proto } = require('@whiskeysockets/baileys');
const logger = require('./logger');

const TABLE_NAME = 'baileys_auth_state';

function fixFileName(file) {
    return file?.replace(/\//g, '__')?.replace(/:/g, '-');
}

function serialize(data) {
    if (data === null || data === undefined) return null;
    return JSON.stringify(data, BufferJSON.replacer);
}

function deserialize(data) {
    if (!data) return null;

    let parsed = data;
    // If pg returned a string instead of an object (depends on driver config)
    if (typeof data === 'string') {
        try {
            parsed = JSON.parse(data);
        } catch {
            return null;
        }
    }

    // Handle the case where we might have a primitive or corrupted data
    if (typeof parsed !== 'object' || parsed === null) {
        return parsed;
    }

    try {
        // Double stringify/parse to apply BufferJSON.reviver to the plain object
        return JSON.parse(JSON.stringify(parsed), BufferJSON.reviver);
    } catch {
        return parsed;
    }
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
    const serialized = serialize(data);
    if (!serialized) return;

    try {
        await pool.query(
            `INSERT INTO ${TABLE_NAME} (key, data, updated_at)
             VALUES ($1, $2::jsonb, NOW())
             ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
            [key, serialized],
        );
    } catch (err) {
        logger.error(`[Auth] Failed to write key ${key}: ${err.message}`);
        // Log truncated data for debugging if it's a JSON error
        if (err.message.includes('json')) {
            logger.error(`[Auth] Malformed data for ${key}: ${serialized.substring(0, 500)}...`);
        }
    }
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
                            try {
                                let value = await readRow(pool, fixFileName(`${type}-${id}.json`));
                                if (type === 'app-state-sync-key' && value) {
                                    value = proto.Message.AppStateSyncKeyData.fromObject(value);
                                }
                                // ✅ Defensive check for sender-key to prevent "Cannot create property 'senderMessageKeys' on number"
                                if (type === 'sender-key' && value) {
                                    const isBuffer =
                                        Buffer.isBuffer(value) || value instanceof Uint8Array;
                                    const isPrimitive = typeof value !== 'object';
                                    if (isBuffer || isPrimitive) {
                                        // Corrupted or incompatible sender key state
                                        // Returning null forces Baileys to re-negotiate the key safely.
                                        value = null;
                                    }
                                }
                                data[id] = value;
                            } catch (err) {
                                logger.warn(`[Auth] Failed to get ${type} (${id}): ${err.message}`);
                                // Silent fail for single key to prevent total crash
                                data[id] = null;
                            }
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
