import rateLimit from 'express-rate-limit'
import { env } from '../config/env.js'
import { AppError } from '../utils/errors.js'

// CSRF defense on top of SameSite=Lax cookies: state-changing requests must
// come from our own origin. Browsers always send Origin on cross-site POSTs.
const allowedOrigins = new Set([env.appUrl])

export function requireSameOrigin(req, _res, next) {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next()

    const origin = req.get('origin')
    if (
        origin &&
        !allowedOrigins.has(origin) &&
        origin !== `${req.protocol}://${req.get('host')}`
    ) {
        throw new AppError(403, 'BAD_ORIGIN', 'Request origin is not allowed.')
    }
    next()
}

function limiter(windowMinutes, limit, message) {
    return rateLimit({
        windowMs: windowMinutes * 60 * 1000,
        limit,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        handler: (_req, _res, next) => next(new AppError(429, 'RATE_LIMITED', message)),
    })
}

export const loginLimiter = limiter(15, 20, 'Too many login attempts. Try again in a few minutes.')
export const registerLimiter = limiter(
    60,
    10,
    'Too many sign-ups from this network. Try again later.',
)
// Sending reset emails is the abusable part, so it gets the tight limit.
export const forgotLimiter = limiter(60, 8, 'Too many reset requests. Try again later.')
// Tokens carry 256 bits of entropy; this only stops floods.
export const resetLimiter = limiter(15, 30, 'Too many attempts. Try again in a few minutes.')
export const apiLimiter = limiter(1, 300, 'Too many requests. Slow down and try again.')
