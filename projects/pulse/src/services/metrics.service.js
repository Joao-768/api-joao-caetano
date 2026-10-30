import { getPlan } from '../config/plans.js'
import * as checkRepository from '../repositories/check.repository.js'
import * as incidentRepository from '../repositories/incident.repository.js'
import * as monitorRepository from '../repositories/monitor.repository.js'
import { computeAvailability, computeTimeline } from './availability.js'
import { resolvePeriod } from './period.js'
import { toPublicMonitor } from './monitor.service.js'

const DAY_MS = 24 * 60 * 60 * 1000

export function toPublicIncident(incident, now = new Date()) {
    const end = incident.resolved_at ? new Date(incident.resolved_at) : now
    return {
        id: incident.id,
        monitorId: incident.monitor_id,
        monitorName: incident.monitor_name,
        monitorUrl: incident.monitor_url,
        startedAt: incident.started_at,
        resolvedAt: incident.resolved_at,
        resolution: incident.resolution,
        reason: incident.reason,
        durationMs: end - new Date(incident.started_at),
        active: incident.resolved_at === null,
    }
}

export function toPublicCheck(check) {
    return {
        id: String(check.id),
        status: check.status,
        statusCode: check.status_code,
        responseTime: check.response_time,
        errorType: check.error_type,
        errorMessage: check.error_message,
        isRetry: check.is_retry,
        checkedAt: check.checked_at,
    }
}

// Everything the monitor page needs for one period.
export async function getMonitorMetrics(monitor, plan, periodKey) {
    const period = resolvePeriod(periodKey, { plan, monitorCreatedAt: monitor.created_at })
    const ids = [monitor.id]

    const [pauses, incidents, stats, series, topErrors] = await Promise.all([
        monitorRepository.listPausesOverlapping(ids, period.from, period.to),
        incidentRepository.listOverlapping(ids, period.from, period.to),
        checkRepository.stats(monitor.id, period.from, period.to),
        checkRepository.responseTimeBuckets(
            monitor.id,
            period.dataFrom,
            period.to,
            period.bucketSeconds,
        ),
        checkRepository.topErrors(monitor.id, period.from, period.to),
    ])

    const availability = computeAvailability({
        from: period.from,
        to: period.to,
        createdAt: monitor.created_at,
        pauses,
        incidents,
    })
    const timeline = computeTimeline({
        from: period.timelineFrom,
        to: period.to,
        bucketCount: period.timelineBuckets,
        createdAt: monitor.created_at,
        pauses,
        incidents,
    })

    return {
        period: {
            key: period.key,
            from: period.from,
            to: period.to,
            dataFrom: period.dataFrom,
            limitedByRetention: period.limitedByRetention,
            retentionDays: getPlan(plan).retentionDays,
            bucketSeconds: period.bucketSeconds,
        },
        availability,
        checks: {
            total: stats.total,
            failures: stats.failures,
            retries: stats.retries,
            avgResponseTime: stats.avg_response_time,
            p95ResponseTime: stats.p95_response_time,
            minResponseTime: stats.min_response_time,
            maxResponseTime: stats.max_response_time,
        },
        incidentCount: incidents.length,
        responseTime: series.map((bucket) => ({
            at: bucket.bucket,
            avg: bucket.avg_response_time,
            max: bucket.max_response_time,
            checks: bucket.checks,
            failures: bucket.failures,
        })),
        timeline: timeline.map((bucket) => ({
            from: bucket.from,
            to: bucket.to,
            state: bucket.state,
            uptimePercent: bucket.uptimePercent,
        })),
        topErrors: topErrors.map((row) => ({
            errorType: row.error_type,
            message: row.error_message,
            occurrences: row.occurrences,
            lastSeen: row.last_seen,
        })),
    }
}

// Dashboard: every monitor with its last 24 hours, using a fixed number of
// queries regardless of how many monitors the user has.
export async function getDashboard(userId) {
    const monitors = await monitorRepository.listByUser(userId)
    const now = new Date()
    const from = new Date(now.getTime() - DAY_MS)
    const ids = monitors.map((monitor) => monitor.id)

    if (ids.length === 0) {
        return { summary: summarize([], []), monitors: [] }
    }

    const [pauses, incidents, hourly, latest, activeIncidents] = await Promise.all([
        monitorRepository.listPausesOverlapping(ids, from, now),
        incidentRepository.listOverlapping(ids, from, now),
        checkRepository.hourlyBucketsForMonitors(ids, from, now),
        checkRepository.latestForMonitors(ids),
        incidentRepository.listOverlapping(ids, now, new Date(now.getTime() + 1)),
    ])

    const group = (rows) => {
        const map = new Map()
        for (const row of rows) {
            if (!map.has(row.monitor_id)) map.set(row.monitor_id, [])
            map.get(row.monitor_id).push(row)
        }
        return map
    }
    const pausesByMonitor = group(pauses)
    const incidentsByMonitor = group(incidents)
    const hourlyByMonitor = group(hourly)
    const latestByMonitor = new Map(latest.map((row) => [row.monitor_id, row]))
    const activeByMonitor = new Map(
        activeIncidents.filter((row) => !row.resolved_at).map((row) => [row.monitor_id, row]),
    )

    const rows = monitors.map((monitor) => {
        const monitorPauses = pausesByMonitor.get(monitor.id) ?? []
        const monitorIncidents = incidentsByMonitor.get(monitor.id) ?? []
        const availability = computeAvailability({
            from,
            to: now,
            createdAt: monitor.created_at,
            pauses: monitorPauses,
            incidents: monitorIncidents,
        })
        const timeline = computeTimeline({
            from,
            to: now,
            bucketCount: 24,
            createdAt: monitor.created_at,
            pauses: monitorPauses,
            incidents: monitorIncidents,
        })

        const buckets = hourlyByMonitor.get(monitor.id) ?? []
        const totalChecks = buckets.reduce((sum, bucket) => sum + bucket.checks, 0)
        const weighted = buckets.filter((bucket) => bucket.avg_response_time !== null)
        const successCount = weighted.reduce(
            (sum, bucket) => sum + bucket.checks - bucket.failures,
            0,
        )
        const avgResponseTime = successCount
            ? Math.round(
                  weighted.reduce(
                      (sum, bucket) =>
                          sum + bucket.avg_response_time * (bucket.checks - bucket.failures),
                      0,
                  ) / successCount,
              )
            : null

        const lastCheck = latestByMonitor.get(monitor.id)
        const activeIncident = activeByMonitor.get(monitor.id)

        return {
            ...toPublicMonitor(monitor),
            uptime24h: availability.uptimePercent,
            downtime24hMs: availability.downtimeMs,
            avgResponseTime24h: avgResponseTime,
            checks24h: totalChecks,
            timeline: timeline.map((bucket) => ({
                from: bucket.from,
                state: bucket.state,
                uptimePercent: bucket.uptimePercent,
            })),
            responseTime: buckets
                .filter((bucket) => bucket.avg_response_time !== null)
                .sort((a, b) => a.bucket - b.bucket)
                .map((bucket) => ({ at: bucket.bucket, avg: bucket.avg_response_time })),
            lastCheck: lastCheck ? toPublicCheck(lastCheck) : null,
            activeIncident: activeIncident ? toPublicIncident(activeIncident, now) : null,
        }
    })

    return { summary: summarize(rows, incidents), monitors: rows }
}

function summarize(rows, incidents) {
    const counts = { UP: 0, DOWN: 0, PAUSED: 0, PENDING: 0 }
    for (const row of rows) counts[row.status] += 1

    const measured = rows.filter((row) => row.uptime24h !== null)
    return {
        total: rows.length,
        up: counts.UP,
        down: counts.DOWN,
        paused: counts.PAUSED,
        pending: counts.PENDING,
        // Average of per-monitor uptime, paused monitors excluded.
        uptime24h: measured.length
            ? measured.reduce((sum, row) => sum + row.uptime24h, 0) / measured.length
            : null,
        incidents24h: incidents.length,
    }
}
