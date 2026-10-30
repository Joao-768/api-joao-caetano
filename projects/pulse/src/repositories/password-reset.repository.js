import { query } from '../db/pool.js'

export async function create({ userId, tokenHash, expiresAt }) {
    await query(
        `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
        [userId, tokenHash, expiresAt],
    )
}

// Locks the token so two concurrent resets cannot both use it.
export async function lockUsableByHash(db, tokenHash) {
    const { rows } = await db.query(
        `SELECT id, user_id FROM password_reset_tokens
         WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
         FOR UPDATE`,
        [tokenHash],
    )
    return rows[0] ?? null
}

export async function findUsableByHash(tokenHash) {
    const { rows } = await query(
        `SELECT id FROM password_reset_tokens
         WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`,
        [tokenHash],
    )
    return rows[0] ?? null
}

// Burns every outstanding token of the user, the used one included.
export async function markAllUsedForUser(db, userId) {
    await db.query(
        `UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`,
        [userId],
    )
}

export async function deleteExpired() {
    const { rowCount } = await query(
        `DELETE FROM password_reset_tokens WHERE expires_at < now() - interval '1 day'`,
    )
    return rowCount
}
