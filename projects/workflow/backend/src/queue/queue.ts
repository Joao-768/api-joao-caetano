import { Queue, type ConnectionOptions } from 'bullmq'
import { env } from '../config/env'

/**
 * One BullMQ queue carries all engine work. Two kinds of job travel on it:
 *
 *   run-node       { executionId, nodeId }  execute one node of one execution
 *   schedule-tick  { workflowId }           a cron schedule fired: start an execution
 *
 * A node job only ever runs one node. When it finishes it enqueues the next
 * node (immediately, or with a delay for Delay nodes). Retries use BullMQ's
 * own `attempts` + exponential backoff on the node job, so only the failed
 * node is retried, never the steps before it.
 */

export const QUEUE_NAME = 'workflow-jobs'

export const JOB = {
    runNode: 'run-node',
    scheduleTick: 'schedule-tick',
} as const

export type RunNodeData = { executionId: number; nodeId: string }
export type ScheduleTickData = { workflowId: number }

export function redisConnection(): ConnectionOptions {
    // BullMQ needs maxRetriesPerRequest: null for its blocking connections.
    return { url: env.REDIS_URL, maxRetriesPerRequest: null }
}

let queue: Queue | null = null

export function getQueue(): Queue {
    if (!queue) {
        queue = new Queue(QUEUE_NAME, {
            prefix: env.QUEUE_PREFIX,
            // Producers should fail fast when Redis is down instead of
            // buffering commands forever; the caller turns that into an error.
            connection: { ...redisConnection(), enableOfflineQueue: false },
        })
        queue.on('error', () => {
            // Connection errors surface on the calls that need Redis; this
            // listener only stops them from being reported as unhandled.
        })
    }
    return queue
}

export async function closeQueue(): Promise<void> {
    if (queue) {
        await queue.close()
        queue = null
    }
}

export async function enqueueNode(
    data: RunNodeData,
    options: { maxAttempts: number; delayMs?: number },
): Promise<void> {
    await getQueue().add(JOB.runNode, data, {
        // A stable id means the same node of the same execution cannot be
        // queued twice while a copy is still pending or running. Once the job
        // is done it is removed; from then on the claim check in the executor
        // is what rejects a stale duplicate.
        jobId: `exec-${data.executionId}-${data.nodeId}`,
        attempts: options.maxAttempts,
        backoff: { type: 'exponential', delay: env.RETRY_BACKOFF_MS },
        delay: options.delayMs,
        removeOnComplete: true,
        removeOnFail: { age: 24 * 3600 },
    })
}

const schedulerId = (workflowId: number) => `workflow-${workflowId}`

export async function upsertSchedule(
    workflowId: number,
    cron: string,
    timezone: string,
): Promise<void> {
    await getQueue().upsertJobScheduler(
        schedulerId(workflowId),
        { pattern: cron, tz: timezone },
        {
            name: JOB.scheduleTick,
            data: { workflowId } satisfies ScheduleTickData,
            opts: { removeOnComplete: { count: 100 }, removeOnFail: { count: 100 } },
        },
    )
}

export async function removeSchedule(workflowId: number): Promise<void> {
    await getQueue().removeJobScheduler(schedulerId(workflowId))
}

export async function listScheduledWorkflowIds(): Promise<number[]> {
    const schedulers = await getQueue().getJobSchedulers(0, -1)
    return schedulers
        .map((scheduler) =>
            Number(String(scheduler.key ?? scheduler.id ?? '').replace('workflow-', '')),
        )
        .filter((id) => Number.isInteger(id) && id > 0)
}
