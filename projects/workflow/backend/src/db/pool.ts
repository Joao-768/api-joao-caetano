import { Pool, type PoolClient } from 'pg'
import { env } from '../config/env'
import { logger } from '../lib/logger'

// Managed Postgres (Supabase, Render) requires SSL; local development does not.
export const pool = new Pool({
    connectionString: env.DATABASE_URL,
    ...(env.DATABASE_SSL ? { ssl: { rejectUnauthorized: false } } : {}),
    max: 10,
})

pool.on('error', (err) => logger.error({ err }, 'Idle Postgres client error'))

/** Anything that can run a query: the pool itself or a client inside a transaction. */
export type Queryable = Pick<Pool | PoolClient, 'query'>

/**
 * Runs `work` inside BEGIN / COMMIT, rolling back if it throws. Use it
 * whenever several writes must succeed or fail together.
 */
export async function transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect()
    try {
        await client.query('BEGIN')
        const result = await work(client)
        await client.query('COMMIT')
        return result
    } catch (err) {
        await client.query('ROLLBACK')
        throw err
    } finally {
        client.release()
    }
}

/**
 * Serialises a value for a JSONB parameter. Passing objects straight to `pg`
 * works, but arrays would be sent as Postgres arrays, so every JSONB value
 * goes through here.
 */
export function json(value: unknown): string | null {
    return value === undefined ? null : JSON.stringify(value)
}
