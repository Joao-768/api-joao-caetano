import { DEFAULT_MAX_ATTEMPTS, type WorkflowNode } from '@wae/shared'
import type { NodeError } from './errors'

/**
 * Retry policy, in one place:
 *
 *   - How many attempts: the node's own `maxAttempts` if it has one (HTTP and
 *     email nodes let the user choose), otherwise a per-type default
 *     (3 for HTTP and email, 2 for records, 1 for everything deterministic).
 *   - Whether to retry: only errors marked retryable, and only while attempts
 *     remain.
 *   - When: BullMQ's exponential backoff, RETRY_BACKOFF_MS * 2^(attempt - 1),
 *     configured where node jobs are enqueued (queue/queue.ts).
 */

export function maxAttemptsFor(node: WorkflowNode): number {
    if ((node.type === 'http_request' || node.type === 'email') && node.config.maxAttempts) {
        return node.config.maxAttempts
    }
    return DEFAULT_MAX_ATTEMPTS[node.type]
}

export function shouldRetry(error: NodeError, attempt: number, maxAttempts: number): boolean {
    return error.retryable && attempt < maxAttempts
}

/** The wait before attempt `attempt + 1`, mirroring BullMQ's exponential strategy. */
export function backoffDelay(attempt: number, baseMs: number): number {
    return baseMs * 2 ** (attempt - 1)
}
