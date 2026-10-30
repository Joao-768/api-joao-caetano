import { pool } from './db/pool'
import { logger } from './lib/logger'
import { closeQueue } from './queue/queue'
import { startWorkerRuntime } from './queue/runtime'

/**
 * Worker process: consumes BullMQ jobs and runs the workflow engine.
 * Run as many as you like; WORKER_CONCURRENCY sets jobs per process.
 */
const runtime = startWorkerRuntime()

let stopping = false

async function shutdown(signal: string) {
    if (stopping) return
    stopping = true
    logger.info({ signal }, 'Shutting down worker')
    setTimeout(() => process.exit(1), 30_000).unref()

    await runtime.stop()
    await closeQueue().catch((err) => logger.error({ err }, 'Queue close failed'))
    await pool.end().catch((err) => logger.error({ err }, 'Postgres close failed'))
    process.exit(0)
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
