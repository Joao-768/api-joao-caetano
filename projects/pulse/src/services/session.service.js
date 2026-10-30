// Sessions are signed JWTs in an httpOnly cookie: not readable from
// JavaScript (XSS cannot steal them), SameSite=Lax (not sent on cross-site
// POSTs), Secure in production.

import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'

export const SESSION_COOKIE = 'pm_session'
const SESSION_DAYS = 7

export function createSessionToken(user) {
    return jwt.sign({ sub: user.id }, env.jwtSecret, {
        algorithm: 'HS256',
        expiresIn: `${SESSION_DAYS}d`,
    })
}

// Returns the payload or null. Never throws.
export function verifySessionToken(token) {
    try {
        return jwt.verify(token, env.jwtSecret, { algorithms: ['HS256'] })
    } catch {
        return null
    }
}

export function sessionCookieOptions() {
    return {
        httpOnly: true,
        secure: env.isProduction,
        sameSite: 'lax',
        path: '/',
        maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
    }
}
