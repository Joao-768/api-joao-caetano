import { AppError } from '../utils/errors.js'
import { logger } from '../utils/logger.js'

export function notFoundHandler(req, _res, next) {
    next(new AppError(404, 'NOT_FOUND', `No API route for ${req.method} ${req.path}`))
}

// Single place that turns errors into responses. Known AppErrors keep their
// message; everything else is logged with its stack and answered with a
// generic message, so internals never reach the client.
export function errorHandler(error, req, res, _next) {
    if (error.type === 'entity.parse.failed') {
        error = new AppError(400, 'INVALID_JSON', 'Request body is not valid JSON.')
    } else if (error.type === 'entity.too.large') {
        error = new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large.')
    }

    if (error instanceof AppError) {
        if (error.status >= 500) logger.error(error.message, { path: req.path })
        return res.status(error.status).json({
            error: { code: error.code, message: error.message, details: error.details },
        })
    }

    logger.error('Unhandled error', {
        method: req.method,
        path: req.path,
        error: error.message,
        stack: error.stack,
    })
    if (res.headersSent) return res.end()
    res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on our side. Try again.' },
    })
}

export function requestLogger(req, res, next) {
    const started = performance.now()
    res.on('finish', () => {
        const meta = {
            status: res.statusCode,
            ms: Math.round(performance.now() - started),
        }
        const line = `${req.method} ${req.originalUrl.split('?')[0]}`
        if (res.statusCode >= 500) logger.error(line, meta)
        else logger.debug(line, meta)
    })
    next()
}
