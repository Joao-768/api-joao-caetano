// One-off retention sweep: npm run db:retention
import { pool } from '../db/pool.js'
import { logger } from '../utils/logger.js'
import { runRetention } from './retention.js'

runRetention()
    .then(() => pool.end())
    .catch((error) => {
        logger.error('Retention failed', { error: error.message })
        process.exit(1)
    })
