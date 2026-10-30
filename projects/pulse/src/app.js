import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import cookieParser from 'cookie-parser'
import express from 'express'
import helmet from 'helmet'
import { env } from './config/env.js'
import { errorHandler, notFoundHandler, requestLogger } from './middleware/error-handler.js'
import { apiLimiter, requireSameOrigin } from './middleware/security.js'
import { apiRouter } from './routes/index.js'

const clientDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist')

export function createApp() {
    const app = express()

    // Render terminates TLS at a proxy; trust it for req.ip and req.protocol.
    if (env.isProduction) app.set('trust proxy', 1)
    app.disable('x-powered-by')

    app.use(
        helmet({
            contentSecurityPolicy: {
                directives: {
                    defaultSrc: ["'self'"],
                    scriptSrc: ["'self'"],
                    styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
                    fontSrc: ["'self'", 'https://fonts.gstatic.com'],
                    imgSrc: ["'self'", 'data:'],
                    connectSrc: ["'self'"],
                    // Only meaningful behind HTTPS (Render); breaks plain-HTTP local runs.
                    upgradeInsecureRequests: env.isProduction ? [] : null,
                },
            },
        }),
    )
    app.use(requestLogger)
    app.use(express.json({ limit: '20kb' }))
    app.use(cookieParser())

    app.use('/api', apiLimiter, requireSameOrigin, apiRouter)
    app.use('/api', notFoundHandler)

    // Production: one web service serves both the API and the built client,
    // so the session cookie stays first-party.
    if (env.serveClient && existsSync(clientDist)) {
        app.use(express.static(clientDist, { index: false, maxAge: '1h' }))
        // Client routes fall back to index.html; missing files (anything with
        // an extension) stay a 404.
        app.get(/^(?!\/api)(?!.*\.[a-z0-9]+$).*/i, (_req, res) => {
            res.sendFile(path.join(clientDist, 'index.html'))
        })
    }

    app.use(errorHandler)
    return app
}
