// Cron-driven scheduler (V1). Every few seconds it claims monitors whose
// next_check_at has passed and hands them to the runner.
//
// To move to workers/queues later, replace only this file: claim due monitors
// the same way and enqueue { id, url, isRetry } jobs instead of calling
// runCheck directly. The runner, state machine and repositories stay as-is.

import cron from 'node-cron'
import { MONITORING } from '../config/monitoring.js'
import { PLANS } from '../config/plans.js'
import * as monitorRepository from '../repositories/monitor.repository.js'
import { runRetention } from '../jobs/retention.js'
import { logger } from '../utils/logger.js'
import { availableSlots, drain, runCheck } from './runner.js'

const intervals = Object.fromEntries(
    Object.values(PLANS).map((plan) => [plan.key, plan.checkIntervalSeconds]),
)

let ticking = false

export async function tick() {
    // A slow tick must not overlap with the next one.
    if (ticking) return
    ticking = true
    try {
        const slots = availableSlots()
        if (slots === 0) return
        const due = await monitorRepository.claimDue(slots, intervals)
        for (const monitor of due) {
            runCheck({ id: monitor.id, url: monitor.url, isRetry: monitor.retry_pending })
        }
    } catch (error) {
        logger.error('Scheduler tick failed', { error: error.message })
    } finally {
        ticking = false
    }
}

async function retentionJob() {
    try {
        await runRetention()
    } catch (error) {
        logger.error('Retention job failed', { error: error.message })
    }
}

export function startScheduler() {
    const tasks = [
        cron.schedule(MONITORING.schedulerCron, tick, { name: 'checks' }),
        cron.schedule(MONITORING.retentionCron, retentionJob, { name: 'retention' }),
    ]
    logger.info('Scheduler started', {
        cron: MONITORING.schedulerCron,
        retryDelaySeconds: MONITORING.retryDelaySeconds,
    })
    // Clean up anything that expired while the process was down.
    retentionJob()

    return async function stopScheduler() {
        for (const task of tasks) task.stop()
        await drain()
        logger.info('Scheduler stopped')
    }
}
