import type { RequestHandler } from 'express'
import { z } from 'zod'
import * as authService from '../services/auth.service.js'
import { signToken } from '../lib/jwt.js'
import { AUTH_COOKIE } from '../middleware/auth.middleware.js'
import { env } from '../lib/env.js'

export const registerSchema = z.object({
    email: z.email(),
    name: z.string().min(2).max(60),
    password: z.string().min(8).max(200),
})

export const loginSchema = z.object({
    email: z.email(),
    password: z.string().min(1),
})

const COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000

function setAuthCookie(res: Parameters<RequestHandler>[1], userId: string): void {
    res.cookie(AUTH_COOKIE, signToken({ userId }), {
        httpOnly: true,
        sameSite: 'lax',
        secure: env.NODE_ENV === 'production',
        maxAge: COOKIE_MAX_AGE,
        path: '/',
    })
}

export const register: RequestHandler = async (req, res) => {
    const { email, name, password } = req.body as z.infer<typeof registerSchema>
    const user = await authService.register(email, name, password)

    setAuthCookie(res, user.id)
    res.status(201).json({ user })
}

export const login: RequestHandler = async (req, res) => {
    const { email, password } = req.body as z.infer<typeof loginSchema>
    const user = await authService.login(email, password)

    setAuthCookie(res, user.id)
    res.json({ user })
}

export const logout: RequestHandler = (_req, res) => {
    res.clearCookie(AUTH_COOKIE, { path: '/' })
    res.status(204).end()
}

export const me: RequestHandler = (req, res) => {
    res.json({ user: req.user })
}
