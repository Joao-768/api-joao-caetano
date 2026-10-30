import { rateLimit, type Options } from 'express-rate-limit'
import type { ApiErrorBody } from '@wae/shared'
import { env } from '../config/env'

/**
 * Rate limits for the endpoints that are public or worth guessing at.
 * They are in-memory, per API instance: enough for one instance, and the
 * README says so. Disabled in tests so suites can hammer the API.
 */
function limiter(windowMs: number, limit: number, keyGenerator?: Options['keyGenerator']) {
    return rateLimit({
        windowMs,
        limit,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        skip: () => env.NODE_ENV === 'test',
        ...(keyGenerator ? { keyGenerator } : {}),
        handler: (_req, res) => {
            res.status(429).json({
                error: {
                    code: 'rate_limited',
                    message: 'Too many requests, slow down and try again shortly',
                },
            } satisfies ApiErrorBody)
        },
    })
}

/** Login and registration: slows down credential stuffing. */
export const authLimiter = limiter(15 * 60_000, 30)

/** Public webhooks: per webhook id, so one noisy sender cannot starve others. */
export const webhookLimiter = limiter(60_000, 60, (req) => `webhook:${req.params.webhookId ?? ''}`)

/** Anything that starts executions from the private API. */
export const triggerLimiter = limiter(60_000, 120)
