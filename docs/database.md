# Database Configuration Guide

This document explains how to configure MessageForge with PostgreSQL instead of or alongside MongoDB.

## What's Stored in PostgreSQL

When using PostgreSQL (`DATABASE_TYPE=postgres`), the following data is stored:

| Table | Description |
|-------|-------------|
| `plugin_data` | Bot configuration (sudo users, banned users, antilink groups, etc.) |
| `messages` | WhatsApp message history per chat |

Local JSON files in `data/` remain as backup/fallback.

## Current Architecture

MessageForge currently supports:
- **MongoDB** (optional) - set via `MONGODB_URL`
- **Local JSON** (fallback) - automatic fallback when MongoDB is unavailable

## PostgreSQL Setup

### Prerequisites

1. PostgreSQL is running (see [Postgres.app](https://postgres.app) or Homebrew installation)
2. `psql` is available in PATH

### Step 1: Create Database and User

Connect to PostgreSQL and create the required database:

```bash
psql -U shadowwalker -h localhost -p 5432
```

Or if your PostgreSQL requires password authentication:

```bash
psql -U shadowwalker -h localhost -p 5432 -W
```

In the PostgreSQL shell, run:

```sql
-- Create a new database
CREATE DATABASE messageforge;

-- Create a user (optional, if you want separate credentials)
CREATE USER mf_user WITH PASSWORD 'your_secure_password';

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE messageforge TO mf_user;

-- Connect to the database
\c messageforge

-- Grant schema permissions
GRANT ALL ON SCHEMA public TO mf_user;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO mf_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO mf_user;

-- Make mf_user the owner
ALTER DATABASE messageforge OWNER TO mf_user;
```

### Step 2: Install PostgreSQL Driver

```bash
npm install pg
```

### Step 3: Configure Environment

Add the following to your `.env` file:

```env
# PostgreSQL Connection (recommended for production)
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=shadowwalker
POSTGRES_PASSWORD=
POSTGRES_DB=messageforge

# Set DATABASE_TYPE to 'postgres' to use PostgreSQL
# Options: 'mongo', 'postgres', 'local' (local JSON only)
DATABASE_TYPE=postgres

# Optional: Keep MongoDB URL for migration purposes
# MONGODB_URL=
```

### Step 4: Update Code

The following files need to be modified:

#### 4.1 `lib/database.js` - Add PostgreSQL Connection

```javascript
'use strict';

const mongoose = require('mongoose');
const { Pool } = require('pg');

let mongoConnected = false;
let pgPool = null;

/**
 * MongoDB Connection
 */
async function connectMongo() {
    const { MONGODB_URL } = require('../config');
    if (!MONGODB_URL) return;

    try {
        await mongoose.connect(MONGODB_URL);
        mongoConnected = true;
        console.log('[MongoDB] Connected successfully');
    } catch (err) {
        console.error('[MongoDB] Connection failed:', err.message);
        mongoConnected = false;
    }
}

/**
 * PostgreSQL Connection Pool
 */
function connectPostgres() {
    const { POSTGRES_HOST, POSTGRES_PORT, POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB } = require('../config');
    
    pgPool = new Pool({
        host: POSTGRES_HOST || 'localhost',
        port: POSTGRES_PORT || 5432,
        user: POSTGRES_USER || 'shadowwalker',
        password: POSTGRES_PASSWORD || '',
        database: POSTGRES_DB || 'messageforge',
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
    });

    pgPool.on('error', (err) => {
        console.error('[PostgreSQL] Unexpected error on idle client:', err);
    });

    console.log('[PostgreSQL] Connection pool created');
}

/**
 * Initialize database connections
 */
async function initDatabase() {
    const { DATABASE_TYPE } = require('../config');
    
    // Always initialize MongoDB (optional backend)
    await connectMongo();
    
    // Initialize PostgreSQL if configured
    if (DATABASE_TYPE === 'postgres') {
        connectPostgres();
    }
}

module.exports = {
    mongoose,
    mongoConnected: () => mongoConnected,
    getPgPool: () => pgPool,
    initDatabase,
};
```

#### 4.2 `lib/dbManager.js` - Update to Support PostgreSQL

```javascript
'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../config');
const PluginData = require('./models/pluginData');
const { mongoose, getPgPool, mongoConnected } = require('./database');

/**
 * Generic data manager with support for MongoDB, PostgreSQL, and local JSON fallback.
 */
class DBManager {
    constructor() {
        this.dataDir = path.join(__dirname, '../data');
        if (!fs.existsSync(this.dataDir)) fs.mkdirSync(this.dataDir, { recursive: true });
    }

    /**
     * Get database type to use
     */
    getDbType() {
        const dbType = config.DATABASE_TYPE || 'local';
        if (dbType === 'postgres') return 'postgres';
        if (dbType === 'mongo' && config.MONGODB_URL && mongoConnected()) return 'mongo';
        return 'local';
    }

    /**
     * Retrieves data for a specific key.
     */
    async get(key, defaultValue = null) {
        const dbType = this.getDbType();

        // PostgreSQL
        if (dbType === 'postgres') {
            const pool = getPgPool();
            if (pool) {
                try {
                    const result = await pool.query(
                        'SELECT data FROM plugin_data WHERE key = $1',
                        [key]
                    );
                    if (result.rows.length > 0) {
                        return result.rows[0].data;
                    }
                } catch (err) {
                    console.error(`[DBManager:Get] PostgreSQL error for ${key}:`, err.message);
                }
            }
        }

        // MongoDB
        if (dbType === 'mongo') {
            try {
                const doc = await PluginData.findOne({ key });
                if (doc) return doc.data;
            } catch (err) {
                console.error(`[DBManager:Get] MongoDB error for ${key}: ${err.message}`);
            }
        }

        // Local JSON fallback
        try {
            const filePath = path.join(this.dataDir, `${key}.json`);
            if (fs.existsSync(filePath)) {
                return JSON.parse(fs.readFileSync(filePath, 'utf8'));
            }
        } catch (err) {
            console.error(`[DBManager:Get] local fallback error for ${key}: ${err.message}`);
        }

        return defaultValue;
    }

    /**
     * Saves data for a specific key.
     */
    async set(key, data) {
        const dbType = this.getDbType();

        // PostgreSQL
        if (dbType === 'postgres') {
            const pool = getPgPool();
            if (pool) {
                try {
                    await pool.query(
                        `INSERT INTO plugin_data (key, data, updated_at)
                         VALUES ($1, $2, NOW())
                         ON CONFLICT (key) DO UPDATE SET data = $2, updated_at = NOW()`,
                        [key, JSON.stringify(data)]
                    );
                } catch (err) {
                    console.error(`[DBManager:Set] PostgreSQL error for ${key}:`, err.message);
                }
            }
        }

        // MongoDB
        if (dbType === 'mongo') {
            try {
                await PluginData.findOneAndUpdate(
                    { key },
                    { data, updatedAt: new Date() },
                    { upsert: true, new: true }
                );
            } catch (err) {
                console.error(`[DBManager:Set] MongoDB error for ${key}: ${err.message}`);
            }
        }

        // Always save to local JSON as well
        try {
            const filePath = path.join(this.dataDir, `${key}.json`);
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        } catch (err) {
            console.error(`[DBManager:Set] local save error for ${key}: ${err.message}`);
        }
    }

    /**
     * Initialize PostgreSQL schema (call once)
     */
    async initPostgresSchema() {
        const pool = getPgPool();
        if (!pool) return;

        await pool.query(`
            CREATE TABLE IF NOT EXISTS plugin_data (
                key VARCHAR(255) PRIMARY KEY,
                data JSONB NOT NULL,
                updated_at TIMESTAMP DEFAULT NOW()
            )
        `);
        console.log('[PostgreSQL] Schema initialized');
    }
}

module.exports = new DBManager();
```

#### 4.3 `config.js` - Add PostgreSQL Settings

Add these new configuration options:

```javascript
// Add to module.exports
DATABASE_TYPE: process.env.DATABASE_TYPE || 'local',
POSTGRES_HOST: process.env.POSTGRES_HOST || 'localhost',
POSTGRES_PORT: Number(process.env.POSTGRES_PORT || 5432),
POSTGRES_USER: process.env.POSTGRES_USER || 'shadowwalker',
POSTGRES_PASSWORD: process.env.POSTGRES_PASSWORD || '',
POSTGRES_DB: process.env.POSTGRES_DB || 'messageforge',
```

#### 4.4 `messageforge.js` - Initialize Database

Update the startup to initialize the database:

```javascript
// Add after other requires
const { initDatabase } = require('./lib/database');
const dbManager = require('./lib/dbManager');

async function start() {
    // Initialize database connections
    await initDatabase();
    
    // Initialize PostgreSQL schema if using PostgreSQL
    const { DATABASE_TYPE } = require('./config');
    if (DATABASE_TYPE === 'postgres') {
        await dbManager.initPostgresSchema();
    }
    
    // ... rest of startup code
}
```

### Step 5: Update `sample.env`

Add these lines:

```env
# ─── Database Settings ────────────────────────────────────────────────────────
# Database backend: 'local' (default JSON), 'mongo' (MongoDB), 'postgres' (PostgreSQL)
DATABASE_TYPE=local

# PostgreSQL Configuration (used when DATABASE_TYPE=postgres)
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=shadowwalker
POSTGRES_PASSWORD=
POSTGRES_DB=messageforge

# MongoDB Configuration (optional, for migration or hybrid setup)
# MONGODB_URL=
```

## Database Type Comparison

| Feature | Local JSON | MongoDB | PostgreSQL |
|---------|-----------|---------|------------|
| Setup complexity | None | Medium | Medium |
| Concurrent access | Limited | Excellent | Excellent |
| Query capabilities | Key-value only | Rich | Rich (SQL) |
| Persistence | File-based | Database | Database |
| Backup | Copy files | `mongodump` | `pg_dump` |
| Production ready | No | Yes | Yes |

## Migration from Existing Data

### Migrate Local JSON to PostgreSQL

If you're switching from local JSON storage to PostgreSQL:

1. **Make sure PostgreSQL is configured** (set `DATABASE_TYPE=postgres` in `.env`)

2. **Run the migration script:**
   ```bash
   node scripts/migrate-to-postgres.js
   ```

   This will import:
   - Plugin data (`data/*.json` - sudo users, banned users, antilink groups, etc.)
   - Message history (`data/messenger-history/*.json`)

3. **Verify** the migration completed successfully

4. **Start the bot** - new data will be stored in PostgreSQL

### Migration from MongoDB to PostgreSQL

If you're switching from MongoDB:

1. Export data from MongoDB (optional, local JSON files serve as backup)
2. Set `DATABASE_TYPE=postgres` in `.env`
3. Configure PostgreSQL connection settings
4. Start the bot - schema will auto-create
5. Data will sync from local JSON files on first access

## Troubleshooting

### PostgreSQL Connection Issues

```bash
# Test connection
psql -U shadowwalker -h localhost -p 5432 -d messageforge -c "SELECT 1"

# Check PostgreSQL is running
pg_isready -h localhost -p 5432

# View PostgreSQL logs
# On Postgres.app: ~/Library/Logs/postgresql/
```

### Common Errors

- **"connection refused"**: Check PostgreSQL is running and port is correct
- **"password authentication failed"**: Verify credentials in `.env`
- **"database does not exist"**: Run the CREATE DATABASE command above
- **"permission denied"**: Grant appropriate permissions to the user

## Production Recommendations

1. **Use environment variables** for all secrets
2. **Enable SSL** for production PostgreSQL connections:

```javascript
const pool = new Pool({
    // ... other options
    ssl: {
        rejectUnauthorized: true,
        ca: fs.readFileSync('/path/to/ca-certificate')
    }
});
```

3. **Set up connection pooling** for high-traffic bots
4. **Regular backups** using `pg_dump`
5. **Monitor connection usage** with `pg_stat_activity`
