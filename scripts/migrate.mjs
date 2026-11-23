import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import pg from 'pg';

const { Client } = pg;

const MIGRATIONS_DIR = path.resolve('db/migrations');
const UP_SUFFIX = '.up.sql';
const DOWN_SUFFIX = '.down.sql';
const VALIDATE_SUFFIX = '.validate.sql';

function sha256(content) {
    return crypto.createHash('sha256').update(content).digest('hex');
}

function parseArgs(argv) {
    const args = { mode: 'up', target: null };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--status') {
            args.mode = 'status';
        } else if (arg === '--down') {
            args.mode = 'down';
            args.target = argv[++i];
            if (!args.target) {
                throw new Error('--down requires a migration name');
            }
        } else if (arg === '--up') {
            args.mode = 'up';
        } else {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }
    return args;
}

/**
 * Discover the ordered set of migration triples in the canonical directory.
 * Every migration MUST have .up.sql, .down.sql and .validate.sql siblings.
 */
function discoverMigrations() {
    if (!fs.existsSync(MIGRATIONS_DIR)) {
        throw new Error(`Canonical migrations directory not found: ${MIGRATIONS_DIR}`);
    }

    const entries = fs.readdirSync(MIGRATIONS_DIR);
    const names = entries
        .filter(f => f.endsWith(UP_SUFFIX))
        .map(f => f.slice(0, -UP_SUFFIX.length))
        .sort();

    const migrations = names.map(name => {
        const upPath = path.join(MIGRATIONS_DIR, `${name}${UP_SUFFIX}`);
        const downPath = path.join(MIGRATIONS_DIR, `${name}${DOWN_SUFFIX}`);
        const validatePath = path.join(MIGRATIONS_DIR, `${name}${VALIDATE_SUFFIX}`);

        if (!fs.existsSync(downPath)) {
            throw new Error(`Missing rollback file for migration ${name}: ${downPath}`);
        }
        if (!fs.existsSync(validatePath)) {
            throw new Error(`Missing validation file for migration ${name}: ${validatePath}`);
        }

        const up = fs.readFileSync(upPath, 'utf8');
        return {
            name,
            up,
            down: fs.readFileSync(downPath, 'utf8'),
            validate: fs.readFileSync(validatePath, 'utf8'),
            checksum: sha256(up),
        };
    });

    // Reject stray .sql files that are not part of a triple (e.g. legacy single-file migrations).
    const known = new Set();
    for (const m of migrations) {
        known.add(`${m.name}${UP_SUFFIX}`);
        known.add(`${m.name}${DOWN_SUFFIX}`);
        known.add(`${m.name}${VALIDATE_SUFFIX}`);
    }
    for (const entry of entries) {
        if (entry.endsWith('.sql') && !known.has(entry)) {
            throw new Error(
                `Unrecognized migration file in canonical directory: ${entry}. ` +
                `Migrations must be <name>.up.sql / <name>.down.sql / <name>.validate.sql triples.`
            );
        }
    }

    return migrations;
}

async function ensureMigrationsTable(client) {
    // `schema_migrations` is the canonical tracking table. `migration_history`
    // is kept as a backwards-compatible alias for older tooling.
    await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            id SERIAL PRIMARY KEY,
            migration_name VARCHAR(255) UNIQUE NOT NULL,
            checksum VARCHAR(64) NOT NULL,
            applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
    `);
    await client.query(`
        CREATE TABLE IF NOT EXISTS migration_history (
            id SERIAL PRIMARY KEY,
            migration_name VARCHAR(255) UNIQUE NOT NULL,
            checksum VARCHAR(64) NOT NULL,
            applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
    `);
}

async function fetchApplied(client) {
    const { rows } = await client.query(
        'SELECT migration_name, checksum, applied_at FROM schema_migrations ORDER BY migration_name'
    );
    return rows;
}

async function recordApplied(client, name, checksum) {
    await client.query(
        'INSERT INTO schema_migrations (migration_name, checksum) VALUES ($1, $2)',
        [name, checksum]
    );
    await client.query(
        'INSERT INTO migration_history (migration_name, checksum) VALUES ($1, $2) ON CONFLICT (migration_name) DO NOTHING',
        [name, checksum]
    );
}

async function recordRolledBack(client, name) {
    await client.query('DELETE FROM schema_migrations WHERE migration_name = $1', [name]);
    await client.query('DELETE FROM migration_history WHERE migration_name = $1', [name]);
}

function verifyChecksums(migrations, applied) {
    const byName = new Map(migrations.map(m => [m.name, m]));
    for (const row of applied) {
        const migration = byName.get(row.migration_name);
        if (!migration) {
            throw new Error(
                `Applied migration ${row.migration_name} has no corresponding files in ${MIGRATIONS_DIR}.`
            );
        }
        if (migration.checksum !== row.checksum) {
            throw new Error(
                `Checksum mismatch for applied migration: ${row.migration_name}. It has been modified!`
            );
        }
    }
}

async function migrateUp(client) {
    const migrations = discoverMigrations();
    const applied = await fetchApplied(client);
    verifyChecksums(migrations, applied);

    const appliedNames = new Set(applied.map(r => r.migration_name));

    // Enforce ordered application: no gaps between applied and pending migrations.
    let seenPending = false;
    for (const migration of migrations) {
        const isApplied = appliedNames.has(migration.name);
        if (isApplied && seenPending) {
            throw new Error(
                `Out-of-order migration detected: ${migration.name} is applied but an earlier migration is pending.`
            );
        }
        if (!isApplied) {
            seenPending = true;
        }
    }

    for (const migration of migrations) {
        if (appliedNames.has(migration.name)) {
            console.log(`Skipping already applied migration: ${migration.name}`);
            continue;
        }

        console.log(`Applying migration: ${migration.name}`);
        await client.query('BEGIN');
        try {
            await client.query(migration.up);
            await client.query(migration.validate);
            await recordApplied(client, migration.name, migration.checksum);
            await client.query('COMMIT');
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        }
    }
    console.log('All migrations applied successfully.');
}

async function migrateDown(client, target) {
    const migrations = discoverMigrations();
    const byName = new Map(migrations.map(m => [m.name, m]));
    const applied = await fetchApplied(client);
    verifyChecksums(migrations, applied);

    const appliedNames = applied.map(r => r.migration_name);
    if (!appliedNames.includes(target)) {
        throw new Error(`Cannot roll back ${target}: migration is not applied.`);
    }

    // Only the most recently applied migration may be rolled back.
    const latest = appliedNames[appliedNames.length - 1];
    if (latest !== target) {
        throw new Error(
            `Cannot roll back ${target}: it is not the latest applied migration (latest is ${latest}).`
        );
    }

    const migration = byName.get(target);
    console.log(`Rolling back migration: ${migration.name}`);
    await client.query('BEGIN');
    try {
        await client.query(migration.down);
        await recordRolledBack(client, migration.name);
        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    }
    console.log(`Rolled back migration: ${migration.name}`);
}

async function printStatus(client) {
    const migrations = discoverMigrations();
    const applied = await fetchApplied(client);
    verifyChecksums(migrations, applied);

    const appliedNames = new Set(applied.map(r => r.migration_name));
    console.log('Migration status:');
    for (const migration of migrations) {
        const state = appliedNames.has(migration.name) ? 'applied' : 'pending';
        console.log(`  [${state}] ${migration.name}`);
    }
    for (const row of applied) {
        if (!migrations.some(m => m.name === row.migration_name)) {
            console.log(`  [orphaned] ${row.migration_name}`);
        }
    }
}

async function runMigrations() {
    const args = parseArgs(process.argv.slice(2));
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();

    try {
        await ensureMigrationsTable(client);

        if (args.mode === 'status') {
            await printStatus(client);
        } else if (args.mode === 'down') {
            await migrateDown(client, args.target);
        } else {
            await migrateUp(client);
        }
    } finally {
        await client.end();
    }
}

runMigrations().catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
});
