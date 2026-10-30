/**
 * Errors the API knows how to turn into an HTTP response. Anything else that
 * reaches the error handler is treated as a bug: logged in full, answered
 * with a generic 500 so internals never leak to the client.
 */
export class AppError extends Error {
    constructor(
        readonly status: number,
        readonly code: string,
        message: string,
        readonly details?: unknown,
    ) {
        super(message)
        this.name = 'AppError'
    }
}

export const badRequest = (message: string, details?: unknown) =>
    new AppError(400, 'bad_request', message, details)

export const unauthorized = (message = 'Authentication required') =>
    new AppError(401, 'unauthorized', message)

export const notFound = (what: string) => new AppError(404, 'not_found', `${what} not found`)

export const conflict = (message: string) => new AppError(409, 'conflict', message)

export const unprocessable = (code: string, message: string, details?: unknown) =>
    new AppError(422, code, message, details)

export const serviceUnavailable = (message: string) =>
    new AppError(503, 'service_unavailable', message)

export function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err)
}
