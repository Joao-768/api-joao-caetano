import { query } from '../db/pool.js'

const COLUMNS = 'n.id, n.user_id, n.monitor_id, n.type, n.message, n.is_read, n.created_at'

export async function create(db, { userId, monitorId, type, message, createdAt }) {
    const { rows } = await db.query(
        `INSERT INTO notifications AS n (user_id, monitor_id, type, message, created_at)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING ${COLUMNS}`,
        [userId, monitorId, type, message, createdAt],
    )
    return rows[0]
}

export async function listForUser(userId, { unreadOnly, limit, offset }) {
    const { rows } = await query(
        `SELECT ${COLUMNS}, m.name AS monitor_name, count(*) OVER()::int AS total
         FROM notifications n LEFT JOIN monitors m ON m.id = n.monitor_id
         WHERE n.user_id = $1 ${unreadOnly ? 'AND NOT n.is_read' : ''}
         ORDER BY n.created_at DESC
         LIMIT $2 OFFSET $3`,
        [userId, limit, offset],
    )
    return { items: rows.map(({ total: _total, ...row }) => row), total: rows[0]?.total ?? 0 }
}

export async function countUnread(userId) {
    const { rows } = await query(
        'SELECT count(*)::int AS count FROM notifications WHERE user_id = $1 AND NOT is_read',
        [userId],
    )
    return rows[0].count
}

export async function setRead(id, userId, isRead) {
    const { rows } = await query(
        `UPDATE notifications AS n SET is_read = $3 WHERE n.id = $1 AND n.user_id = $2 RETURNING ${COLUMNS}`,
        [id, userId, isRead],
    )
    return rows[0] ?? null
}

export async function markAllRead(userId) {
    const { rowCount } = await query(
        'UPDATE notifications SET is_read = true WHERE user_id = $1 AND NOT is_read',
        [userId],
    )
    return rowCount
}
