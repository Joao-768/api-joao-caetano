// Deletes history older than each user's plan retention.
// Deletes run in batches so a big backlog never holds long locks.

import { query } from '../db/pool.js'
import { PLANS } from '../config/plans.js'
import * as passwordResetRepository from '../repositories/password-reset.repository.js'
import { logger } from '../utils/logger.js'

const BATCH_SIZE = 5000

async function deleteInBatches(sql, params) {
    let total = 0
    for (;;) {
        const { rowCount } = await query(sql, [...params, BATCH_SIZE])
        total += rowCount
        if (rowCount < BATCH_SIZE) return total
    }
}

export async function runRetention() {
    const summary = {}

    for (const plan of Object.values(PLANS)) {
        const params = [plan.key, `${plan.retentionDays} days`]

        const checks = await deleteInBatches(
            `DELETE FROM checks WHERE id IN (
                SELECT c.id FROM checks c
                JOIN monitors m ON m.id = c.monitor_id
                JOIN users u ON u.id = m.user_id
                WHERE u.plan = $1 AND c.checked_at < now() - $2::interval
                LIMIT $3)`,
            params,
        )
        // Only finished incidents and pauses are removed; active ones stay.
        const incidents = await deleteInBatches(
            `DELETE FROM incidents WHERE id IN (
                SELECT i.id FROM incidents i
                JOIN monitors m ON m.id = i.monitor_id
                JOIN users u ON u.id = m.user_id
                WHERE u.plan = $1 AND i.resolved_at < now() - $2::interval
                LIMIT $3)`,
            params,
        )
        const pauses = await deleteInBatches(
            `DELETE FROM monitor_pauses WHERE id IN (
                SELECT p.id FROM monitor_pauses p
                JOIN monitors m ON m.id = p.monitor_id
                JOIN users u ON u.id = m.user_id
                WHERE u.plan = $1 AND p.resumed_at < now() - $2::interval
                LIMIT $3)`,
            params,
        )
        const notifications = await deleteInBatches(
            `DELETE FROM notifications WHERE id IN (
                SELECT n.id FROM notifications n
                JOIN users u ON u.id = n.user_id
                WHERE u.plan = $1 AND n.created_at < now() - $2::interval
                LIMIT $3)`,
            params,
        )
        summary[plan.key] = { checks, incidents, pauses, notifications }
    }

    summary.expiredResetTokens = await passwordResetRepository.deleteExpired()
    logger.info('Retention sweep finished', summary)
    return summary
}
