import { query } from '../db/pool.js'

const COLUMNS =
    'i.id, i.monitor_id, i.started_at, i.resolved_at, i.reason, i.resolution, i.created_at'

export async function findActive(db, monitorId) {
    const { rows } = await db.query(
        `SELECT ${COLUMNS} FROM incidents i WHERE i.monitor_id = $1 AND i.resolved_at IS NULL`,
        [monitorId],
    )
    return rows[0] ?? null
}

// The partial unique index incidents_one_active makes a second active
// incident impossible; ON CONFLICT keeps this idempotent.
export async function open(db, { monitorId, startedAt, reason }) {
    const { rows } = await db.query(
        `INSERT INTO incidents AS i (monitor_id, started_at, reason)
         VALUES ($1, $2, $3)
         ON CONFLICT (monitor_id) WHERE resolved_at IS NULL DO NOTHING
         RETURNING ${COLUMNS}`,
        [monitorId, startedAt, reason],
    )
    return rows[0] ?? null
}

export async function closeActive(db, monitorId, resolvedAt, resolution) {
    const { rows } = await db.query(
        `UPDATE incidents AS i SET resolved_at = GREATEST($2, i.started_at), resolution = $3
         WHERE i.monitor_id = $1 AND i.resolved_at IS NULL
         RETURNING ${COLUMNS}`,
        [monitorId, resolvedAt, resolution],
    )
    return rows[0] ?? null
}

// Incidents of several monitors overlapping [from, to).
export async function listOverlapping(monitorIds, from, to) {
    const { rows } = await query(
        `SELECT ${COLUMNS} FROM incidents i
         WHERE i.monitor_id = ANY($1::uuid[])
           AND i.started_at < $3 AND COALESCE(i.resolved_at, 'infinity') > $2
         ORDER BY i.started_at DESC`,
        [monitorIds, from, to],
    )
    return rows
}

export async function listForUser(userId, { status, limit, offset }) {
    const where =
        status === 'active'
            ? 'AND i.resolved_at IS NULL'
            : status === 'resolved'
              ? 'AND i.resolved_at IS NOT NULL'
              : ''
    const { rows } = await query(
        `SELECT ${COLUMNS}, m.name AS monitor_name, m.url AS monitor_url, count(*) OVER()::int AS total
         FROM incidents i JOIN monitors m ON m.id = i.monitor_id
         WHERE m.user_id = $1 ${where}
         ORDER BY (i.resolved_at IS NULL) DESC, i.started_at DESC
         LIMIT $2 OFFSET $3`,
        [userId, limit, offset],
    )
    return { items: rows.map(({ total: _total, ...row }) => row), total: rows[0]?.total ?? 0 }
}

export async function exportForMonitor(monitorId, from, to) {
    return listOverlapping([monitorId], from, to)
}
