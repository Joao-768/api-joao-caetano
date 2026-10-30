import type { DashboardStats } from '@wae/shared'
import { pool } from '../db/pool'
import { recentExecutions } from './executions'

const DAYS = 14

/** Health numbers for one user: counts over the last 24 hours and a 14-day series. */
export async function dashboardStats(userId: number): Promise<DashboardStats> {
    const [workflows, last24h, failedTotal, daily, recent] = await Promise.all([
        pool.query<{ total: number; active: number }>(
            `SELECT count(*)::int AS total, count(*) FILTER (WHERE is_active)::int AS active
             FROM workflows WHERE user_id = $1 AND deleted_at IS NULL`,
            [userId],
        ),
        pool.query<{ total: number; success: number; failed: number; in_progress: number }>(
            `SELECT count(*)::int AS total,
                    count(*) FILTER (WHERE status = 'success')::int AS success,
                    count(*) FILTER (WHERE status = 'failed')::int AS failed,
                    count(*) FILTER (WHERE status IN ('queued', 'running', 'waiting'))::int AS in_progress
             FROM executions WHERE user_id = $1 AND created_at > now() - interval '24 hours'`,
            [userId],
        ),
        pool.query<{ total: number }>(
            `SELECT count(*)::int AS total FROM executions WHERE user_id = $1 AND status = 'failed'`,
            [userId],
        ),
        // generate_series gives one row per day even when nothing ran that day.
        pool.query<{ date: string; success: number; failed: number }>(
            `SELECT to_char(day, 'YYYY-MM-DD') AS date,
                    count(e.id) FILTER (WHERE e.status = 'success')::int AS success,
                    count(e.id) FILTER (WHERE e.status = 'failed')::int AS failed
             FROM generate_series(current_date - ($2::int - 1), current_date, interval '1 day') AS day
             LEFT JOIN executions e
                ON e.user_id = $1 AND e.created_at >= day AND e.created_at < day + interval '1 day'
             GROUP BY day ORDER BY day`,
            [userId, DAYS],
        ),
        recentExecutions(userId, 8),
    ])

    const window = last24h.rows[0]
    const finished = window.success + window.failed

    return {
        workflows: workflows.rows[0],
        last24h: {
            total: window.total,
            success: window.success,
            failed: window.failed,
            inProgress: window.in_progress,
        },
        successRate: finished > 0 ? window.success / finished : null,
        failedTotal: failedTotal.rows[0].total,
        daily: daily.rows,
        recent,
    }
}
