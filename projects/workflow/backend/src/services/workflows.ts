import crypto from 'node:crypto'
import {
    TRIGGER_TYPES,
    validateDefinition,
    type TriggerType,
    type WorkflowDefinition,
    type WorkflowDetail,
} from '@wae/shared'
import { transaction } from '../db/pool'
import { notFound, unprocessable } from '../lib/errors'
import * as repo from '../repositories/workflows'
import { nextRun, syncSchedule } from './schedules'
import { startExecution } from './executions'

/**
 * Workflow use cases. Routes call these; these call repositories and keep
 * the rules in one place:
 *
 *   - a draft can be saved in any state, as long as it is a well-formed graph
 *   - an *active* workflow must always hold a runnable graph
 *   - every change that affects scheduling re-syncs the scheduler
 *   - deleting is a soft delete, so execution history is preserved
 */

export type WorkflowInput = {
    name: string
    description?: string | null
    definition?: WorkflowDefinition
}

/** A new workflow starts with a lone manual trigger. */
export const STARTER_DEFINITION: WorkflowDefinition = {
    nodes: [
        {
            id: 'trigger',
            type: 'trigger',
            position: { x: 0, y: 0 },
            config: { type: 'manual' },
        },
    ],
    edges: [],
}

/** Copies what the trigger node says into queryable columns. */
function triggerColumns(definition: WorkflowDefinition): {
    triggerType: TriggerType | null
    triggerEvent: string | null
} {
    const config = definition.nodes.find((node) => node.type === 'trigger')?.config ?? {}
    const type = (TRIGGER_TYPES as readonly unknown[]).includes(config.type)
        ? (config.type as TriggerType)
        : null
    const eventName =
        type === 'event' && typeof config.eventName === 'string' ? config.eventName.trim() : null
    return { triggerType: type, triggerEvent: eventName || null }
}

export function toDetail(row: repo.WorkflowRow): WorkflowDetail {
    const validation = validateDefinition(row.definition)
    return {
        ...repo.toSummary(row),
        definition: row.definition,
        webhook: {
            id: row.webhook_id,
            path: `/webhooks/${row.webhook_id}`,
            hasSecret: row.webhook_secret_hash !== null,
        },
        nextScheduledRun: nextRun(row),
        issues: validation.issues,
    }
}

function assertRunnable(definition: WorkflowDefinition, message: string) {
    const validation = validateDefinition(definition)
    if (!validation.valid) {
        throw unprocessable('invalid_workflow', message, { issues: validation.issues })
    }
}

export async function getWorkflow(userId: number, id: number): Promise<repo.WorkflowRow> {
    const row = await repo.findWorkflow(userId, id)
    if (!row) throw notFound('Workflow')
    return row
}

export async function createWorkflow(
    userId: number,
    input: WorkflowInput,
): Promise<WorkflowDetail> {
    const definition = input.definition ?? STARTER_DEFINITION
    const row = await transaction((tx) =>
        repo.insertWorkflow(tx, userId, {
            name: input.name,
            description: input.description ?? null,
            definition,
            ...triggerColumns(definition),
        }),
    )
    return toDetail(row)
}

export async function updateWorkflow(
    userId: number,
    id: number,
    input: WorkflowInput,
): Promise<WorkflowDetail> {
    const current = await getWorkflow(userId, id)
    const definition = input.definition ?? current.definition
    if (current.is_active)
        assertRunnable(
            definition,
            'This workflow is active, so it must stay runnable. Fix the issues or deactivate it first.',
        )

    const row = await transaction((tx) =>
        repo.updateWorkflow(tx, userId, id, {
            name: input.name,
            description: input.description === undefined ? current.description : input.description,
            definition,
            ...triggerColumns(definition),
        }),
    )
    if (!row) throw notFound('Workflow')
    await syncSchedule(row)
    return toDetail(row)
}

export async function setActive(
    userId: number,
    id: number,
    active: boolean,
): Promise<WorkflowDetail> {
    const current = await getWorkflow(userId, id)
    if (active)
        assertRunnable(current.definition, 'Fix the issues before activating this workflow.')
    const row = await repo.setWorkflowActive(userId, id, active)
    if (!row) throw notFound('Workflow')
    await syncSchedule(row)
    return toDetail(row)
}

export async function duplicateWorkflow(userId: number, id: number): Promise<WorkflowDetail> {
    const source = await getWorkflow(userId, id)
    return createWorkflow(userId, {
        name: `Copy of ${source.name}`.slice(0, 120),
        description: source.description,
        definition: source.definition,
    })
}

export async function deleteWorkflow(userId: number, id: number): Promise<void> {
    const row = await repo.softDeleteWorkflow(userId, id)
    if (!row) throw notFound('Workflow')
    await syncSchedule(row)
}

/** Manual runs work on inactive workflows too: that is how a draft is tested. */
export async function runManually(userId: number, id: number, payload: unknown) {
    const workflow = await getWorkflow(userId, id)
    assertRunnable(workflow.definition, 'Fix the issues before running this workflow.')
    return startExecution({ workflow, triggerType: 'manual', payload })
}

// ---------------------------------------------------------------------------
// Webhook secrets
// ---------------------------------------------------------------------------

export function hashSecret(secret: string): string {
    return crypto.createHash('sha256').update(secret).digest('hex')
}

/**
 * Generates a new secret and returns it exactly once. Only its SHA-256 hash
 * is stored, so it cannot be shown again or leak from the database.
 */
export async function rotateWebhookSecret(userId: number, id: number): Promise<string> {
    const secret = `whsec_${crypto.randomBytes(24).toString('base64url')}`
    if (!(await repo.setWebhookSecretHash(userId, id, hashSecret(secret))))
        throw notFound('Workflow')
    return secret
}

export async function removeWebhookSecret(userId: number, id: number): Promise<void> {
    if (!(await repo.setWebhookSecretHash(userId, id, null))) throw notFound('Workflow')
}
