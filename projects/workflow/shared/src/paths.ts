import { CONTEXT_ROOTS, type ContextRoot } from './constants'

/**
 * The data a node can read while it runs:
 *
 *   {
 *     event:     the trigger payload (webhook body, event data, manual JSON)
 *     trigger:   { type, receivedAt }
 *     execution: { id, workflowId, workflowVersion }
 *     steps:     { [nodeId]: output of every node that already succeeded }
 *   }
 */
export type ExecutionContext = {
    event: unknown
    trigger: { type: string; receivedAt: string }
    execution: { id: number; workflowId: number; workflowVersion: number }
    steps: Record<string, unknown>
}

const SEGMENT = /^[A-Za-z0-9_$-]+$/

/**
 * Splits "event.customer.name" into segments and applies the V1 shorthand:
 * a path that does not start with a known root is read from the event, so
 * `email` means `event.email`.
 */
export function normalizePath(path: string): string[] {
    const segments = path.trim().split('.')
    if (segments.some((s) => !SEGMENT.test(s))) {
        throw new Error(`"${path}" is not a valid path`)
    }
    return isContextRoot(segments[0]) ? segments : ['event', ...segments]
}

export function isContextRoot(value: string): value is ContextRoot {
    return (CONTEXT_ROOTS as readonly string[]).includes(value)
}

/**
 * Reads a nested value. Array items are reached by index ("items.0.sku").
 * Only own properties are followed, so a path can never climb into
 * `__proto__` or `constructor`.
 *
 * Returns `undefined` when any segment is missing.
 */
export function getPath(source: unknown, segments: string[]): unknown {
    let current: unknown = source
    for (const segment of segments) {
        if (current === null || typeof current !== 'object') return undefined
        if (!Object.prototype.hasOwnProperty.call(current, segment)) return undefined
        current = (current as Record<string, unknown>)[segment]
    }
    return current
}

/** Convenience: normalise then read, e.g. readPath(ctx, "event.total"). */
export function readPath(context: ExecutionContext, path: string): unknown {
    return getPath(context, normalizePath(path))
}
