// Scheduler as its own process (npm run scheduler), for running the API with
// RUN_SCHEDULER=false and checks elsewhere, e.g. a Render background worker.

import { migrate } from './db/migrate.js'
import { pool } from './db/pool.js'
import { startScheduler } from './monitoring/scheduler.js'
import { logger } from './utils/logger.js'

await migrate()
const stopScheduler = startScheduler()

async function shutdown(signal) {
    logger.info('Shutting down scheduler', { signal })
    await stopScheduler()
    await pool.end()
    process.exit(0)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
