import { env } from './config/env'
import { pool } from './db/pool'
import { createApp } from './http/app'
import { logger } from './lib/logger'
import { closeQueue } from './queue/queue'
import { startWorkerRuntime } from './queue/runtime'

/**
 * API process: receives triggers, records executions and enqueues them.
 * Workflow steps run in the worker (worker.ts). On hosts where a separate
 * worker process is not available, RUN_WORKER_IN_API=true starts the same
 * worker inside this process: same code, one process instead of two.
 */
const server = createApp().listen(env.PORT, '0.0.0.0', () => {
    logger.info({ port: env.PORT }, 'API listening')
})

const embeddedWorker = env.RUN_WORKER_IN_API ? startWorkerRuntime() : null

let stopping = false

async function shutdown(signal: string) {
    if (stopping) return
    stopping = true
    logger.info({ signal }, 'Shutting down API')
    setTimeout(() => process.exit(1), 30_000).unref()

    // Stop accepting connections, let in-flight requests and jobs finish,
    // then close the clients they were using.
    server.close(async () => {
        await embeddedWorker?.stop()
        await closeQueue().catch((err) => logger.error({ err }, 'Queue close failed'))
        await pool.end().catch((err) => logger.error({ err }, 'Postgres close failed'))
        process.exit(0)
    })
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
