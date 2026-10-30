// Entry point for api-joao-caetano, which replaces the standalone index.js:
// the host owns the HTTP server and the process-level handlers, and mounts
// this project at /pulse. The check scheduler runs in the same process unless
// PULSE_RUN_SCHEDULER=false.

import { createApp } from './app.js'
import { env } from './config/env.js'
import { migrate } from './db/migrate.js'
import { seed, seedIfMissing } from './db/seed.js'
import { pool } from './db/pool.js'
import { startScheduler } from './monitoring/scheduler.js'
import { logger } from './utils/logger.js'

export async function start() {
    await migrate()
    if (env.seedDemo === 'reset') {
        await seed()
        logger.info('Demo account rebuilt (PULSE_SEED_DEMO=reset)')
    } else if (env.seedDemo === 'true' && (await seedIfMissing())) {
        logger.info('Demo account created (PULSE_SEED_DEMO)')
    }

    const app = createApp()
    const stopScheduler = env.runScheduler ? startScheduler() : null

    return {
        app,
        async ping() {
            await pool.query('SELECT 1')
        },
        async stop() {
            if (stopScheduler) await stopScheduler()
            await pool.end()
        },
    }
}
