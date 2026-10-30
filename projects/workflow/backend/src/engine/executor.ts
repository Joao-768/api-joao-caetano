import {
    nextNodeId,
    validateDefinition,
    type ExecutionContext,
    type ExecutionError,
    type ValidWorkflowDefinition,
    type WorkflowNode,
} from '@wae/shared'
import { env } from '../config/env'
import { pool, transaction } from '../db/pool'
import { logger } from '../lib/logger'
import * as executions from '../repositories/executions'
import { findVersionDefinition } from '../repositories/workflows'
import type { RunNodeData } from '../queue/queue'
import { NodeError, serializeError, toNodeError } from './errors'
import { handlerFor } from './nodes'
import type { EngineServices } from './nodes/types'
import { maxAttemptsFor, shouldRetry } from './retryPolicy'

/**
 * The workflow engine.
 *
 * `executeNodeJob` runs exactly one node of one execution, then decides what
 * happens next. A whole execution is a chain of these calls, one BullMQ job
 * each:
 *
 *   trigger job -> condition job -> (true branch) http job -> ... -> finish
 *
 * For every job:
 *
 *   1. Claim      Make sure the execution is still in progress and its cursor
 *                 points at this node. Otherwise the job is stale: do nothing.
 *   2. Load       Read the workflow *version* the execution started with, and
 *                 rebuild the context (event + outputs of earlier steps) from
 *                 Postgres. Workers keep no state between jobs.
 *   3. Run        prepare() resolves templates into the input, run() does the
 *                 work under a timeout. A step row records input, output,
 *                 error, attempt and duration.
 *   4. Continue   Follow the outgoing edge (for a condition, the branch it
 *                 chose), move the cursor and enqueue the next node, delayed
 *                 if the node asked to wait. No next node: the execution
 *                 succeeded, and nodes that never ran are recorded as skipped.
 *   5. Fail       A retryable error with attempts left returns "retry" and the
 *                 worker lets BullMQ schedule another attempt with backoff.
 *                 Otherwise the execution is marked failed, with the node and
 *                 the reason.
 *
 * Nothing here knows about HTTP or Express: the same function is driven by
 * the BullMQ worker in production and could be called from a script or test.
 */

export type EngineDeps = {
    services: EngineServices
    enqueue: (
        data: RunNodeData,
        options: { maxAttempts: number; delayMs?: number },
    ) => Promise<void>
}

export type NodeJobResult =
    | { outcome: 'stale' }
    | { outcome: 'advanced'; nextNodeId: string; delayMs?: number }
    | { outcome: 'finished' }
    | { outcome: 'failed'; error: ExecutionError }
    | { outcome: 'retry'; error: ExecutionError }

export async function executeNodeJob(
    job: RunNodeData & { attempt: number },
    deps: EngineDeps,
): Promise<NodeJobResult> {
    const { executionId, nodeId, attempt } = job
    const log = logger.child({ executionId, nodeId, attempt })

    // 1. Claim ---------------------------------------------------------------
    const execution = await executions.claimNode(executionId, nodeId)
    if (!execution || (await executions.hasSucceeded(executionId, nodeId))) {
        log.warn('Stale node job ignored')
        return { outcome: 'stale' }
    }
    await executions.completeWaitingSteps(executionId)

    // 2. Load ----------------------------------------------------------------
    const snapshot = await findVersionDefinition(execution.workflow_id, execution.workflow_version)
    const validation = validateDefinition(snapshot)
    if (!validation.valid) {
        return failExecution(executionId, {
            code: 'invalid_workflow',
            message: `The workflow definition is invalid: ${validation.issues[0]?.message ?? 'unknown problem'}`,
        })
    }
    const graph = validation.definition
    const node = graph.nodes.find((candidate) => candidate.id === nodeId)
    if (!node) {
        return failExecution(executionId, {
            code: 'unknown_node',
            message: `Node "${nodeId}" is not in this workflow version`,
        })
    }

    const context: ExecutionContext = {
        event: execution.trigger_data ?? {},
        trigger: { type: execution.trigger_type, receivedAt: execution.created_at.toISOString() },
        execution: {
            id: execution.id,
            workflowId: execution.workflow_id,
            workflowVersion: execution.workflow_version,
        },
        steps: await executions.completedOutputs(executionId),
    }

    // 3. Run -----------------------------------------------------------------
    const maxAttempts = maxAttemptsFor(node)
    const stepId = await executions.startStep({
        executionId,
        nodeId,
        nodeType: node.type,
        attempt,
        maxAttempts,
    })
    const handler = handlerFor(node.type)
    let storedInput: unknown

    try {
        const input = handler.prepare(node, context)
        storedInput = handler.redact ? handler.redact(input) : input

        const result = await withTimeout(env.NODE_TIMEOUT_MS, (signal) =>
            handler.run(input, node, {
                execution: {
                    id: execution.id,
                    userId: execution.user_id,
                    workflowId: execution.workflow_id,
                },
                signal,
                services: deps.services,
            }),
        )

        // 4. Continue --------------------------------------------------------
        const next = nextNodeId(graph, node.id, result.branch)
        const waiting = next !== null && result.waitMs !== undefined

        if (!next) {
            await transaction(async (tx) => {
                await executions.finishStep(tx, stepId, {
                    status: 'success',
                    input: storedInput,
                    output: result.output,
                })
                await executions.finishExecution(tx, executionId, 'success')
                const ran = await executions.executedNodeIds(tx, executionId)
                await executions.insertSkippedSteps(
                    tx,
                    executionId,
                    graph.nodes.filter((n) => !ran.has(n.id)),
                )
            })
            log.info('Execution finished')
            return { outcome: 'finished' }
        }

        const moved = await transaction(async (tx) => {
            await executions.finishStep(tx, stepId, {
                status: waiting ? 'waiting' : 'success',
                input: storedInput,
                output: result.output,
            })
            return executions.advanceExecution(
                tx,
                executionId,
                node.id,
                next,
                waiting ? 'waiting' : 'running',
            )
        })
        if (!moved) return { outcome: 'stale' }

        try {
            await deps.enqueue(
                { executionId, nodeId: next },
                { maxAttempts: maxAttemptsFor(nodeById(graph, next)), delayMs: result.waitMs },
            )
        } catch (err) {
            log.error({ err }, 'Could not enqueue the next node')
            return failExecution(executionId, {
                code: 'queue_failure',
                message: 'The next step could not be queued',
                nodeId: next,
            })
        }
        return { outcome: 'advanced', nextNodeId: next, delayMs: result.waitMs }
    } catch (err) {
        // 5. Fail ------------------------------------------------------------
        const error = toNodeError(err)
        const retry = shouldRetry(error, attempt, maxAttempts)
        await executions.finishStep(pool, stepId, {
            status: retry ? 'retrying' : 'failed',
            input: storedInput,
            error: serializeError(error),
        })

        if (retry) {
            log.info({ code: error.code }, 'Node failed, retry scheduled')
            return { outcome: 'retry', error: serializeError(error, node.id) }
        }
        log.info({ code: error.code }, 'Node failed, execution failed')
        return failExecution(executionId, serializeError(error, node.id))
    }
}

async function failExecution(executionId: number, error: ExecutionError): Promise<NodeJobResult> {
    await executions.finishExecution(pool, executionId, 'failed', error)
    return { outcome: 'failed', error }
}

function nodeById(graph: ValidWorkflowDefinition, id: string): WorkflowNode {
    const node = graph.nodes.find((candidate) => candidate.id === id)
    if (!node) throw new Error(`Node ${id} not found`)
    return node
}

/**
 * Runs `work` with an AbortSignal and rejects if it takes longer than `ms`.
 * The signal lets well-behaved work (the HTTP client) stop early; the timer
 * guarantees the job itself never hangs.
 */
async function withTimeout<T>(ms: number, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController()
    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
            controller.abort()
            reject(new NodeError('node_timeout', `The node did not finish within ${ms} ms`, true))
        }, ms)
    })
    try {
        return await Promise.race([work(controller.signal), timeout])
    } finally {
        clearTimeout(timer)
    }
}

/**
 * Called when the engine itself failed on a job (for example the database was
 * unreachable) and BullMQ has no attempts left, so the execution does not
 * stay "running" forever.
 */
export async function markEngineFailure(data: RunNodeData, reason: string): Promise<void> {
    const error: ExecutionError = { code: 'engine_error', message: reason, nodeId: data.nodeId }
    await executions.failOpenSteps(data.executionId, error)
    await executions.finishExecution(pool, data.executionId, 'failed', error)
}
