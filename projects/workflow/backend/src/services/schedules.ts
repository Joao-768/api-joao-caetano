import { checkCron, triggerConfigSchema, type WorkflowDefinition } from '@wae/shared'
import { logger } from '../lib/logger'
import { listActiveScheduledWorkflows, type WorkflowRow } from '../repositories/workflows'
import { listScheduledWorkflowIds, removeSchedule, upsertSchedule } from '../queue/queue'

/**
 * Keeps BullMQ's job schedulers in step with the workflows table.
 *
 * Postgres is the source of truth: a workflow should have a scheduler in
 * Redis if and only if it is active, not deleted, and its trigger is a valid
 * schedule. `syncSchedule` applies that rule to one workflow whenever it is
 * created, edited, activated, deactivated or deleted. `reconcileSchedules`
 * applies it to all of them when the worker starts and every few minutes, so
 * a missed sync (Redis briefly down, Redis flushed) repairs itself.
 */

export function scheduleOf(
    definition: WorkflowDefinition,
): { cron: string; timezone: string } | null {
    const trigger = definition.nodes.find((node) => node.type === 'trigger')
    const parsed = triggerConfigSchema.safeParse(trigger?.config)
    if (!parsed.success || parsed.data.type !== 'schedule') return null
    return { cron: parsed.data.cron, timezone: parsed.data.timezone }
}

function shouldBeScheduled(workflow: WorkflowRow) {
    return workflow.is_active && !workflow.deleted_at ? scheduleOf(workflow.definition) : null
}

export function nextRun(workflow: WorkflowRow): string | null {
    const schedule = shouldBeScheduled(workflow)
    if (!schedule) return null
    const check = checkCron(schedule.cron, schedule.timezone)
    return check.valid ? check.next.toISOString() : null
}

export async function syncSchedule(workflow: WorkflowRow): Promise<void> {
    const schedule = shouldBeScheduled(workflow)
    try {
        if (schedule) {
            await upsertSchedule(workflow.id, schedule.cron, schedule.timezone)
        } else {
            await removeSchedule(workflow.id)
        }
    } catch (err) {
        // Not fatal for the request: the worker's reconciliation will retry.
        logger.error({ err, workflowId: workflow.id }, 'Schedule sync failed')
    }
}

export async function reconcileSchedules(): Promise<{ scheduled: number; removed: number }> {
    const wanted = await listActiveScheduledWorkflows()
    const wantedIds = new Set<number>()

    for (const workflow of wanted) {
        const schedule = scheduleOf(workflow.definition)
        if (!schedule) continue
        await upsertSchedule(workflow.id, schedule.cron, schedule.timezone)
        wantedIds.add(workflow.id)
    }

    let removed = 0
    for (const id of await listScheduledWorkflowIds()) {
        if (!wantedIds.has(id)) {
            await removeSchedule(id)
            removed++
        }
    }
    return { scheduled: wantedIds.size, removed }
}
