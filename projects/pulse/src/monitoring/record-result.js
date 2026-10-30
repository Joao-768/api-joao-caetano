// Persists one check result and applies the state machine, atomically.
// The monitor row is locked for the whole transaction, so a concurrent
// pause, resume or delete cannot interleave with a state change.

import { MONITORING } from '../config/monitoring.js'
import { withTransaction } from '../db/pool.js'
import * as checkRepository from '../repositories/check.repository.js'
import * as incidentRepository from '../repositories/incident.repository.js'
import * as monitorRepository from '../repositories/monitor.repository.js'
import * as notificationRepository from '../repositories/notification.repository.js'
import { formatDuration } from '../utils/duration.js'
import { logger } from '../utils/logger.js'
import { decideTransition } from './transitions.js'

export async function recordCheckResult({ monitorId, isRetry, checkedAt, result }) {
    return withTransaction(async (db) => {
        const monitor = await monitorRepository.lockById(db, monitorId)

        // Deleted or paused while the request was in flight: drop the result.
        if (!monitor) return { discarded: 'deleted' }
        if (monitor.status === 'PAUSED') return { discarded: 'paused' }
        // A newer result, or a resume after this check started, makes it
        // stale: the fresh check triggered by the resume decides the state.
        if (
            (monitor.last_checked_at && monitor.last_checked_at > checkedAt) ||
            (monitor.last_resumed_at && monitor.last_resumed_at > checkedAt)
        ) {
            return { discarded: 'stale' }
        }

        const check = await checkRepository.insert(db, {
            monitorId,
            status: result.success ? 'SUCCESS' : 'FAILURE',
            statusCode: result.statusCode,
            responseTime: result.responseTime,
            errorType: result.errorType,
            errorMessage: result.errorMessage,
            isRetry,
            checkedAt,
        })

        const transition = decideTransition(monitor.status, result.success, isRetry)
        const fields = {
            status: transition.status,
            retry_pending: transition.retryPending,
            last_checked_at: checkedAt,
        }
        if (transition.retryPending) {
            fields.next_check_at = new Date(
                checkedAt.getTime() + MONITORING.retryDelaySeconds * 1000,
            )
        }
        await monitorRepository.update(db, monitorId, fields)

        if (transition.openIncident) {
            // The outage started at the failed normal check, not at the retry.
            const firstFailure = await checkRepository.lastFailedNormalCheck(
                db,
                monitorId,
                checkedAt,
            )
            const reason = firstFailure?.error_message ?? result.errorMessage
            const incident = await incidentRepository.open(db, {
                monitorId,
                startedAt: firstFailure?.checked_at ?? checkedAt,
                reason,
            })
            if (incident) {
                await notificationRepository.create(db, {
                    userId: monitor.user_id,
                    monitorId,
                    type: 'INCIDENT',
                    message: `${monitor.name} is down: ${reason}`,
                    createdAt: checkedAt,
                })
                logger.info('Incident opened', { monitorId, reason })
            }
        }

        if (transition.closeIncident) {
            const incident = await incidentRepository.closeActive(
                db,
                monitorId,
                checkedAt,
                'RECOVERED',
            )
            if (incident) {
                const downFor = formatDuration(incident.resolved_at - incident.started_at)
                await notificationRepository.create(db, {
                    userId: monitor.user_id,
                    monitorId,
                    type: 'RECOVERY',
                    message: `${monitor.name} is back up after ${downFor} of downtime`,
                    createdAt: checkedAt,
                })
                logger.info('Incident resolved', { monitorId, downFor })
            }
        }

        if (monitor.status !== transition.status) {
            logger.info('Monitor status changed', {
                monitorId,
                from: monitor.status,
                to: transition.status,
            })
        }

        return { check, previousStatus: monitor.status, transition }
    })
}
