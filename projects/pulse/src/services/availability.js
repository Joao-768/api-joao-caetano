// Uptime and downtime are derived, never stored: they depend on the period.
//
// For a window [from, to):
//   observed   = [max(from, monitor.created_at), to)
//   paused     = time inside observed covered by pause intervals
//   monitored  = observed - paused
//   downtime   = time inside observed covered by incidents
//   uptime %   = (monitored - downtime) / monitored * 100
//
// Incidents are closed when a monitor is paused, so incident time and pause
// time never overlap and downtime can never exceed monitored time. A single
// failed check that recovers on its retry opens no incident and so costs no
// downtime: it is a blip, visible in the check history.

function overlapMs(start, end, windowStart, windowEnd) {
    const from = Math.max(start, windowStart)
    const to = Math.min(end, windowEnd)
    return Math.max(0, to - from)
}

function toMs(value, fallback) {
    return value ? new Date(value).getTime() : fallback
}

export function computeAvailability({ from, to, createdAt, pauses, incidents }) {
    const windowEnd = to.getTime()
    const windowStart = Math.max(from.getTime(), new Date(createdAt).getTime())

    if (windowStart >= windowEnd) {
        return { monitoredMs: 0, pausedMs: 0, downtimeMs: 0, uptimeMs: 0, uptimePercent: null }
    }

    let pausedMs = 0
    for (const pause of pauses) {
        pausedMs += overlapMs(
            toMs(pause.paused_at),
            toMs(pause.resumed_at, windowEnd),
            windowStart,
            windowEnd,
        )
    }

    let downtimeMs = 0
    for (const incident of incidents) {
        downtimeMs += overlapMs(
            toMs(incident.started_at),
            toMs(incident.resolved_at, windowEnd),
            windowStart,
            windowEnd,
        )
    }

    const monitoredMs = Math.max(0, windowEnd - windowStart - pausedMs)
    downtimeMs = Math.min(downtimeMs, monitoredMs)
    const uptimeMs = monitoredMs - downtimeMs

    return {
        monitoredMs,
        pausedMs,
        downtimeMs,
        uptimeMs,
        uptimePercent: monitoredMs > 0 ? (uptimeMs / monitoredMs) * 100 : null,
    }
}

// Splits [from, to) into equal buckets with a state each, for status strips.
// state: 'none' (not monitored yet), 'paused', 'up', 'partial' or 'down'.
export function computeTimeline({ from, to, bucketCount, createdAt, pauses, incidents }) {
    const start = from.getTime()
    const size = (to.getTime() - start) / bucketCount
    const buckets = []

    for (let index = 0; index < bucketCount; index++) {
        const bucketFrom = new Date(start + index * size)
        const bucketTo = new Date(start + (index + 1) * size)
        const availability = computeAvailability({
            from: bucketFrom,
            to: bucketTo,
            createdAt,
            pauses,
            incidents,
        })

        let state
        if (availability.monitoredMs === 0) {
            state = availability.pausedMs > 0 ? 'paused' : 'none'
        } else if (availability.downtimeMs === 0) {
            state = 'up'
        } else if (availability.downtimeMs >= availability.monitoredMs * 0.999) {
            state = 'down'
        } else {
            state = 'partial'
        }

        buckets.push({
            from: bucketFrom,
            to: bucketTo,
            state,
            uptimePercent: availability.uptimePercent,
            downtimeMs: availability.downtimeMs,
        })
    }
    return buckets
}
