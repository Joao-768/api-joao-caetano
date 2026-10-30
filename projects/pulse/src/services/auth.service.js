import { createHash, randomBytes } from 'node:crypto'
import { env } from '../config/env.js'
import { DEFAULT_PLAN, getPlan } from '../config/plans.js'
import { withTransaction } from '../db/pool.js'
import * as passwordResetRepository from '../repositories/password-reset.repository.js'
import * as userRepository from '../repositories/user.repository.js'
import { AppError, badRequest, conflict } from '../utils/errors.js'
import { logger } from '../utils/logger.js'
import { normalizeEmail, validateEmail, validateNewPassword } from '../utils/validate.js'
import { sendPasswordResetEmail } from './email.service.js'
import { burnVerificationTime, hashPassword, verifyPassword } from './password.service.js'

const RESET_TOKEN_MINUTES = 30

export function toPublicUser(user) {
    const plan = getPlan(user.plan)
    return {
        id: user.id,
        email: user.email,
        plan: {
            key: plan.key,
            name: plan.name,
            maxMonitors: plan.maxMonitors,
            checkIntervalSeconds: plan.checkIntervalSeconds,
            retentionDays: plan.retentionDays,
        },
        createdAt: user.created_at,
    }
}

export async function register({ email, password }) {
    const fieldErrors = {}
    const emailError = validateEmail(email)
    const passwordError = validateNewPassword(password)
    if (emailError) fieldErrors.email = emailError
    if (passwordError) fieldErrors.password = passwordError
    if (Object.keys(fieldErrors).length)
        throw badRequest('Check the highlighted fields.', fieldErrors)

    const normalized = normalizeEmail(email)
    const passwordHash = await hashPassword(password)
    try {
        const user = await userRepository.create({
            email: normalized,
            passwordHash,
            plan: DEFAULT_PLAN,
        })
        logger.info('User registered', { userId: user.id })
        return user
    } catch (error) {
        if (error.code === '23505') {
            throw conflict(
                'An account with this email already exists. Log in instead.',
                'EMAIL_TAKEN',
            )
        }
        throw error
    }
}

export async function login({ email, password }) {
    if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
        throw badRequest('Enter your email and password.')
    }

    const user = await userRepository.findByEmail(normalizeEmail(email))
    if (!user) {
        await burnVerificationTime(password)
        throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.')
    }
    if (!(await verifyPassword(password, user.password_hash))) {
        throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.')
    }
    return user
}

function hashToken(token) {
    return createHash('sha256').update(token).digest('hex')
}

// Always completes without revealing whether the email has an account.
export async function requestPasswordReset({ email }) {
    const emailError = validateEmail(email)
    if (emailError) throw badRequest(emailError, { email: emailError })

    const user = await userRepository.findByEmail(normalizeEmail(email))
    if (!user) {
        logger.info('Password reset requested for unknown email')
        return
    }

    // 256 bits of randomness; only the SHA-256 hash is stored, so a database
    // leak does not leak usable tokens.
    const token = randomBytes(32).toString('base64url')
    await passwordResetRepository.create({
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + RESET_TOKEN_MINUTES * 60 * 1000),
    })

    const resetUrl = `${env.appUrl}/reset-password?token=${encodeURIComponent(token)}`
    try {
        await sendPasswordResetEmail({
            to: user.email,
            resetUrl,
            expiresInMinutes: RESET_TOKEN_MINUTES,
        })
    } catch (error) {
        // Logged, not surfaced: the response must look the same for every email.
        logger.error('Could not send password reset email', {
            userId: user.id,
            error: error.message,
        })
    }
}

export async function isResetTokenUsable(token) {
    if (typeof token !== 'string' || token.length < 20 || token.length > 200) return false
    return Boolean(await passwordResetRepository.findUsableByHash(hashToken(token)))
}

export async function resetPassword({ token, password }) {
    const passwordError = validateNewPassword(password)
    if (passwordError) throw badRequest(passwordError, { password: passwordError })
    if (typeof token !== 'string' || token.length > 200) {
        throw new AppError(400, 'INVALID_TOKEN', 'This reset link is invalid or has expired.')
    }

    const passwordHash = await hashPassword(password)
    await withTransaction(async (db) => {
        const row = await passwordResetRepository.lockUsableByHash(db, hashToken(token))
        if (!row) {
            throw new AppError(400, 'INVALID_TOKEN', 'This reset link is invalid or has expired.')
        }
        // Also bumps password_changed_at, which signs out existing sessions.
        await userRepository.updatePassword(db, row.user_id, passwordHash)
        await passwordResetRepository.markAllUsedForUser(db, row.user_id)
        logger.info('Password reset completed', { userId: row.user_id })
    })
}
