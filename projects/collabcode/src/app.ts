import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import cookieParser from 'cookie-parser'
import { env } from './lib/env.js'
import { apiRoutes } from './routes/index.js'
import { notFound, errorHandler } from './middleware/error.middleware.js'

export const app = express()

// Security headers, and drop the X-Powered-By fingerprint.
app.use(
    helmet({
        contentSecurityPolicy: {
            useDefaults: true,
            directives: {
                // The Run button executes user code in a Worker built from a
                // blob URL; without this the default-src 'self' policy blocks it.
                'worker-src': ["'self'", 'blob:'],
                'child-src': ["'self'", 'blob:'],
                // Monaco injects its editor styles and loads its own fonts;
                // the UI fonts come from Google Fonts.
                'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
                'font-src': ["'self'", 'data:', 'https://fonts.gstatic.com'],
                // Same-origin websockets for the collaborative session.
                'connect-src': ["'self'", 'ws:', 'wss:'],
                // Only meaningful behind HTTPS. On a plain http://localhost run
                // it makes the browser request every asset over https, and
                // the page never loads.
                'upgrade-insecure-requests': env.NODE_ENV === 'production' ? [] : null,
            },
        },
        // Same reason: HSTS only where the site is actually served over HTTPS.
        strictTransportSecurity: env.NODE_ENV === 'production',
    }),
)
app.disable('x-powered-by')

app.use(cors({ origin: env.CLIENT_ORIGIN, credentials: true }))
app.use(express.json({ limit: '100kb' }))
app.use(cookieParser())

// Credential endpoints are the ones worth brute-forcing, so they get a
// tighter budget than the rest of the API.
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: env.NODE_ENV === 'test' ? 1000 : 20,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many attempts, please try again later' },
})

app.get('/health', (_req, res) => {
    res.json({ status: 'ok' })
})

app.use('/api/auth/login', authLimiter)
app.use('/api/auth/register', authLimiter)

app.use('/api', apiRoutes)

// In production the client is built into client/dist and served from here, so
// the app, the API and the websockets all share one origin (and one cookie).
const clientDist = resolve(dirname(fileURLToPath(import.meta.url)), '../../client/dist')

if (existsSync(clientDist)) {
    app.use(express.static(clientDist))

    // Client-side routing: anything that is not an API call or a real file is
    // handed to index.html so React Router can resolve it.
    app.get(/^(?!\/api\/).*/, (_req, res) => {
        res.sendFile(join(clientDist, 'index.html'))
    })
}

app.use(notFound)
app.use(errorHandler)
