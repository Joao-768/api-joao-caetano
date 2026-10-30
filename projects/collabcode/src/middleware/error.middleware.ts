import type { ErrorRequestHandler, RequestHandler } from 'express'
import { AuthError } from '../services/auth.service.js'
import { env } from '../lib/env.js'
import { ProjectError } from '../services/project.service.js'
import { FileError } from '../services/file.service.js'
import { MessageError } from '../services/message.service.js'
import { PermissionError } from './permission.middleware.js'

export const notFound: RequestHandler = (_req, res) => {
    res.status(404).json({ error: 'Not found' })
}

type HttpError = { status?: number; statusCode?: number; type?: string }

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    // Body parser rejections (payload too large, malformed JSON) arrive with
    // their own status; without this they would surface as a generic 500.
    const httpError = err as HttpError
    const parserStatus = httpError.status ?? httpError.statusCode

    if (parserStatus === 413) {
        res.status(413).json({ error: 'Payload too large' })
        return
    }

    if (parserStatus === 400 && httpError.type === 'entity.parse.failed') {
        res.status(400).json({ error: 'Malformed JSON body' })
        return
    }

    if (err instanceof AuthError) {
        res.status(err.status).json({ error: err.message })
        return
    }

    if (err instanceof ProjectError) {
        res.status(err.status).json({ error: err.message })
        return
    }

    if (err instanceof FileError) {
        res.status(err.status).json({ error: err.message })
        return
    }

    if (err instanceof MessageError) {
        res.status(err.status).json({ error: err.message })
        return
    }

    if (err instanceof PermissionError) {
        res.status(err.status).json({ error: err.message })
        return
    }

    if (env.NODE_ENV !== 'test') {
        console.error(err)
    }

    res.status(500).json({ error: 'Internal server error' })
}
