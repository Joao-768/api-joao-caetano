import { pool } from './db/pool'
import { runMigrations } from './db/migrate'
import { createApp } from './http/app'
import { closeQueue } from './queue/queue'
import { startWorkerRuntime } from './queue/runtime'

/**
 * Entry point for api-joao-caetano, which replaces the standalone server.ts
 * and worker.ts: the host owns the HTTP server and mounts this project at
 * /workflow. There is no separate worker process here, so the BullMQ worker
 * always runs inside the host, with WORKFLOW_WORKER_CONCURRENCY jobs at a time.
 */
export async function start() {
    await runMigrations()

    const app = createApp()
    const worker = startWorkerRuntime()

    return {
        app,
        async ping(): Promise<void> {
            await pool.query('SELECT 1')
        },
        async stop(): Promise<void> {
            // close() waits for running jobs, so a deploy does not cut a step in half.
            await worker.stop()
            await closeQueue()
            await pool.end()
        },
    }
}
