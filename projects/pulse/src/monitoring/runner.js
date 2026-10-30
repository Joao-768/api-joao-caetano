// Runs checks: HTTP request, then record the result. Knows nothing about
// *when* checks run; the cron scheduler (or a future queue worker) decides.

import { env } from '../config/env.js'
import { MONITORING } from '../config/monitoring.js'
import { logger } from '../utils/logger.js'
import { checkerIsOnline, isNetworkLevelFailure } from './connectivity.js'
import { performHttpCheck } from './http-check.js'
import { recordCheckResult } from './record-result.js'

const inFlight = new Set()
// Monitors that asked for an immediate check while one was already running
// (a resume during a scheduled check). They run again once it finishes.
const rerunQueue = new Map()

export function inFlightCount() {
    return inFlight.size
}

export function availableSlots() {
    return Math.max(0, MONITORING.concurrency - inFlight.size)
}

// Executes one check for a monitor. Resolves when the result is stored.
// Errors are logged, never thrown: a failing check must not crash the loop.
export async function runCheck({ id, url, isRetry = false }, { rerunIfBusy = false } = {}) {
    if (inFlight.has(id)) {
        if (rerunIfBusy) rerunQueue.set(id, url)
        return null
    }
    inFlight.add(id)

    try {
        const checkedAt = new Date()
        const result = await performHttpCheck(url)
        const wallMs = Date.now() - checkedAt.getTime()
        logger.debug('Check finished', {
            monitorId: id,
            isRetry,
            success: result.success,
            statusCode: result.statusCode,
            responseTime: result.responseTime,
            error: result.errorMessage,
        })
        // A request that took far longer than its own timeout means this
        // process was suspended (host asleep) mid-check: the failure says
        // nothing about the target.
        if (isNetworkLevelFailure(result) && wallMs > MONITORING.requestTimeoutMs * 1.5) {
            logger.warn('Check outlived its timeout; checker was suspended', {
                monitorId: id,
                wallMs,
            })
            return { discarded: 'checker-suspended' }
        }
        // Private targets (local development) do not depend on internet access.
        if (
            isNetworkLevelFailure(result) &&
            !env.allowPrivateTargets &&
            !(await checkerIsOnline())
        ) {
            return { discarded: 'checker-offline' }
        }
        return await recordCheckResult({ monitorId: id, isRetry, checkedAt, result })
    } catch (error) {
        // Application error (database down, bug), not a monitored-site failure.
        logger.error('Check pipeline failed', { monitorId: id, error: error.message })
        return null
    } finally {
        inFlight.delete(id)
        const rerunUrl = rerunQueue.get(id)
        if (rerunUrl !== undefined) {
            rerunQueue.delete(id)
            runCheckInBackground({ id, url: rerunUrl })
        }
    }
}

// Fire-and-forget variant for "check right now" after create and resume. If a
// check of the same monitor is already running, it runs again right after.
export function runCheckInBackground(monitor) {
    runCheck(monitor, { rerunIfBusy: true }).catch(() => {})
}

// Waits for in-flight checks during shutdown, up to a limit.
export async function drain(timeoutMs = 12_000) {
    const deadline = Date.now() + timeoutMs
    while (inFlight.size > 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 100))
    }
}
