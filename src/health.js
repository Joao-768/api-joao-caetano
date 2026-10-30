import { monitorEventLoopDelay } from 'node:perf_hooks'
import { log, errorFields } from './log.js'
import { withTimeout } from './lifecycle.js'

const PING_TIMEOUT_MS = 5_000
// /health/deep is public: caching it keeps a burst of calls from waking the
// databases over and over.
const DEEP_CACHE_MS = 60_000
const KEEP_ALIVE_EVERY_MS = 24 * 60 * 60 * 1000

const loopDelay = monitorEventLoopDelay({ resolution: 20 })
loopDelay.enable()

const mb = (bytes) => Math.round(bytes / 1024 / 1024)
const ms = (nanoseconds) => Math.round(nanoseconds / 1e6)

function projectStatuses(slots) {
    return Object.fromEntries(
        slots.map(({ state }) => [state.name, { status: state.status, since: state.since }]),
    )
}

async function pingSlot({ state }) {
    if (state.status !== 'up') return { database: 'skipped' }
    const started = Date.now()
    try {
        await withTimeout(state.instance.ping(), PING_TIMEOUT_MS, 'ping timed out')
        return { database: 'ok', latencyMs: Date.now() - started }
    } catch (error) {
        log('error', 'Database ping failed', { project: state.name, ...errorFields(error) })
        return { database: 'unreachable' }
    }
}

export function healthRoutes(host, slots) {
    // For Render's health check and the cron-job.org keep-alive, every few
    // minutes: no database is touched, so pinging this costs nothing. It
    // answers 200 whenever the process is up, even if a project is down,
    // because a failing health check makes Render restart every project.
    host.get('/health', (_req, res) => {
        res.json({
            status: 'ok',
            uptimeSeconds: Math.round(process.uptime()),
            projects: projectStatuses(slots),
        })
    })

    let deep = null
    let deepAt = 0

    host.get('/health/deep', async (_req, res) => {
        if (!deep || Date.now() - deepAt > DEEP_CACHE_MS) {
            const pings = await Promise.all(slots.map(pingSlot))
            const memory = process.memoryUsage()
            const projects = projectStatuses(slots)
            slots.forEach(({ state }, index) => Object.assign(projects[state.name], pings[index]))

            const healthy = Object.values(projects).every(
                (project) => project.status === 'up' && project.database === 'ok',
            )
            deep = {
                status: healthy ? 'ok' : 'degraded',
                checkedAt: new Date().toISOString(),
                projects,
                memoryMb: { rss: mb(memory.rss), heapUsed: mb(memory.heapUsed) },
                eventLoopDelayMs: { p99: ms(loopDelay.percentile(99)), max: ms(loopDelay.max) },
            }
            deepAt = Date.now()
            loopDelay.reset()
        }
        res.status(deep.status === 'ok' ? 200 : 503).json(deep)
    })
}

/**
 * Supabase pauses a free project after a week with no activity. One query a
 * day per project that lives there is enough; Neon projects are left alone so
 * their compute can scale to zero.
 */
export function startKeepAlive(slots) {
    const run = async () => {
        for (const slot of slots.filter(({ project }) => project.keepAlive)) {
            const result = await pingSlot(slot)
            log('info', 'Keep-alive ping', { project: slot.state.name, ...result })
        }
    }
    const timer = setInterval(run, KEEP_ALIVE_EVERY_MS)
    timer.unref()
    return () => clearInterval(timer)
}
