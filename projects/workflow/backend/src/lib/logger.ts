import pino from 'pino'
import { env } from '../config/env'

/**
 * Structured logs for operators. Execution details belong in the database
 * (executions / execution_steps), not here: these lines answer "is the
 * process healthy?", not "what did workflow 12 do?".
 *
 * Anything that could carry a credential is redacted before it is written.
 */
export const logger = pino({
    level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
    redact: {
        paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.headers["x-webhook-secret"]',
            '*.password',
            '*.currentPassword',
            '*.newPassword',
            '*.token',
            '*.secret',
        ],
        censor: '[redacted]',
    },
    transport:
        env.NODE_ENV === 'development'
            ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
            : undefined,
})
