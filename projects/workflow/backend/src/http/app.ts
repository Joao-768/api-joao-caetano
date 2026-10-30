import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import { pinoHttp } from 'pino-http'
import { corsOrigins } from '../config/env'
import { pool } from '../db/pool'
import { logger } from '../lib/logger'
import { getQueue } from '../queue/queue'
import { errorHandler, notFoundHandler } from './errorHandler'
import { authRouter } from './routes/auth'
import { dashboardRouter, executionsRouter, recordsRouter } from './routes/history'
import { eventsRouter, webhooksRouter } from './routes/triggers'
import { workflowsRouter } from './routes/workflows'

/**
 * Builds the Express app without starting it, so tests can drive it with
 * supertest and server.ts can decide how to listen and shut down.
 */
export function createApp() {
    const app = express()

    app.set('trust proxy', 1)
    app.use(helmet())
    app.use(
        cors({
            origin: corsOrigins,
            allowedHeaders: ['Content-Type', 'Authorization'],
            methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
        }),
    )
    app.use(express.json({ limit: '256kb' }))
    app.use(
        pinoHttp({
            logger,
            autoLogging: { ignore: (req) => req.url === '/health' },
            customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : 'info'),
        }),
    )

    app.get('/health', async (_req, res) => {
        const [database, queue] = await Promise.all([
            withTimeout(pool.query('SELECT 1').then(() => 'ok' as const)),
            withTimeout(getQueue().getJobCounts('waiting', 'active', 'delayed', 'failed')),
        ])
        const healthy = database === 'ok' && queue !== 'unavailable'
        res.status(healthy ? 200 : 503).json({
            status: healthy ? 'ok' : 'degraded',
            database,
            queue,
        })
    })

    app.use('/auth', authRouter)
    app.use('/workflows', workflowsRouter)
    app.use('/events', eventsRouter)
    app.use('/webhooks', webhooksRouter)
    app.use('/executions', executionsRouter)
    app.use('/records', recordsRouter)
    app.use('/dashboard', dashboardRouter)

    app.use(notFoundHandler)
    app.use(errorHandler)
    return app
}

/** A health check must answer even when a dependency hangs instead of failing. */
function withTimeout<T>(promise: Promise<T>, ms = 2000): Promise<T | 'unavailable'> {
    const timeout = new Promise<'unavailable'>((resolve) =>
        setTimeout(() => resolve('unavailable'), ms).unref(),
    )
    return Promise.race([promise.catch(() => 'unavailable' as const), timeout])
}
