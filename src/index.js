import { createServer } from 'node:http'
import express from 'express'
import { Server } from 'socket.io'
import { healthRoutes, startKeepAlive } from './health.js'
import { createSlot } from './lifecycle.js'
import { log, errorFields } from './log.js'
import { originsOf, projects } from './projects.js'

const PORT = Number(process.env.PORT) || 4400
const isProduction = process.env.NODE_ENV === 'production'

// ---------------------------------------------------------------------------
// Process-level isolation, registered before any project code runs
// ---------------------------------------------------------------------------

// Projects live in projects/<name>/, so the stack says whose error it was.
function blame(error) {
    const match = String(error?.stack ?? '').match(/[\\/]projects[\\/]([a-z-]+)[\\/]/)
    return match?.[1] ?? 'host'
}

process.on('unhandledRejection', (reason) => {
    log('error', 'Unhandled promise rejection', { project: blame(reason), ...errorFields(reason) })
})

// After an uncaught exception Node's state is not guaranteed, but exiting
// would take every project down for one project's bug. Keep serving and log
// whose it was; only a burst of them (something is really broken) restarts
// the process, and Render brings it back.
const CRASH_WINDOW_MS = 60_000
const CRASH_LIMIT = 5
let crashes = []

process.on('uncaughtException', (error) => {
    log('error', 'Uncaught exception', { project: blame(error), ...errorFields(error) })
    const now = Date.now()
    crashes = crashes.filter((time) => now - time < CRASH_WINDOW_MS).concat(now)
    if (crashes.length >= CRASH_LIMIT) {
        log('error', 'Too many uncaught exceptions, restarting', { count: crashes.length })
        process.exit(1)
    }
})

// ---------------------------------------------------------------------------
// HTTP and Socket.io
// ---------------------------------------------------------------------------

const host = express()
host.disable('x-powered-by')
// Render terminates TLS at one proxy in front of the service. Set before the
// projects are mounted, so their apps inherit it and rate limits see real IPs.
if (isProduction) host.set('trust proxy', 1)

const httpServer = createServer(host)

// One Socket.io server for every project, one namespace each (/collabcode).
// The handshake carries the auth cookie, so CORS allows credentials, and only
// for the origins of projects that use sockets.
const io = new Server(httpServer, {
    serveClient: false,
    cors: {
        origin: projects.filter((project) => project.sockets).flatMap(originsOf),
        credentials: true,
    },
})
io.of('/').use((_socket, next) => next(new Error('Connect to a project namespace')))

const slots = projects.map((project) => createSlot(project, { host, io }))
healthRoutes(host, slots)

host.get('/', (_req, res) => {
    res.json({
        service: 'api-joao-caetano',
        projects: projects.map((project) => `/${project.name}`),
        health: '/health',
    })
})
host.use((_req, res) => res.status(404).json({ error: 'Not found' }))

httpServer.listen(PORT, '0.0.0.0', () => {
    log('info', 'Listening', { port: PORT, projects: projects.map((project) => project.name) })
})

// One at a time: each start runs migrations, and booting them together would
// stack their memory peaks in 512 MB. A project that fails here retries on its
// own schedule (see lifecycle.js) while the others carry on.
for (const slot of slots) await slot.boot()
const stopKeepAlive = startKeepAlive(slots)

// ---------------------------------------------------------------------------
// Shutdown
// ---------------------------------------------------------------------------

let shuttingDown = false

async function shutdown(signal) {
    if (shuttingDown) return
    shuttingDown = true
    log('info', 'Shutting down', { signal })
    // Render allows 30 s after SIGTERM.
    setTimeout(() => process.exit(1), 25_000).unref()

    stopKeepAlive()
    // Also closes the HTTP server.
    io.close()
    await Promise.all(slots.map((slot) => slot.stop()))
    process.exit(0)
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
