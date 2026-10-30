import { query } from '../db/pool.js'

const COLUMNS = `id, monitor_id, status, status_code, response_time, error_type, error_message,
    is_retry, checked_at`

export async function insert(db, check) {
    const { rows } = await db.query(
        `INSERT INTO checks
            (monitor_id, status, status_code, response_time, error_type, error_message, is_retry, checked_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING ${COLUMNS}`,
        [
            check.monitorId,
            check.status,
            check.statusCode,
            check.responseTime,
            check.errorType,
            check.errorMessage,
            check.isRetry,
            check.checkedAt,
        ],
    )
    return rows[0]
}

// Start of the failure streak that led to an incident: the latest failed
// normal (non-retry) check at or before `before`.
export async function lastFailedNormalCheck(db, monitorId, before) {
    const { rows } = await db.query(
        `SELECT checked_at, error_message FROM checks
         WHERE monitor_id = $1 AND status = 'FAILURE' AND NOT is_retry AND checked_at <= $2
         ORDER BY checked_at DESC LIMIT 1`,
        [monitorId, before],
    )
    return rows[0] ?? null
}

const FILTERS = {
    all: '',
    failures: `AND status = 'FAILURE'`,
    retries: 'AND is_retry',
}

export async function listPage(monitorId, { from, to, filter = 'all', limit, offset }) {
    const where = FILTERS[filter] ?? ''
    const { rows } = await query(
        `SELECT ${COLUMNS}, count(*) OVER()::int AS total FROM checks
         WHERE monitor_id = $1 AND checked_at >= $2 AND checked_at <= $3 ${where}
         ORDER BY checked_at DESC, id DESC
         LIMIT $4 OFFSET $5`,
        [monitorId, from, to, limit, offset],
    )
    return { items: rows.map(({ total: _total, ...row }) => row), total: rows[0]?.total ?? 0 }
}

// Totals for one monitor in [from, to]. Average and p95 use successful checks
// only: a failed request has no meaningful response time.
export async function stats(monitorId, from, to) {
    const { rows } = await query(
        `SELECT
            count(*)::int AS total,
            count(*) FILTER (WHERE status = 'FAILURE')::int AS failures,
            count(*) FILTER (WHERE is_retry)::int AS retries,
            round(avg(response_time) FILTER (WHERE status = 'SUCCESS'))::int AS avg_response_time,
            round(percentile_cont(0.95) WITHIN GROUP (ORDER BY response_time)
                FILTER (WHERE status = 'SUCCESS'))::int AS p95_response_time,
            min(response_time) FILTER (WHERE status = 'SUCCESS') AS min_response_time,
            max(response_time) FILTER (WHERE status = 'SUCCESS') AS max_response_time
         FROM checks
         WHERE monitor_id = $1 AND checked_at >= $2 AND checked_at <= $3`,
        [monitorId, from, to],
    )
    return rows[0]
}

// Response time series bucketed with date_bin (PostgreSQL 14+).
export async function responseTimeBuckets(monitorId, from, to, bucketSeconds) {
    const { rows } = await query(
        `SELECT
            date_bin(make_interval(secs => $4), checked_at, $2::timestamptz) AS bucket,
            round(avg(response_time) FILTER (WHERE status = 'SUCCESS'))::int AS avg_response_time,
            max(response_time) FILTER (WHERE status = 'SUCCESS') AS max_response_time,
            count(*)::int AS checks,
            count(*) FILTER (WHERE status = 'FAILURE')::int AS failures
         FROM checks
         WHERE monitor_id = $1 AND checked_at >= $2 AND checked_at <= $3
         GROUP BY bucket
         ORDER BY bucket`,
        [monitorId, from, to, bucketSeconds],
    )
    return rows
}

// Hourly aggregates for many monitors at once (dashboard).
export async function hourlyBucketsForMonitors(monitorIds, from, to) {
    const { rows } = await query(
        `SELECT
            monitor_id,
            date_bin(interval '1 hour', checked_at, $2::timestamptz) AS bucket,
            round(avg(response_time) FILTER (WHERE status = 'SUCCESS'))::int AS avg_response_time,
            count(*)::int AS checks,
            count(*) FILTER (WHERE status = 'FAILURE')::int AS failures
         FROM checks
         WHERE monitor_id = ANY($1::uuid[]) AND checked_at >= $2 AND checked_at <= $3
         GROUP BY monitor_id, bucket`,
        [monitorIds, from, to],
    )
    return rows
}

export async function latestForMonitors(monitorIds) {
    const { rows } = await query(
        `SELECT DISTINCT ON (monitor_id) ${COLUMNS} FROM checks
         WHERE monitor_id = ANY($1::uuid[])
         ORDER BY monitor_id, checked_at DESC`,
        [monitorIds],
    )
    return rows
}

// Most frequent failure reasons in a window ("relevant errors").
export async function topErrors(monitorId, from, to, limit = 5) {
    const { rows } = await query(
        `SELECT error_type, error_message, count(*)::int AS occurrences, max(checked_at) AS last_seen
         FROM checks
         WHERE monitor_id = $1 AND status = 'FAILURE' AND checked_at >= $2 AND checked_at <= $3
         GROUP BY error_type, error_message
         ORDER BY occurrences DESC, last_seen DESC
         LIMIT $4`,
        [monitorId, from, to, limit],
    )
    return rows
}

// Keyset pagination for streaming exports without loading everything.
export async function exportBatch(monitorId, from, to, after, limit) {
    const { rows } = await query(
        `SELECT ${COLUMNS} FROM checks
         WHERE monitor_id = $1 AND checked_at >= $2 AND checked_at <= $3
           AND ($4::timestamptz IS NULL OR (checked_at, id) > ($4::timestamptz, $5::bigint))
         ORDER BY checked_at, id
         LIMIT $6`,
        [monitorId, from, to, after?.checkedAt ?? null, after?.id ?? 0, limit],
    )
    return rows
}
