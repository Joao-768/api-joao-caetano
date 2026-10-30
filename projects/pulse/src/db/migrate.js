// Applies every .sql file in migrations/ that has not run yet, in name order,
// each inside its own transaction.

import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pool } from './pool.js'
import { logger } from '../utils/logger.js'

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations')

export async function migrate() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            name       TEXT PRIMARY KEY,
            applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    `)

    const { rows } = await pool.query('SELECT name FROM schema_migrations')
    const applied = new Set(rows.map((row) => row.name))
    const files = (await readdir(migrationsDir)).filter((file) => file.endsWith('.sql')).sort()

    for (const file of files) {
        if (applied.has(file)) continue
        const sql = await readFile(path.join(migrationsDir, file), 'utf8')
        const client = await pool.connect()
        try {
            await client.query('BEGIN')
            await client.query(sql)
            await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file])
            await client.query('COMMIT')
            logger.info('Applied migration', { file })
        } catch (error) {
            await client.query('ROLLBACK')
            throw new Error(`Migration ${file} failed: ${error.message}`)
        } finally {
            client.release()
        }
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    migrate()
        .then(() => {
            logger.info('Migrations up to date')
            return pool.end()
        })
        .catch((error) => {
            logger.error(error.message)
            process.exit(1)
        })
}
