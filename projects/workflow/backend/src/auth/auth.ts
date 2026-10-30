import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import type { NextFunction, Request, RequestHandler, Response } from 'express'
import { env } from '../config/env'
import { unauthorized } from '../lib/errors'

const BCRYPT_ROUNDS = 12

export const hashPassword = (password: string) => bcrypt.hash(password, BCRYPT_ROUNDS)
export const verifyPassword = (password: string, hash: string) => bcrypt.compare(password, hash)

/**
 * A hash to compare against when the email does not exist, so a failed login
 * takes the same time whether or not the account is real.
 */
export const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', BCRYPT_ROUNDS)

export function signToken(userId: number): string {
    return jwt.sign({}, env.JWT_SECRET, {
        subject: String(userId),
        expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
        algorithm: 'HS256',
    })
}

function verifyToken(token: string): number {
    const payload = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] })
    const userId = typeof payload === 'object' ? Number(payload.sub) : NaN
    if (!Number.isInteger(userId) || userId <= 0) throw new Error('Invalid subject')
    return userId
}

// ---------------------------------------------------------------------------
// Express integration
// ---------------------------------------------------------------------------

/** A request that has passed requireAuth: `auth.userId` is always present. */
export type AuthedRequest = Request & { auth: { userId: number } }

const BEARER = /^Bearer\s+([A-Za-z0-9\-_.]+)$/

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
    const match = req.headers.authorization?.match(BEARER)
    if (!match) return next(unauthorized('Missing or malformed Authorization header'))
    try {
        ;(req as AuthedRequest).auth = { userId: verifyToken(match[1]) }
        next()
    } catch {
        next(unauthorized('Invalid or expired token'))
    }
}

/**
 * Wraps a handler that needs the logged-in user. Pair it with requireAuth on
 * the router; the wrapper gives the handler a correctly typed request
 * instead of scattering `(req as any).userId` around.
 */
export function authed(
    handler: (req: AuthedRequest, res: Response) => Promise<unknown> | unknown,
): RequestHandler {
    return async (req, res) => {
        await handler(req as AuthedRequest, res)
    }
}
