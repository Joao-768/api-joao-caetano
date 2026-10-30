import type { RequestHandler } from 'express'
import { verifyToken } from '../lib/jwt.js'
import { getUserById } from '../services/auth.service.js'

export const AUTH_COOKIE = 'collabcode_token'

export const requireAuth: RequestHandler = async (req, res, next) => {
    const token = req.cookies?.[AUTH_COOKIE] as string | undefined

    if (!token) {
        res.status(401).json({ error: 'Not authenticated' })
        return
    }

    try {
        const { userId } = verifyToken(token)
        const user = await getUserById(userId)

        if (!user) {
            res.status(401).json({ error: 'Not authenticated' })
            return
        }

        req.user = user
        next()
    } catch {
        res.status(401).json({ error: 'Not authenticated' })
    }
}
