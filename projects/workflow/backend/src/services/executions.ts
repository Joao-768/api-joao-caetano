import { findTrigger, validateDefinition, type TriggerType } from '@wae/shared'
import { pool } from '../db/pool'
import { serviceUnavailable } from '../lib/errors'
import { logger } from '../lib/logger'
import { finishExecution, insertExecution, type ExecutionRow } from '../repositories/executions'
import type { WorkflowRow } from '../repositories/workflows'
import { enqueueNode } from '../queue/queue'

/**
 * The single entry point for starting a workflow, whatever triggered it
 * (manual run, event, webhook or schedule):
 *
 *   1. record an execution in Postgres, status "queued", cursor on the trigger
 *   2. enqueue the trigger node on BullMQ
 *
 * The caller gets the execution id straight away; the worker does the rest.
 *
 * If the stored graph is not runnable, the execution is still recorded and
 * immediately marked failed, so the attempt is visible in the history
 * instead of silently dropped.
 */
export async function startExecution(input: {
    workflow: WorkflowRow
    triggerType: TriggerType
    payload: unknown
}): Promise<ExecutionRow> {
    const { workflow } = input
    const validation = validateDefinition(workflow.definition)
    const trigger = validation.valid ? findTrigger(validation.definition) : undefined

    const execution = await insertExecution(pool, {
        userId: workflow.user_id,
        workflowId: workflow.id,
        workflowVersion: workflow.version,
        triggerType: input.triggerType,
        triggerData: input.payload,
        startNodeId: trigger?.id ?? null,
    })

    if (!validation.valid || !trigger) {
        const problem = validation.valid ? 'no trigger node' : validation.issues[0]?.message
        await finishExecution(pool, execution.id, 'failed', {
            code: 'invalid_workflow',
            message: `The workflow cannot run: ${problem}`,
        })
        return { ...execution, status: 'failed' }
    }

    try {
        await enqueueNode({ executionId: execution.id, nodeId: trigger.id }, { maxAttempts: 1 })
    } catch (err) {
        logger.error({ err, executionId: execution.id }, 'Could not enqueue execution')
        await finishExecution(pool, execution.id, 'failed', {
            code: 'queue_failure',
            message: 'The job queue was unavailable, so the execution could not start',
        })
        throw serviceUnavailable(
            'The job queue is unavailable. The execution was recorded as failed.',
        )
    }

    logger.info(
        { executionId: execution.id, workflowId: workflow.id, trigger: input.triggerType },
        'Execution queued',
    )
    return execution
}
