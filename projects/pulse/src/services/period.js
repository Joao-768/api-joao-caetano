import { retentionStart } from '../config/plans.js'
import { badRequest } from '../utils/errors.js'

const HOUR = 3600
const DAY = 24 * HOUR

export const PERIODS = {
    '24h': { seconds: DAY, bucketSeconds: 10 * 60, timelineBuckets: 48 },
    '7d': { seconds: 7 * DAY, bucketSeconds: HOUR, timelineBuckets: 84 },
    '30d': { seconds: 30 * DAY, bucketSeconds: 4 * HOUR, timelineBuckets: 90 },
    all: { seconds: null, bucketSeconds: null, timelineBuckets: 90 },
}

// Chart bucket sizes, picked so a series stays near 180 points. A monitor
// younger than the period gets finer buckets instead of a handful of points.
const NICE_BUCKETS = [
    60,
    120,
    300,
    600,
    900,
    1800,
    HOUR,
    2 * HOUR,
    4 * HOUR,
    6 * HOUR,
    12 * HOUR,
    DAY,
]

function niceBucketSeconds(spanSeconds) {
    const target = spanSeconds / 180
    return NICE_BUCKETS.find((size) => size >= target) ?? DAY
}

// Resolves ?period= into a concrete window for one monitor:
//  - never earlier than what the plan still retains ("All" = all of it);
//  - never earlier than the monitor's creation.
export function resolvePeriod(periodKey, { plan, monitorCreatedAt, now = new Date() }) {
    const key = periodKey ?? '24h'
    const definition = PERIODS[key]
    if (!definition) throw badRequest('Period must be one of 24h, 7d, 30d or all.')

    const retainedFrom = retentionStart(plan, now)
    const requestedFrom = definition.seconds
        ? new Date(now.getTime() - definition.seconds * 1000)
        : retainedFrom
    const limitedByRetention = requestedFrom < retainedFrom
    const from = limitedByRetention ? retainedFrom : requestedFrom

    // Data can only exist since creation; the window starts there if later.
    const created = new Date(monitorCreatedAt)
    const dataFrom = created > from ? created : from
    const spanSeconds = Math.max(60, (now.getTime() - dataFrom.getTime()) / 1000)

    return {
        key,
        from,
        to: now,
        dataFrom,
        limitedByRetention,
        bucketSeconds: Math.min(definition.bucketSeconds ?? DAY, niceBucketSeconds(spanSeconds)),
        // The status strip covers the whole period, except "All", which starts
        // where the data starts.
        timelineFrom: key === 'all' ? dataFrom : from,
        timelineBuckets: definition.timelineBuckets,
    }
}
