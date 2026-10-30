// Plan limits live in code, not in a `plans` table: they change with a deploy,
// never at runtime, and the users.plan CHECK constraint keeps the keys in sync.

export const PLANS = {
    FREE: {
        key: 'FREE',
        name: 'Free',
        maxMonitors: 5,
        checkIntervalSeconds: 300,
        retentionDays: 7,
        available: true,
    },
    PRO: {
        key: 'PRO',
        name: 'Pro',
        maxMonitors: 25,
        checkIntervalSeconds: 60,
        retentionDays: 90,
        available: false,
    },
    BUSINESS: {
        key: 'BUSINESS',
        name: 'Business',
        maxMonitors: 100,
        checkIntervalSeconds: 30,
        retentionDays: 365,
        available: false,
    },
}

export const DEFAULT_PLAN = 'FREE'

export function getPlan(key) {
    return PLANS[key] ?? PLANS[DEFAULT_PLAN]
}

// Earliest moment whose history the plan still keeps.
export function retentionStart(planKey, now = new Date()) {
    const days = getPlan(planKey).retentionDays
    return new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
}
