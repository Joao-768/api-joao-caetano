import { Router } from 'express'
import type { AuthResponse } from '@wae/shared'
import {
    authed,
    DUMMY_HASH,
    hashPassword,
    requireAuth,
    signToken,
    verifyPassword,
} from '../../auth/auth'
import { AppError, conflict, notFound, unauthorized } from '../../lib/errors'
import * as users from '../../repositories/users'
import { authLimiter } from '../rateLimits'
import { changePasswordBody, loginBody, registerBody, updateAccountBody } from '../schemas'

export const authRouter = Router()

authRouter.post('/register', authLimiter, async (req, res) => {
    const input = registerBody.parse(req.body)
    if (await users.findCredentialsByEmail(input.email))
        throw conflict('An account with this email already exists')

    const user = await users.createUser({
        name: input.name,
        email: input.email,
        passwordHash: await hashPassword(input.password),
    })
    res.status(201).json({ token: signToken(user.id), user } satisfies AuthResponse)
})

authRouter.post('/login', authLimiter, async (req, res) => {
    const input = loginBody.parse(req.body)
    const found = await users.findCredentialsByEmail(input.email)

    // Compare against a dummy hash for unknown emails: same timing, same answer.
    const valid = await verifyPassword(input.password, found?.passwordHash ?? DUMMY_HASH)
    if (!found || !valid) throw unauthorized('Invalid email or password')

    res.json({ token: signToken(found.user.id), user: found.user } satisfies AuthResponse)
})

/** The logged-in account. The routes below live under /auth for simplicity. */
authRouter.get(
    '/me',
    requireAuth,
    authed(async (req, res) => {
        const user = await users.findUserById(req.auth.userId)
        if (!user) throw notFound('User')
        res.json(user)
    }),
)

authRouter.patch(
    '/me',
    requireAuth,
    authed(async (req, res) => {
        const input = updateAccountBody.parse(req.body)
        const user = await users.updateUserName(req.auth.userId, input.name)
        if (!user) throw notFound('User')
        res.json(user)
    }),
)

authRouter.post(
    '/me/password',
    requireAuth,
    authLimiter,
    authed(async (req, res) => {
        const input = changePasswordBody.parse(req.body)
        const hash = await users.findPasswordHash(req.auth.userId)
        if (!hash || !(await verifyPassword(input.currentPassword, hash))) {
            throw new AppError(400, 'invalid_password', 'The current password is not correct')
        }
        await users.updatePasswordHash(req.auth.userId, await hashPassword(input.newPassword))
        res.status(204).end()
    }),
)
