import * as authService from '../services/auth.service.js'
import {
    SESSION_COOKIE,
    createSessionToken,
    sessionCookieOptions,
} from '../services/session.service.js'

function startSession(res, user) {
    res.cookie(SESSION_COOKIE, createSessionToken(user), sessionCookieOptions())
}

export async function register(req, res) {
    const user = await authService.register(req.body ?? {})
    startSession(res, user)
    res.status(201).json({ user: authService.toPublicUser(user) })
}

export async function login(req, res) {
    const user = await authService.login(req.body ?? {})
    startSession(res, user)
    res.json({ user: authService.toPublicUser(user) })
}

export function logout(_req, res) {
    const { maxAge: _maxAge, ...options } = sessionCookieOptions()
    res.clearCookie(SESSION_COOKIE, options)
    res.status(204).end()
}

export function me(req, res) {
    res.json({ user: req.user ? authService.toPublicUser(req.user) : null })
}

export async function forgotPassword(req, res) {
    await authService.requestPasswordReset(req.body ?? {})
    res.json({
        message: 'If an account exists for that email, a reset link is on its way.',
    })
}

export async function checkResetToken(req, res) {
    res.json({ valid: await authService.isResetTokenUsable(req.query.token) })
}

export async function resetPassword(req, res) {
    await authService.resetPassword(req.body ?? {})
    res.json({ message: 'Password updated. Log in with your new password.' })
}
