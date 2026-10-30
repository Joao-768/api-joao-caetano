// Demo data: npm run db:seed
//
// Creates demo@pulsemonitor.dev with monitors pointing at REAL public URLs and
// 30 days of plausible past history. Past history is generated here; from the
// moment the server starts, the scheduler takes over with real checks against
// the same URLs, so the states below stay true:
//   - httpbin.org/status/503 really answers 503, so "Billing API" stays DOWN;
//   - the other URLs really answer 2xx, so they stay UP;
//   - "Docs site" is PAUSED, so it is not checked at all.
//
// Idempotent: re-running removes the demo account and rebuilds it.

import { fileURLToPath } from 'node:url'
import { pool, withTransaction } from './pool.js'
import { migrate } from './migrate.js'
import { hashPassword } from '../services/password.service.js'
import { formatDuration } from '../utils/duration.js'
import { logger } from '../utils/logger.js'

export const DEMO_EMAIL = 'demo@pulsemonitor.dev'
export const DEMO_PASSWORD = 'pulse-demo-2026'

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const INTERVAL = MINUTE // demo account is on Pro: one check per minute
const RETRY_DELAY = 15 * 1000

// Deterministic PRNG so every seed run produces the same shapes.
function mulberry32(seed) {
    let a = seed
    return () => {
        a |= 0
        a = (a + 0x6d2b79f5) | 0
        let t = Math.imul(a ^ (a >>> 15), 1 | a)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

const FAILURES = {
    TIMEOUT: { errorType: 'TIMEOUT', message: 'Request timed out', statusCode: null },
    HTTP_500: { errorType: 'HTTP_5XX', message: 'HTTP 500 Internal Server Error', statusCode: 500 },
    HTTP_502: { errorType: 'HTTP_5XX', message: 'HTTP 502 Bad Gateway', statusCode: 502 },
    HTTP_503: { errorType: 'HTTP_5XX', message: 'HTTP 503 Service Unavailable', statusCode: 503 },
    REFUSED: { errorType: 'CONNECTION_REFUSED', message: 'Connection refused', statusCode: null },
    RESET: {
        errorType: 'CONNECTION_RESET',
        message: 'Connection reset by server',
        statusCode: null,
    },
    DNS: { errorType: 'DNS', message: 'DNS lookup failed: host not found', statusCode: null },
}

// ago/duration in ms relative to now. duration null = still active.
const MONITORS = [
    {
        name: 'Marketing site',
        url: 'https://example.com/',
        createdAgo: 30 * DAY,
        baseLatency: 140,
        incidents: [
            { ago: 18 * DAY + 3 * HOUR, duration: 42 * MINUTE, failure: 'TIMEOUT' },
            { ago: 4 * DAY + 7 * HOUR, duration: 7 * MINUTE, failure: 'HTTP_502' },
        ],
    },
    {
        // The status page API, not api.github.com: unauthenticated GitHub API
        // calls are rate limited per IP and answer 403 from shared cloud hosts.
        name: 'GitHub status',
        url: 'https://www.githubstatus.com/api/v2/status.json',
        createdAgo: 30 * DAY,
        baseLatency: 95,
        incidents: [{ ago: 12 * DAY + 5 * HOUR, duration: 23 * MINUTE, failure: 'HTTP_503' }],
    },
    {
        name: 'Wikipedia',
        url: 'https://en.wikipedia.org/wiki/Main_Page',
        createdAgo: 30 * DAY,
        baseLatency: 210,
        // Latency climbing over the last three days: the trend the chart should reveal.
        trend: { since: 3 * DAY, factor: 1.9 },
        incidents: [{ ago: 6 * DAY + 2 * HOUR, duration: 11 * MINUTE, failure: 'RESET' }],
        pauses: [{ ago: 9 * DAY, duration: 6 * HOUR }],
    },
    {
        name: 'Billing API (legacy)',
        url: 'https://httpbin.org/status/503',
        createdAgo: 30 * DAY,
        baseLatency: 320,
        incidents: [
            { ago: 25 * DAY + 4 * HOUR, duration: 95 * MINUTE, failure: 'HTTP_500' },
            { ago: 9 * DAY + 14 * HOUR, duration: 18 * MINUTE, failure: 'TIMEOUT' },
            { ago: 3 * DAY + 1 * HOUR, duration: 4 * MINUTE, failure: 'REFUSED' },
            { ago: 2 * HOUR + 13 * MINUTE, duration: null, failure: 'HTTP_503' },
        ],
    },
    {
        name: 'Docs site',
        url: 'https://developer.mozilla.org/en-US/',
        createdAgo: 30 * DAY,
        baseLatency: 180,
        incidents: [{ ago: 15 * DAY + 20 * HOUR, duration: 9 * MINUTE, failure: 'DNS' }],
        pausedAgo: 2 * DAY + 3 * HOUR,
    },
    {
        name: 'Edge trace',
        url: 'https://www.cloudflare.com/cdn-cgi/trace',
        createdAgo: 5 * DAY + 6 * HOUR,
        baseLatency: 45,
        incidents: [],
    },
]

function latencyAt(spec, time, now, random) {
    const hour = new Date(time).getUTCHours() + new Date(time).getUTCMinutes() / 60
    // Busier (slower) in the afternoon, UTC.
    const diurnal = 1 + 0.22 * Math.sin(((hour - 9) / 24) * 2 * Math.PI)
    // Log-normal-ish noise.
    const noise = Math.exp((random() + random() + random() - 1.5) * 0.35)
    let value = spec.baseLatency * diurnal * noise

    if (spec.trend && now - time < spec.trend.since) {
        const progress = 1 - (now - time) / spec.trend.since
        value *= 1 + (spec.trend.factor - 1) * progress
    }
    if (random() < 0.008) value *= 3 + random() * 4 // occasional spike
    return Math.max(8, Math.round(value))
}

function buildHistory(spec, monitorId, now, random) {
    const createdAt = now - spec.createdAgo
    const end = spec.pausedAgo ? now - spec.pausedAgo : now
    const incidents = spec.incidents.map((incident) => ({
        start: now - incident.ago,
        end: incident.duration === null ? null : now - incident.ago + incident.duration,
        failure: FAILURES[incident.failure],
    }))
    const pauses = (spec.pauses ?? []).map((pause) => ({
        start: now - pause.ago,
        end: now - pause.ago + pause.duration,
    }))

    const checks = []
    const push = (time, failure, isRetry, latency) => {
        checks.push({
            monitorId,
            status: failure ? 'FAILURE' : 'SUCCESS',
            statusCode: failure ? failure.statusCode : 200,
            responseTime: failure ? (failure.statusCode ? latency : null) : latency,
            errorType: failure?.errorType ?? null,
            errorMessage: failure?.message ?? null,
            isRetry,
            checkedAt: new Date(time),
        })
    }

    // First check lands a few seconds after creation, then every minute.
    for (let time = createdAt + 4000; time <= end - 1000; time += INTERVAL) {
        if (pauses.some((pause) => time >= pause.start && time < pause.end)) continue

        const incident = incidents.find(
            (item) => time >= item.start && (item.end === null || time < item.end),
        )
        const latency = latencyAt(spec, time, now, random)

        if (incident) {
            push(time, incident.failure, false, latency)
            // The first failure of an incident is confirmed by a retry.
            if (time - incident.start < INTERVAL) {
                push(time + RETRY_DELAY, incident.failure, true, latency)
            }
            continue
        }

        // Rare blips: one failure that the retry clears (no incident).
        if (random() < 0.0006) {
            const blip = random() < 0.5 ? FAILURES.TIMEOUT : FAILURES.HTTP_502
            push(time, blip, false, latency)
            push(time + RETRY_DELAY, null, true, latencyAt(spec, time, now, random))
            continue
        }
        push(time, null, false, latency)
    }

    // Align incident boundaries to the checks that actually observed them.
    const incidentRows = incidents.map((incident) => {
        const firstFailure = checks.find(
            (check) =>
                check.status === 'FAILURE' && !check.isRetry && check.checkedAt >= incident.start,
        )
        const recovery =
            incident.end === null
                ? null
                : checks.find(
                      (check) => check.status === 'SUCCESS' && check.checkedAt >= incident.end,
                  )
        return {
            monitorId,
            startedAt: firstFailure.checkedAt,
            resolvedAt: recovery ? recovery.checkedAt : null,
            reason: incident.failure.message,
        }
    })

    return { checks, incidentRows, pauses, createdAt, end }
}

async function insertChecks(db, checks) {
    const BATCH = 10_000
    for (let offset = 0; offset < checks.length; offset += BATCH) {
        const slice = checks.slice(offset, offset + BATCH)
        await db.query(
            `INSERT INTO checks
                (monitor_id, status, status_code, response_time, error_type, error_message, is_retry, checked_at)
             SELECT * FROM unnest($1::uuid[], $2::text[], $3::int[], $4::int[], $5::text[], $6::text[], $7::bool[], $8::timestamptz[])`,
            [
                slice.map((c) => c.monitorId),
                slice.map((c) => c.status),
                slice.map((c) => c.statusCode),
                slice.map((c) => c.responseTime),
                slice.map((c) => c.errorType),
                slice.map((c) => c.errorMessage),
                slice.map((c) => c.isRetry),
                slice.map((c) => c.checkedAt),
            ],
        )
    }
}

export async function seed() {
    const random = mulberry32(20260928)
    const now = Date.now()
    const passwordHash = await hashPassword(DEMO_PASSWORD)
    let totalChecks = 0

    await withTransaction(async (db) => {
        await db.query('DELETE FROM users WHERE email = $1', [DEMO_EMAIL])
        const {
            rows: [user],
        } = await db.query(
            `INSERT INTO users (email, password_hash, plan, created_at, password_changed_at)
             VALUES ($1, $2, 'PRO', $3, $3) RETURNING id`,
            [DEMO_EMAIL, passwordHash, new Date(now - 31 * DAY)],
        )

        for (const spec of MONITORS) {
            const createdAt = new Date(now - spec.createdAgo)
            const {
                rows: [monitor],
            } = await db.query(
                `INSERT INTO monitors (user_id, name, url, status, created_at, next_check_at)
                 VALUES ($1, $2, $3, 'PENDING', $4, now()) RETURNING id`,
                [user.id, spec.name, spec.url, createdAt],
            )

            const history = buildHistory(spec, monitor.id, now, random)
            await insertChecks(db, history.checks)
            totalChecks += history.checks.length

            for (const pause of history.pauses) {
                await db.query(
                    'INSERT INTO monitor_pauses (monitor_id, paused_at, resumed_at) VALUES ($1, $2, $3)',
                    [monitor.id, new Date(pause.start), new Date(pause.end)],
                )
            }

            for (const incident of history.incidentRows) {
                await db.query(
                    `INSERT INTO incidents (monitor_id, started_at, resolved_at, reason, resolution, created_at)
                     VALUES ($1, $2, $3, $4, $5, $6)`,
                    [
                        monitor.id,
                        incident.startedAt,
                        incident.resolvedAt,
                        incident.reason,
                        incident.resolvedAt ? 'RECOVERED' : null,
                        new Date(incident.startedAt.getTime() + RETRY_DELAY),
                    ],
                )
                const openedAt = new Date(incident.startedAt.getTime() + RETRY_DELAY)
                const isRecent = (time) => now - time.getTime() < 2 * DAY
                await db.query(
                    `INSERT INTO notifications (user_id, monitor_id, type, message, is_read, created_at)
                     VALUES ($1, $2, 'INCIDENT', $3, $4, $5)`,
                    [
                        user.id,
                        monitor.id,
                        `${spec.name} is down: ${incident.reason}`,
                        !isRecent(openedAt),
                        openedAt,
                    ],
                )
                if (incident.resolvedAt) {
                    const downFor = formatDuration(incident.resolvedAt - incident.startedAt)
                    await db.query(
                        `INSERT INTO notifications (user_id, monitor_id, type, message, is_read, created_at)
                         VALUES ($1, $2, 'RECOVERY', $3, $4, $5)`,
                        [
                            user.id,
                            monitor.id,
                            `${spec.name} is back up after ${downFor} of downtime`,
                            !isRecent(incident.resolvedAt),
                            incident.resolvedAt,
                        ],
                    )
                }
            }

            const lastCheck = history.checks.at(-1)
            const active = history.incidentRows.some((incident) => !incident.resolvedAt)
            if (spec.pausedAgo) {
                const pausedAt = new Date(now - spec.pausedAgo)
                await db.query(
                    'INSERT INTO monitor_pauses (monitor_id, paused_at) VALUES ($1, $2)',
                    [monitor.id, pausedAt],
                )
                await db.query(
                    `UPDATE monitors SET status = 'PAUSED', paused_at = $2, last_checked_at = $3 WHERE id = $1`,
                    [monitor.id, pausedAt, lastCheck.checkedAt],
                )
            } else {
                await db.query(
                    `UPDATE monitors SET status = $2, last_checked_at = $3, next_check_at = $4 WHERE id = $1`,
                    [
                        monitor.id,
                        active ? 'DOWN' : 'UP',
                        lastCheck.checkedAt,
                        new Date(lastCheck.checkedAt.getTime() + INTERVAL),
                    ],
                )
            }
        }
    })

    logger.info('Seed complete', {
        email: DEMO_EMAIL,
        password: DEMO_PASSWORD,
        monitors: MONITORS.length,
        checks: totalChecks,
    })
}

// For hosted demos (SEED_DEMO=true): builds the demo account only when it is
// missing, so a restart never throws away the history the scheduler has
// added since.
export async function seedIfMissing() {
    const { rows } = await pool.query('SELECT 1 FROM users WHERE email = $1', [DEMO_EMAIL])
    if (rows.length > 0) return false
    await seed()
    return true
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    migrate()
        .then(seed)
        .then(() => pool.end())
        .catch((error) => {
            logger.error('Seed failed', { error: error.message, stack: error.stack })
            process.exit(1)
        })
}
