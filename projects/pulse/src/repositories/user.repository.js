import { query } from '../db/pool.js'

const PUBLIC_COLUMNS = 'id, email, plan, password_changed_at, created_at'

export async function findByEmail(email) {
    const { rows } = await query(
        `SELECT ${PUBLIC_COLUMNS}, password_hash FROM users WHERE email = $1`,
        [email],
    )
    return rows[0] ?? null
}

export async function findById(id, db = { query }) {
    const { rows } = await db.query(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = $1`, [id])
    return rows[0] ?? null
}

// Locks the user row so plan-limit checks and inserts cannot race.
export async function lockById(db, id) {
    const { rows } = await db.query(
        `SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = $1 FOR UPDATE`,
        [id],
    )
    return rows[0] ?? null
}

export async function create({ email, passwordHash, plan }) {
    const { rows } = await query(
        `INSERT INTO users (email, password_hash, plan)
         VALUES ($1, $2, $3)
         RETURNING ${PUBLIC_COLUMNS}`,
        [email, passwordHash, plan],
    )
    return rows[0]
}

export async function updatePassword(db, userId, passwordHash) {
    await db.query(
        `UPDATE users SET password_hash = $2, password_changed_at = now() WHERE id = $1`,
        [userId, passwordHash],
    )
}
