import { getPlan } from '../config/plans.js'
import { withTransaction } from '../db/pool.js'
import { runCheckInBackground } from '../monitoring/runner.js'
import { assertPublicHost } from '../monitoring/network-guard.js'
import * as incidentRepository from '../repositories/incident.repository.js'
import * as monitorRepository from '../repositories/monitor.repository.js'
import * as userRepository from '../repositories/user.repository.js'
import { AppError, badRequest, conflict, notFound } from '../utils/errors.js'
import { logger } from '../utils/logger.js'
import { normalizeMonitorUrl } from '../utils/url.js'
import { isUuid, validateMonitorName } from '../utils/validate.js'

export function toPublicMonitor(monitor) {
    return {
        id: monitor.id,
        name: monitor.name,
        url: monitor.url,
        status: monitor.status,
        createdAt: monitor.created_at,
        pausedAt: monitor.paused_at,
        lastCheckedAt: monitor.last_checked_at,
        retryPending: monitor.retry_pending,
    }
}

// Loads a monitor only if it belongs to the user. A monitor that exists but
// belongs to someone else gets the same 404 as one that does not exist.
export async function getOwnedMonitor(userId, monitorId) {
    if (!isUuid(monitorId)) throw notFound('Monitor not found.')
    const monitor = await monitorRepository.findByIdForUser(monitorId, userId)
    if (!monitor) throw notFound('Monitor not found.')
    return monitor
}

// Rejects targets that resolve to private networks at creation time, while
// still accepting valid URLs that are simply offline or do not resolve yet.
async function assertAllowedTarget(url) {
    try {
        await assertPublicHost(new URL(url).hostname)
    } catch (error) {
        if (error.name === 'BlockedTargetError') {
            throw badRequest('This URL points to a private or local network address.', {
                url: 'Monitors must target a public address.',
            })
        }
        // DNS failures are fine here: the monitor will just start DOWN.
    }
}

export async function createMonitor(userId, { name, url }) {
    const fieldErrors = {}
    const nameError = validateMonitorName(name)
    const normalized = normalizeMonitorUrl(url)
    if (nameError) fieldErrors.name = nameError
    if (normalized.error) fieldErrors.url = normalized.error
    if (Object.keys(fieldErrors).length)
        throw badRequest('Check the highlighted fields.', fieldErrors)

    await assertAllowedTarget(normalized.url)

    const monitor = await withTransaction(async (db) => {
        // Locking the user row serializes creates, so two parallel requests
        // cannot both pass the plan limit check.
        const user = await userRepository.lockById(db, userId)
        const plan = getPlan(user.plan)
        const count = await monitorRepository.countByUser(db, userId)
        if (count >= plan.maxMonitors) {
            throw new AppError(
                403,
                'PLAN_LIMIT_REACHED',
                `Your ${plan.name} plan allows ${plan.maxMonitors} monitors. Delete one to add another.`,
            )
        }

        try {
            return await monitorRepository.create(db, {
                userId,
                name: name.trim(),
                url: normalized.url,
                nextCheckAt: new Date(Date.now() + plan.checkIntervalSeconds * 1000),
            })
        } catch (error) {
            if (error.code === '23505') {
                throw conflict('You already monitor this URL.', 'DUPLICATE_URL')
            }
            throw error
        }
    })

    logger.info('Monitor created', { userId, monitorId: monitor.id })
    // First check right away; the monitor stays PENDING until it resolves.
    runCheckInBackground({ id: monitor.id, url: monitor.url })
    return monitor
}

export async function renameMonitor(userId, monitorId, { name }) {
    await getOwnedMonitor(userId, monitorId)
    const nameError = validateMonitorName(name)
    if (nameError) throw badRequest(nameError, { name: nameError })
    return monitorRepository.updateName(monitorId, userId, name.trim())
}

export async function deleteMonitor(userId, monitorId) {
    await getOwnedMonitor(userId, monitorId)
    // Checks, incidents, pauses and notifications go with it (ON DELETE CASCADE).
    await monitorRepository.deleteForUser(monitorId, userId)
    logger.info('Monitor deleted', { userId, monitorId })
}

export async function pauseMonitor(userId, monitorId) {
    if (!isUuid(monitorId)) throw notFound('Monitor not found.')
    return withTransaction(async (db) => {
        const monitor = await monitorRepository.lockByIdForUser(db, monitorId, userId)
        if (!monitor) throw notFound('Monitor not found.')
        if (monitor.status === 'PAUSED') return monitor

        const now = new Date()
        await monitorRepository.openPause(db, monitorId, now)
        // Paused time is not downtime: end the observed outage here.
        await incidentRepository.closeActive(db, monitorId, now, 'PAUSED')
        return monitorRepository.update(db, monitorId, {
            status: 'PAUSED',
            paused_at: now,
            retry_pending: false,
        })
    })
}

export async function resumeMonitor(userId, monitorId) {
    if (!isUuid(monitorId)) throw notFound('Monitor not found.')
    const monitor = await withTransaction(async (db) => {
        const current = await monitorRepository.lockByIdForUser(db, monitorId, userId)
        if (!current) throw notFound('Monitor not found.')
        if (current.status !== 'PAUSED') return null

        const now = new Date()
        const plan = getPlan(current.plan)
        await monitorRepository.closePause(db, monitorId, now)
        return monitorRepository.update(db, monitorId, {
            status: 'PENDING',
            paused_at: null,
            retry_pending: false,
            next_check_at: new Date(now.getTime() + plan.checkIntervalSeconds * 1000),
        })
    })

    if (!monitor) return getOwnedMonitor(userId, monitorId)
    runCheckInBackground({ id: monitor.id, url: monitor.url })
    return monitor
}
