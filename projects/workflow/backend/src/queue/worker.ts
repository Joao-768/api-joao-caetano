import { Worker, type Job } from 'bullmq'
import { createEmailSender } from '../adapters/email'
import { sendHttpRequest } from '../adapters/httpClient'
import { env } from '../config/env'
import { executeNodeJob, markEngineFailure, type EngineDeps } from '../engine/executor'
import { logger } from '../lib/logger'
import { createRecordOnce } from '../repositories/records'
import { findWorkflowById } from '../repositories/workflows'
import { startExecution } from '../services/executions'
import {
    enqueueNode,
    JOB,
    QUEUE_NAME,
    redisConnection,
    removeSchedule,
    type RunNodeData,
    type ScheduleTickData,
} from './queue'

/** Thrown back to BullMQ so it schedules the next attempt with backoff. */
class RetryNode extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'RetryNode'
    }
}

export function defaultEngineDeps(): EngineDeps {
    return {
        services: {
            email: createEmailSender(),
            http: sendHttpRequest,
            createRecord: createRecordOnce,
        },
        enqueue: enqueueNode,
    }
}

/**
 * The BullMQ processor. It is only a dispatcher: node jobs go to the engine,
 * schedule ticks become executions. All decisions live in the engine.
 */
export function createProcessor(deps: EngineDeps) {
    return async (job: Job) => {
        if (job.name === JOB.runNode) {
            const data = job.data as RunNodeData
            const result = await executeNodeJob({ ...data, attempt: job.attemptsMade + 1 }, deps)
            if (result.outcome === 'retry') throw new RetryNode(result.error.message)
            return result
        }

        if (job.name === JOB.scheduleTick) {
            const { workflowId } = job.data as ScheduleTickData
            const workflow = await findWorkflowById(workflowId)
            if (
                !workflow ||
                workflow.deleted_at ||
                !workflow.is_active ||
                workflow.trigger_type !== 'schedule'
            ) {
                // Out of date scheduler: the workflow changed while Redis still had it.
                await removeSchedule(workflowId)
                return { outcome: 'schedule_removed' }
            }
            const execution = await startExecution({
                workflow,
                triggerType: 'schedule',
                // A scheduler job is created one tick ahead as a delayed job:
                // the time it was meant to fire is its creation time plus the delay.
                payload: {
                    scheduledAt: new Date(job.timestamp + (job.opts.delay ?? 0)).toISOString(),
                },
            })
            return { outcome: 'started', executionId: execution.id }
        }

        throw new Error(`Unknown job name "${job.name}"`)
    }
}

export function createWorker(
    deps: EngineDeps = defaultEngineDeps(),
    concurrency = env.WORKER_CONCURRENCY,
) {
    const worker = new Worker(QUEUE_NAME, createProcessor(deps), {
        prefix: env.QUEUE_PREFIX,
        connection: redisConnection(),
        concurrency,
    })

    worker.on('failed', (job, err) => {
        if (!job) return
        if (err instanceof RetryNode || err.name === 'RetryNode') return
        logger.error({ err, jobId: job.id, name: job.name }, 'Job failed')

        // The engine itself crashed on this job and no attempts are left:
        // record that, so the execution does not stay "running" forever.
        const exhausted = job.attemptsMade >= (job.opts.attempts ?? 1)
        if (job.name === JOB.runNode && exhausted) {
            markEngineFailure(
                job.data as RunNodeData,
                `The engine could not process this step: ${err.message}`,
            ).catch((markErr) => logger.error({ err: markErr }, 'Could not record engine failure'))
        }
    })
    worker.on('error', (err) => logger.error({ err }, 'Worker error'))

    return worker
}
