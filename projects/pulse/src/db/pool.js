import pg from 'pg'
import { env } from '../config/env.js'
import { logger } from '../utils/logger.js'

// Return BIGINT/COUNT(*) as JS numbers. Values here never exceed 2^53.
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number.parseInt(value, 10))
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value) => Number.parseFloat(value))

export const pool = new pg.Pool({
    connectionString: env.databaseUrl,
    ssl: env.databaseSsl ? { rejectUnauthorized: false } : false,
    max: 10,
})

pool.on('error', (error) => {
    logger.error('Idle PostgreSQL client error', { error: error.message })
})

// All queries go through here, always with parameters ($1, $2, ...).
export function query(text, params = []) {
    return pool.query(text, params)
}

// Runs fn inside a transaction with a dedicated client.
export async function withTransaction(fn) {
    const client = await pool.connect()
    try {
        await client.query('BEGIN')
        const result = await fn(client)
        await client.query('COMMIT')
        return result
    } catch (error) {
        await client.query('ROLLBACK')
        throw error
    } finally {
        client.release()
    }
}
