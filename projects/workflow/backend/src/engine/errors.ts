import { TemplateError, type ExecutionError } from '@wae/shared'

/**
 * A failure inside a node. `retryable` is the one decision that matters for
 * the retry policy:
 *
 *   retryable      the same input might succeed later
 *                  (timeout, connection reset, HTTP 5xx / 429)
 *   not retryable  trying again cannot help
 *                  (missing template variable, HTTP 4xx, invalid config)
 */
export class NodeError extends Error {
    constructor(
        readonly code: string,
        message: string,
        readonly retryable: boolean,
        readonly details?: Record<string, unknown>,
    ) {
        super(message)
        this.name = 'NodeError'
    }
}

/** Turns anything a node throws into a NodeError with a stable code. */
export function toNodeError(err: unknown): NodeError {
    if (err instanceof NodeError) return err
    if (err instanceof TemplateError) {
        return new NodeError('template_error', err.message, false, { missing: err.missing })
    }
    if (err instanceof Error && err.name === 'AbortError') {
        return new NodeError('node_timeout', 'The node took too long and was stopped', true)
    }
    // Unknown exceptions (a dropped DB connection, a bug) get the benefit of
    // the doubt: a node that allows retries will try again.
    const message = err instanceof Error ? err.message : String(err)
    return new NodeError('node_exception', message || 'The node failed', true)
}

/** The JSON stored on steps and executions. Never contains stack traces. */
export function serializeError(
    error: NodeError,
    nodeId?: string,
): ExecutionError & { details?: unknown } {
    return {
        code: error.code,
        message: error.message,
        ...(nodeId ? { nodeId } : {}),
        ...(error.details ? { details: error.details } : {}),
    }
}
