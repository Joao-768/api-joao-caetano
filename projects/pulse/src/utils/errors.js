// Application errors: anything thrown as an AppError is safe to show to the
// client. Anything else is treated as a bug and answered with a generic 500.
//
// Note: a monitored site being down is NOT an application error. It is a
// normal check result, stored as data (see monitoring/).

export class AppError extends Error {
    constructor(status, code, message, details) {
        super(message)
        this.name = 'AppError'
        this.status = status
        this.code = code
        this.details = details
    }
}

export const badRequest = (message, details) =>
    new AppError(400, 'VALIDATION_ERROR', message, details)

export const unauthorized = (message = 'You need to log in to continue.') =>
    new AppError(401, 'UNAUTHORIZED', message)

export const forbidden = (message = 'You do not have access to this resource.') =>
    new AppError(403, 'FORBIDDEN', message)

// Used for resources owned by someone else too, so IDs cannot be probed.
export const notFound = (message = 'Not found.') => new AppError(404, 'NOT_FOUND', message)

export const conflict = (message, code = 'CONFLICT') => new AppError(409, code, message)
