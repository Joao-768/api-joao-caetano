import fs from 'node:fs'
import path from 'node:path'
import type { Pool } from 'pg'
import { pool } from './pool'
import { logger } from '../lib/logger'

/**
 * A deliberately small migration runner.
 *
 * Migrations are plain SQL files in backend/migrations, applied in file-name
 * order. Each one runs in its own transaction and is recorded in
 * `schema_migrations`, so running the command again only applies new files.
 * An advisory lock stops two processes (say, two deploys) from migrating at
 * the same time.
 */

// Same relative location from src/db (tsx) and dist/db (compiled).
const MIGRATIONS_DIR = path.resolve(__dirname, '../../migrations')
const LOCK_ID = 7_314_202

export async function runMigrations(db: Pool = pool): Promise<string[]> {
    const client = await db.connect()
    const applied: string[] = []
    try {
        await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID])
        await client.query(`
            CREATE TABLE IF NOT EXISTS schema_migrations (
                name TEXT PRIMARY KEY,
                applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        `)

        const done = new Set(
            (await client.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map(
                (r) => r.name,
            ),
        )
        const files = fs
            .readdirSync(MIGRATIONS_DIR)
            .filter((file) => file.endsWith('.sql'))
            .sort()

        for (const file of files) {
            if (done.has(file)) continue
            const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8')
            try {
                await client.query('BEGIN')
                await client.query(sql)
                await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file])
                await client.query('COMMIT')
                applied.push(file)
                logger.info({ migration: file }, 'Migration applied')
            } catch (err) {
                await client.query('ROLLBACK')
                throw new Error(`Migration ${file} failed: ${(err as Error).message}`)
            }
        }
    } finally {
        await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => undefined)
        client.release()
    }
    return applied
}

if (require.main === module) {
    runMigrations()
        .then((applied) => {
            logger.info(
                { applied: applied.length },
                applied.length ? 'Migrations complete' : 'Database already up to date',
            )
        })
        .catch((err) => {
            logger.error({ err }, 'Migration failed')
            process.exitCode = 1
        })
        .finally(() => pool.end())
}
