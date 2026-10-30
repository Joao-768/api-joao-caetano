import type { User } from '@wae/shared'
import { pool, type Queryable } from '../db/pool'

type UserRow = {
    id: number
    name: string
    email: string
    password_hash: string
    created_at: Date
}

/** Never let password_hash leave this module. */
function toUser(row: UserRow): User {
    return { id: row.id, name: row.name, email: row.email, createdAt: row.created_at.toISOString() }
}

export async function findUserById(id: number, db: Queryable = pool): Promise<User | null> {
    const { rows } = await db.query<UserRow>('SELECT * FROM users WHERE id = $1', [id])
    return rows[0] ? toUser(rows[0]) : null
}

/** Includes the hash, for the login check only. */
export async function findCredentialsByEmail(email: string) {
    const { rows } = await pool.query<UserRow>(
        'SELECT * FROM users WHERE lower(email) = lower($1)',
        [email],
    )
    return rows[0] ? { user: toUser(rows[0]), passwordHash: rows[0].password_hash } : null
}

export async function findPasswordHash(id: number): Promise<string | null> {
    const { rows } = await pool.query<{ password_hash: string }>(
        'SELECT password_hash FROM users WHERE id = $1',
        [id],
    )
    return rows[0]?.password_hash ?? null
}

export async function createUser(input: {
    name: string
    email: string
    passwordHash: string
}): Promise<User> {
    const { rows } = await pool.query<UserRow>(
        'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING *',
        [input.name, input.email, input.passwordHash],
    )
    return toUser(rows[0])
}

export async function updateUserName(id: number, name: string): Promise<User | null> {
    const { rows } = await pool.query<UserRow>(
        'UPDATE users SET name = $2 WHERE id = $1 RETURNING *',
        [id, name],
    )
    return rows[0] ? toUser(rows[0]) : null
}

export async function updatePasswordHash(id: number, passwordHash: string): Promise<void> {
    await pool.query('UPDATE users SET password_hash = $2 WHERE id = $1', [id, passwordHash])
}
