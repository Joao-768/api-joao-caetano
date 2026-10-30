import { query } from '../db/pool.js'

const COLUMNS = `m.id, m.user_id, m.name, m.url, m.status, m.created_at, m.paused_at,
    m.last_checked_at, m.next_check_at, m.retry_pending`

export async function listByUser(userId) {
    const { rows } = await query(
        `SELECT ${COLUMNS} FROM monitors m WHERE m.user_id = $1 ORDER BY m.created_at ASC`,
        [userId],
    )
    return rows
}

// Ownership is part of the WHERE clause: another user's ID simply finds nothing.
export async function findByIdForUser(id, userId) {
    const { rows } = await query(
        `SELECT ${COLUMNS} FROM monitors m WHERE m.id = $1 AND m.user_id = $2`,
        [id, userId],
    )
    return rows[0] ?? null
}

export async function countByUser(db, userId) {
    const { rows } = await db.query(
        'SELECT count(*)::int AS count FROM monitors WHERE user_id = $1',
        [userId],
    )
    return rows[0].count
}

export async function create(db, { userId, name, url, nextCheckAt }) {
    const { rows } = await db.query(
        `INSERT INTO monitors AS m (user_id, name, url, status, next_check_at)
         VALUES ($1, $2, $3, 'PENDING', $4)
         RETURNING ${COLUMNS}`,
        [userId, name, url, nextCheckAt],
    )
    return rows[0]
}

export async function updateName(id, userId, name) {
    const { rows } = await query(
        `UPDATE monitors AS m SET name = $3 WHERE m.id = $1 AND m.user_id = $2 RETURNING ${COLUMNS}`,
        [id, userId, name],
    )
    return rows[0] ?? null
}

export async function deleteForUser(id, userId) {
    const { rowCount } = await query('DELETE FROM monitors WHERE id = $1 AND user_id = $2', [
        id,
        userId,
    ])
    return rowCount > 0
}

// Also returns when the monitor was last resumed, so results of checks that
// started before a resume can be recognised as stale.
export async function lockById(db, id) {
    const { rows } = await db.query(
        `SELECT ${COLUMNS}, u.plan,
            (SELECT max(p.resumed_at) FROM monitor_pauses p WHERE p.monitor_id = m.id)
                AS last_resumed_at
         FROM monitors m JOIN users u ON u.id = m.user_id
         WHERE m.id = $1 FOR UPDATE OF m`,
        [id],
    )
    return rows[0] ?? null
}

export async function lockByIdForUser(db, id, userId) {
    const { rows } = await db.query(
        `SELECT ${COLUMNS}, u.plan FROM monitors m JOIN users u ON u.id = m.user_id
         WHERE m.id = $1 AND m.user_id = $2 FOR UPDATE OF m`,
        [id, userId],
    )
    return rows[0] ?? null
}

// Column names cannot be parameters, so they are checked against a fixed list.
const UPDATABLE = new Set([
    'status',
    'paused_at',
    'last_checked_at',
    'next_check_at',
    'retry_pending',
])

export async function update(db, id, fields) {
    const keys = Object.keys(fields)
    for (const key of keys) {
        if (!UPDATABLE.has(key)) throw new Error(`Column ${key} is not updatable`)
    }
    const assignments = keys.map((key, index) => `${key} = $${index + 2}`).join(', ')
    const { rows } = await db.query(
        `UPDATE monitors AS m SET ${assignments} WHERE m.id = $1 RETURNING ${COLUMNS}`,
        [id, ...keys.map((key) => fields[key])],
    )
    return rows[0] ?? null
}

// Claims up to `limit` due monitors and pushes their next_check_at forward by
// the plan interval in the same statement, which acts as a lease. SKIP LOCKED
// lets several scheduler processes share the table without double checks.
// `intervals` maps plan key -> interval in seconds.
export async function claimDue(limit, intervals) {
    const { rows } = await query(
        `WITH due AS (
            SELECT m.id FROM monitors m
            WHERE m.status <> 'PAUSED' AND m.next_check_at <= now()
            ORDER BY m.next_check_at
            LIMIT $1
            FOR UPDATE SKIP LOCKED
        )
        UPDATE monitors AS m
        SET next_check_at = now() + make_interval(secs => CASE u.plan
            WHEN 'BUSINESS' THEN $2::int
            WHEN 'PRO' THEN $3::int
            ELSE $4::int END)
        FROM due, users u
        WHERE m.id = due.id AND u.id = m.user_id
        RETURNING m.id, m.url, m.retry_pending`,
        [limit, intervals.BUSINESS, intervals.PRO, intervals.FREE],
    )
    return rows
}

export async function openPause(db, monitorId, pausedAt) {
    await db.query('INSERT INTO monitor_pauses (monitor_id, paused_at) VALUES ($1, $2)', [
        monitorId,
        pausedAt,
    ])
}

export async function closePause(db, monitorId, resumedAt) {
    await db.query(
        'UPDATE monitor_pauses SET resumed_at = $2 WHERE monitor_id = $1 AND resumed_at IS NULL',
        [monitorId, resumedAt],
    )
}

// Pause intervals of several monitors that overlap [from, to).
export async function listPausesOverlapping(monitorIds, from, to) {
    const { rows } = await query(
        `SELECT monitor_id, paused_at, resumed_at FROM monitor_pauses
         WHERE monitor_id = ANY($1::uuid[])
           AND paused_at < $3 AND COALESCE(resumed_at, 'infinity') > $2
         ORDER BY paused_at`,
        [monitorIds, from, to],
    )
    return rows
}
