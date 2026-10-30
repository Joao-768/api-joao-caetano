import * as userRepository from '../repositories/user.repository.js'
import { SESSION_COOKIE, verifySessionToken } from '../services/session.service.js'
import { unauthorized } from '../utils/errors.js'

// Returns the session user, or null with the reason it is missing.
async function resolveSession(req) {
    const token = req.cookies?.[SESSION_COOKIE]
    const payload = token ? verifySessionToken(token) : null
    if (!payload?.sub) return { user: null }

    const user = await userRepository.findById(payload.sub)
    if (!user) return { user: null }

    // Sessions issued before the last password change are no longer valid.
    const changedAtSeconds = Math.floor(new Date(user.password_changed_at).getTime() / 1000)
    if (payload.iat < changedAtSeconds) return { user: null, expired: true }

    return { user }
}

// Loads the session user into req.user, or answers 401.
export async function requireAuth(req, _res, next) {
    const { user, expired } = await resolveSession(req)
    if (!user) throw unauthorized(expired ? 'Your session has ended. Log in again.' : undefined)
    req.user = user
    next()
}

// Loads the session user if there is one; anonymous requests continue.
export async function optionalAuth(req, _res, next) {
    req.user = (await resolveSession(req)).user
    next()
}
