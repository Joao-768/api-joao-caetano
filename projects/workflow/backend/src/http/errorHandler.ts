import type { ErrorRequestHandler, RequestHandler } from 'express'
import { ZodError } from 'zod'
import type { ApiErrorBody } from '@wae/shared'
import { AppError } from '../lib/errors'
import { logger } from '../lib/logger'

/**
 * Every error response has the same shape:
 *
 *   { "error": { "code": "validation_error", "message": "...", "details": [...] } }
 *
 * Known errors (AppError, validation, malformed JSON) are reported as they
 * are. Anything unexpected is logged with its stack and answered with a
 * generic 500, so internals such as SQL or file paths never reach a client.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
    const send = (status: number, body: ApiErrorBody['error']) =>
        res.status(status).json({ error: body })

    if (err instanceof AppError) {
        return send(err.status, { code: err.code, message: err.message, details: err.details })
    }

    if (err instanceof ZodError) {
        return send(400, {
            code: 'validation_error',
            message: err.issues[0]?.message ?? 'Invalid request',
            details: err.issues.map((issue) => ({
                path: issue.path.join('.'),
                message: issue.message,
            })),
        })
    }

    // Errors raised by express.json()
    if (err?.type === 'entity.parse.failed') {
        return send(400, { code: 'invalid_json', message: 'The request body is not valid JSON' })
    }
    if (err?.type === 'entity.too.large') {
        return send(413, { code: 'payload_too_large', message: 'The request body is too large' })
    }

    logger.error({ err, method: req.method, url: req.originalUrl }, 'Unhandled request error')
    return send(500, { code: 'internal_error', message: 'Something went wrong on our side' })
}

export const notFoundHandler: RequestHandler = (_req, res) => {
    res.status(404).json({
        error: { code: 'not_found', message: 'Route not found' },
    } satisfies ApiErrorBody)
}
