import { env } from '../config/env'
import { logger } from '../lib/logger'
import { reconcileSchedules } from '../services/schedules'
import { createWorker } from './worker'

const RECONCILE_EVERY_MS = 5 * 60_000

/**
 * Starts consuming jobs: the BullMQ worker plus the periodic schedule
 * reconciliation. Started by mount.ts, inside the host process.
 *
 * Returns a stop function that waits for running jobs to finish.
 */
export function startWorkerRuntime(): { stop: () => Promise<void> } {
    const worker = createWorker()
    logger.info({ concurrency: env.WORKER_CONCURRENCY }, 'Worker started')

    const reconcile = async () => {
        try {
            logger.info(await reconcileSchedules(), 'Schedules reconciled')
        } catch (err) {
            logger.error({ err }, 'Schedule reconciliation failed')
        }
    }
    void reconcile()
    const timer = setInterval(reconcile, RECONCILE_EVERY_MS)

    return {
        async stop() {
            clearInterval(timer)
            // close() waits for the jobs currently running, so a deploy does
            // not cut a step in half.
            await worker.close().catch((err) => logger.error({ err }, 'Worker close failed'))
        },
    }
}
