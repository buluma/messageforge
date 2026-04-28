#!/usr/bin/env node
/**
 * Migration Script: Import local JSON data into PostgreSQL
 * 
 * Usage:
 *   node scripts/migrate-to-postgres.js
 * 
 * This script migrates:
 *   - plugin_data (sudo, banned, antilink groups, etc.) → plugin_data table
 *   - messenger history (data/messenger-history/) → messages table
 */

'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Load config
const config = require('../config');

// Load database modules
const { connectDB, getPgPool } = require('../lib/database');

const DATA_DIR = path.join(__dirname, '../data');
const MESSENGER_DIR = path.join(DATA_DIR, 'messenger-history');
const PLUGIN_FILES = ['sudo', 'banned', 'antilink_groups', 'antibad_groups', 'antidemote_gps', 'auto_reply_sch'];

async function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureTables(pool) {
    console.log('\n📦 Ensuring database tables exist...');

    // Create plugin_data table
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS plugin_data (
                key VARCHAR(255) PRIMARY KEY,
                data JSONB NOT NULL,
                updated_at TIMESTAMP DEFAULT NOW()
            )
        `);
        console.log('  ✅ plugin_data table ready');
    } catch (err) {
        console.log(`  ⚠️  plugin_data table: ${err.message}`);
    }

    // Create messages table
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS messages (
                jid VARCHAR(255) NOT NULL,
                msg_id VARCHAR(255) NOT NULL,
                key JSONB NOT NULL,
                message JSONB,
                message_timestamp BIGINT NOT NULL,
                push_name VARCHAR(255) DEFAULT '',
                updated_at TIMESTAMP DEFAULT NOW(),
                UNIQUE (jid, msg_id)
            )
        `);
        console.log('  ✅ messages table ready');

        // Create indexes
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_messages_jid_timestamp
            ON messages (jid, message_timestamp DESC)
        `);
        console.log('  ✅ indexes ready');
    } catch (err) {
        console.log(`  ⚠️  messages table: ${err.message}`);
    }
}

async function migratePluginData(pool) {
    console.log('\n📦 Migrating plugin data...');
    let migrated = 0;
    let errors = 0;

    for (const file of PLUGIN_FILES) {
        const filePath = path.join(DATA_DIR, `${file}.json`);

        if (!fs.existsSync(filePath)) {
            console.log(`  ⏭️  ${file}.json - not found, skipping`);
            continue;
        }

        try {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

            await pool.query(
                `INSERT INTO plugin_data (key, data, updated_at)
                 VALUES ($1, $2, NOW())
                 ON CONFLICT (key) DO UPDATE SET data = $2, updated_at = NOW()`,
                [file, JSON.stringify(data)],
            );

            migrated++;
            console.log(`  ✅ ${file}.json - ${Array.isArray(data) ? data.length : Object.keys(data).length} items`);
        } catch (err) {
            errors++;
            console.log(`  ❌ ${file}.json - ${err.message}`);
        }
    }

    console.log(`\nPlugin data: ${migrated} migrated, ${errors} errors`);
    return { migrated, errors };
}

async function migrateMessages(pool) {
    console.log('\n💬 Migrating messenger history...');

    if (!fs.existsSync(MESSENGER_DIR)) {
        console.log('  ⏭️  messenger-history/ directory not found, skipping');
        return { migrated: 0, errors: 0, chats: 0 };
    }

    const files = fs.readdirSync(MESSENGER_DIR).filter((f) => f.endsWith('.json'));

    if (files.length === 0) {
        console.log('  ⏭️  No message files found, skipping');
        return { migrated: 0, errors: 0, chats: 0 };
    }

    let totalMessages = 0;
    let errors = 0;
    let chats = 0;

    for (const file of files) {
        // Skip index.json
        if (file === 'index.json') {
            console.log(`  ⏭️  ${file} - index file, skipping`);
            continue;
        }

        const filePath = path.join(MESSENGER_DIR, file);

        try {
            const messages = JSON.parse(fs.readFileSync(filePath, 'utf8'));

            if (!Array.isArray(messages) || messages.length === 0) {
                continue;
            }

            chats++;

            // Process one by one for reliability
            for (const msg of messages) {
                if (!msg?.key?.remoteJid || !msg?.key?.id) continue;

                try {
                    await pool.query(
                        `INSERT INTO messages (jid, msg_id, key, message, message_timestamp, push_name, updated_at)
                         VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6, NOW())
                         ON CONFLICT (jid, msg_id) DO UPDATE SET
                             key = EXCLUDED.key,
                             message = EXCLUDED.message,
                             message_timestamp = EXCLUDED.message_timestamp,
                             push_name = EXCLUDED.push_name,
                             updated_at = NOW()`,
                        [
                            msg.key.remoteJid,
                            msg.key.id,
                            JSON.stringify(msg.key),
                            JSON.stringify(msg.message || null),
                            msg.messageTimestamp || 0,
                            msg.pushName || '',
                        ],
                    );
                    totalMessages++;
                } catch (err) {
                    // Skip individual message errors
                }
            }

            console.log(`  ✅ ${file} - ${messages.length} messages`);
        } catch (err) {
            errors++;
            console.log(`  ❌ ${file} - ${err.message}`);
        }

        // Small delay to not overwhelm the database
        await sleep(50);
    }

    console.log(`\nMessenger history: ${totalMessages} messages in ${chats} chats, ${errors} errors`);
    return { migrated: totalMessages, errors, chats };
}

async function verifyMigration(pool) {
    console.log('\n🔍 Verifying migration...');

    try {
        const pluginCount = await pool.query('SELECT COUNT(*) FROM plugin_data');
        const messageCount = await pool.query('SELECT COUNT(*) FROM messages');
        const chatCount = await pool.query('SELECT COUNT(DISTINCT jid) FROM messages');

        console.log(`  Plugin data records: ${pluginCount.rows[0].count}`);
        console.log(`  Total messages: ${messageCount.rows[0].count}`);
        console.log(`  Total chats: ${chatCount.rows[0].count}`);
    } catch (err) {
        console.log(`  ❌ Verification failed: ${err.message}`);
    }
}

async function main() {
    console.log('═'.repeat(60));
    console.log('📤 MessageForge → PostgreSQL Migration Script');
    console.log('═'.repeat(60));

    // Check database type
    if (config.DATABASE_TYPE !== 'postgres') {
        console.log('\n⚠️  Warning: DATABASE_TYPE is not set to "postgres"');
        console.log('   Set DATABASE_TYPE=postgres in your .env file to enable PostgreSQL.');
        console.log('   Continuing anyway if PostgreSQL connection is available...\n');
    }

    // Initialize database connection
    console.log('\n🔌 Connecting to PostgreSQL...');
    await connectDB();

    // Small delay to allow connection
    await sleep(500);

    // Connect to PostgreSQL
    const pool = getPgPool();

    if (!pool) {
        console.log('\n❌ No PostgreSQL connection available.');
        console.log('   Make sure:');
        console.log('   1. PostgreSQL is running');
        console.log('   2. DATABASE_TYPE=postgres is set in .env');
        console.log('   3. PostgreSQL config (host, port, user, db) is correct');
        process.exit(1);
    }

    // Ensure tables exist
    await ensureTables(pool);

    // Confirm before proceeding
    console.log('\n📋 Migration will import:');
    console.log('   - Plugin data from data/*.json');
    console.log('   - Message history from data/messenger-history/*.json');
    console.log('\n⚠️  Existing data in PostgreSQL will be updated (upsert), not replaced.');

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    const answer = await new Promise((resolve) => {
        rl.question('\n❓ Continue? (y/N): ', (ans) => {
            rl.close();
            resolve(ans.toLowerCase().trim());
        });
    });

    if (answer !== 'y' && answer !== 'yes') {
        console.log('❌ Migration cancelled.');
        await pool.end();
        process.exit(0);
    }

    console.log('\n🚀 Starting migration...\n');

    // Run migrations
    const pluginResult = await migratePluginData(pool);
    const messageResult = await migrateMessages(pool);

    // Verify
    await verifyMigration(pool);

    // Summary
    console.log('\n' + '═'.repeat(60));
    console.log('📊 Migration Summary');
    console.log('═'.repeat(60));
    console.log(`   Plugin data:  ${pluginResult.migrated} files migrated`);
    console.log(`   Messages:     ${messageResult.migrated} messages in ${messageResult.chats} chats`);
    console.log(`   Total errors: ${pluginResult.errors + messageResult.errors}`);
    console.log('═'.repeat(60));

    if (pluginResult.errors + messageResult.errors > 0) {
        console.log('\n⚠️  Some errors occurred. Check the output above for details.');
        console.log('   Data that was migrated successfully is already in PostgreSQL.');
    } else {
        console.log('\n✅ Migration completed successfully!');
    }

    console.log('\n💡 Next steps:');
    console.log('   1. Start the bot: npm start');
    console.log('   2. Verify messages are being stored in PostgreSQL');
    console.log('   3. (Optional) Keep or delete data/*.json files as backup');

    await pool.end();
    process.exit(0);
}

main().catch((err) => {
    console.error('\n❌ Migration failed:', err.message);
    process.exit(1);
});
