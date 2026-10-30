// Performs one real HTTP check with Node's native fetch. Pure: it knows
// nothing about the database or monitor state, so it can run anywhere
// (this process, a queue worker, a script).

import { MONITORING } from '../config/monitoring.js'
import { assertPublicHost } from './network-guard.js'
import { classifyNetworkError, evaluateResponse } from './evaluate.js'

class TooManyRedirectsError extends Error {
    constructor() {
        super(`Too many redirects (more than ${MONITORING.maxRedirects})`)
        this.name = 'TooManyRedirectsError'
    }
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

// Returns { success, statusCode, responseTime, errorType, errorMessage }.
// Never throws for a failing target: a down site is a result, not an error.
export async function performHttpCheck(url, options = {}) {
    const timeoutMs = options.timeoutMs ?? MONITORING.requestTimeoutMs
    const signal = AbortSignal.timeout(timeoutMs)
    const startedAt = performance.now()
    const elapsed = () => Math.round(performance.now() - startedAt)

    try {
        let target = new URL(url)

        // Redirects are followed by hand so every hop passes the SSRF guard.
        for (let hop = 0; ; hop++) {
            await assertPublicHost(target.hostname)

            const response = await fetch(target, {
                method: 'GET',
                redirect: 'manual',
                signal,
                headers: {
                    'user-agent': MONITORING.userAgent,
                    accept: '*/*',
                },
            })
            // Only the status matters; do not download the body.
            await response.body?.cancel().catch(() => {})

            const location = response.headers.get('location')
            if (REDIRECT_STATUSES.has(response.status) && location) {
                if (hop >= MONITORING.maxRedirects) throw new TooManyRedirectsError()
                const next = new URL(location, target)
                if (next.protocol !== 'http:' && next.protocol !== 'https:') {
                    throw Object.assign(new Error('Redirect to unsupported protocol'), {
                        name: 'BlockedTargetError',
                    })
                }
                target = next
                continue
            }

            const responseTime = elapsed()
            const outcome = evaluateResponse({ statusCode: response.status, responseTime })
            return {
                success: outcome.success,
                statusCode: response.status,
                responseTime,
                errorType: outcome.errorType,
                errorMessage: outcome.message,
            }
        }
    } catch (error) {
        const { errorType, message } = classifyNetworkError(error)
        return {
            success: false,
            statusCode: null,
            // No response arrived, so there is no response time to record.
            responseTime: null,
            errorType,
            errorMessage: message,
        }
    }
}
