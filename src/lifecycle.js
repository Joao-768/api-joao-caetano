import cors from 'cors'
import express from 'express'
import { log, errorFields } from './log.js'
import { originsOf } from './projects.js'

const START_TIMEOUT_MS = 150_000
// Waits between start attempts when a dependency (usually the database) is
// down at boot. After the last one the project stays unavailable until the
// next deploy or restart; the other projects are not affected either way.
const RETRY_DELAYS_MS = [30_000, 60_000, 120_000, 300_000, 600_000]

/**
 * Hosts one project at /<name>. Mounting happens before the project starts,
 * so the route order is fixed; until start() succeeds the slot answers 503.
 */
export function createSlot(project, { host, io }) {
    const state = {
        name: project.name,
        status: 'starting',
        since: new Date().toISOString(),
        instance: null,
        attempts: 0,
    }

    // A small app per project rather than a router: mounted Express apps
    // inherit the host's settings (trust proxy), and the project's own app
    // mounts into it once it is up.
    const slot = express()
    slot.use(
        cors({
            // Credentials only ever go to this project's own frontend.
            origin: originsOf(project),
            credentials: true,
            maxAge: 600,
        }),
    )
    slot.use((_req, res, next) => {
        if (state.status === 'up') return next()
        res.status(503).json({
            error: `${project.name} is ${state.status === 'starting' ? 'starting' : 'unavailable'}. Try again shortly.`,
        })
    })
    host.use(`/${project.name}`, slot)

    function setStatus(status) {
        state.status = status
        state.since = new Date().toISOString()
    }

    async function boot() {
        state.attempts += 1
        let mod
        try {
            mod = await project.load()
        } catch (error) {
            // A module that fails to load (invalid variables, a missing build)
            // fails the same way every time, so there is no point retrying.
            setStatus('failed')
            log('error', 'Project failed to load', { project: project.name, ...errorFields(error) })
            return
        }

        const start = mod.start ?? mod.default?.start
        if (typeof start !== 'function') {
            setStatus('failed')
            log('error', 'Project has no start()', { project: project.name })
            return
        }

        // Wrapped so a synchronous throw lands in the catch below as well.
        const starting = Promise.resolve().then(() => start())
        try {
            const instance = await withTimeout(starting, START_TIMEOUT_MS, 'start() timed out')
            state.instance = instance

            if (instance.sockets) instance.sockets(io.of(`/${project.name}`))
            slot.use(instance.app)
            // Backstop: each project answers its own errors, so this only
            // runs if one slips past that handler.
            slot.use((error, req, res, next) => {
                log('error', 'Unhandled request error', {
                    project: project.name,
                    path: req.originalUrl,
                    ...errorFields(error),
                })
                if (res.headersSent) return next(error)
                res.status(500).json({ error: 'Internal server error' })
            })

            setStatus('up')
            log('info', 'Project up', { project: project.name, attempt: state.attempts })
        } catch (error) {
            // A start() that finishes after its timeout must not keep running
            // next to the retry (two schedulers, two workers): stop it.
            starting.then((late) => late.stop()).catch(() => {})
            state.instance = null

            const delay = RETRY_DELAYS_MS[state.attempts - 1]
            setStatus(delay ? 'starting' : 'failed')
            log('error', 'Project failed to start', {
                project: project.name,
                attempt: state.attempts,
                retryInMs: delay ?? null,
                ...errorFields(error),
            })
            if (delay) setTimeout(boot, delay).unref()
        }
    }

    async function stop() {
        if (!state.instance) return
        try {
            await state.instance.stop()
        } catch (error) {
            log('error', 'Project failed to stop cleanly', {
                project: project.name,
                ...errorFields(error),
            })
        }
    }

    return { project, state, boot, stop }
}

export function withTimeout(promise, ms, message) {
    let timer
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms)
    })
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}
