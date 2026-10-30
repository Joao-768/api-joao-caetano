import type { ExecutionStatus, TriggerType, WorkflowDefinition, WorkflowSummary } from '@wae/shared'
import { json, pool, type Queryable } from '../db/pool'

/**
 * Data access for workflows and their version snapshots.
 *
 * Every query that serves a user request filters on user_id: that single
 * rule is what keeps one account from reading or changing another's data,
 * even when it guesses ids.
 *
 * Deleted workflows are kept (deleted_at is set) so their execution history
 * stays intact; "live" queries exclude them.
 */

export type WorkflowRow = {
    id: number
    user_id: number
    name: string
    description: string | null
    definition: WorkflowDefinition
    version: number
    trigger_type: TriggerType | null
    trigger_event: string | null
    is_active: boolean
    webhook_id: string
    webhook_secret_hash: string | null
    created_at: Date
    updated_at: Date
    deleted_at: Date | null
}

type SummaryRow = WorkflowRow & {
    last_execution_id: number | null
    last_execution_status: ExecutionStatus | null
    last_execution_at: Date | null
}

export function toSummary(row: SummaryRow | WorkflowRow): WorkflowSummary {
    const last = 'last_execution_id' in row && row.last_execution_id !== null ? row : null
    return {
        id: row.id,
        name: row.name,
        description: row.description,
        triggerType: row.trigger_type,
        triggerEvent: row.trigger_event,
        isActive: row.is_active,
        version: row.version,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
        lastExecution: last
            ? {
                  id: last.last_execution_id!,
                  status: last.last_execution_status!,
                  createdAt: last.last_execution_at!.toISOString(),
              }
            : null,
    }
}

const WITH_LAST_EXECUTION = `
    SELECT w.*, le.id AS last_execution_id, le.status AS last_execution_status, le.created_at AS last_execution_at
    FROM workflows w
    LEFT JOIN LATERAL (
        SELECT id, status, created_at FROM executions e
        WHERE e.workflow_id = w.id
        ORDER BY created_at DESC
        LIMIT 1
    ) le ON true
`

export async function listWorkflows(userId: number): Promise<WorkflowSummary[]> {
    const { rows } = await pool.query<SummaryRow>(
        `${WITH_LAST_EXECUTION} WHERE w.user_id = $1 AND w.deleted_at IS NULL ORDER BY w.updated_at DESC`,
        [userId],
    )
    return rows.map(toSummary)
}

export async function findWorkflow(
    userId: number,
    id: number,
    db: Queryable = pool,
): Promise<SummaryRow | null> {
    const { rows } = await db.query<SummaryRow>(
        `${WITH_LAST_EXECUTION} WHERE w.id = $1 AND w.user_id = $2 AND w.deleted_at IS NULL`,
        [id, userId],
    )
    return rows[0] ?? null
}

/** Internal lookup (worker, scheduler): no user scope, includes deleted rows. */
export async function findWorkflowById(id: number): Promise<WorkflowRow | null> {
    const { rows } = await pool.query<WorkflowRow>('SELECT * FROM workflows WHERE id = $1', [id])
    return rows[0] ?? null
}

export async function findWorkflowByWebhookId(webhookId: string): Promise<WorkflowRow | null> {
    const { rows } = await pool.query<WorkflowRow>(
        'SELECT * FROM workflows WHERE webhook_id = $1 AND deleted_at IS NULL',
        [webhookId],
    )
    return rows[0] ?? null
}

export async function findActiveEventWorkflows(
    userId: number,
    eventName: string,
): Promise<WorkflowRow[]> {
    const { rows } = await pool.query<WorkflowRow>(
        `SELECT * FROM workflows
         WHERE user_id = $1 AND trigger_type = 'event' AND trigger_event = $2
           AND is_active AND deleted_at IS NULL
         ORDER BY id`,
        [userId, eventName],
    )
    return rows
}

export async function listActiveScheduledWorkflows(): Promise<WorkflowRow[]> {
    const { rows } = await pool.query<WorkflowRow>(
        `SELECT * FROM workflows WHERE trigger_type = 'schedule' AND is_active AND deleted_at IS NULL`,
    )
    return rows
}

type WorkflowWrite = {
    name: string
    description: string | null
    definition: WorkflowDefinition
    triggerType: TriggerType | null
    triggerEvent: string | null
}

/** Creates the workflow and its first version snapshot. Call inside a transaction. */
export async function insertWorkflow(
    db: Queryable,
    userId: number,
    input: WorkflowWrite,
): Promise<WorkflowRow> {
    const { rows } = await db.query<WorkflowRow>(
        `INSERT INTO workflows (user_id, name, description, definition, trigger_type, trigger_event, webhook_id)
         VALUES ($1, $2, $3, $4, $5, $6, replace(gen_random_uuid()::text, '-', ''))
         RETURNING *`,
        [
            userId,
            input.name,
            input.description,
            json(input.definition),
            input.triggerType,
            input.triggerEvent,
        ],
    )
    await insertVersion(db, rows[0])
    return rows[0]
}

/**
 * Updates a workflow. The version only moves forward when the graph itself
 * changed; renaming a workflow does not create a new snapshot.
 * Call inside a transaction.
 */
export async function updateWorkflow(
    db: Queryable,
    userId: number,
    id: number,
    input: WorkflowWrite,
): Promise<WorkflowRow | null> {
    const { rows } = await db.query<WorkflowRow>(
        `UPDATE workflows SET
             name = $3,
             description = $4,
             version = CASE WHEN definition = $5::jsonb THEN version ELSE version + 1 END,
             definition = $5,
             trigger_type = $6,
             trigger_event = $7,
             updated_at = now()
         WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
         RETURNING *`,
        [
            id,
            userId,
            input.name,
            input.description,
            json(input.definition),
            input.triggerType,
            input.triggerEvent,
        ],
    )
    if (!rows[0]) return null
    await insertVersion(db, rows[0])
    return rows[0]
}

async function insertVersion(db: Queryable, row: WorkflowRow) {
    await db.query(
        `INSERT INTO workflow_versions (workflow_id, version, definition)
         VALUES ($1, $2, $3) ON CONFLICT (workflow_id, version) DO NOTHING`,
        [row.id, row.version, json(row.definition)],
    )
}

export async function setWorkflowActive(
    userId: number,
    id: number,
    active: boolean,
): Promise<WorkflowRow | null> {
    const { rows } = await pool.query<WorkflowRow>(
        `UPDATE workflows SET is_active = $3, updated_at = now()
         WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL RETURNING *`,
        [id, userId, active],
    )
    return rows[0] ?? null
}

export async function softDeleteWorkflow(userId: number, id: number): Promise<WorkflowRow | null> {
    const { rows } = await pool.query<WorkflowRow>(
        `UPDATE workflows SET deleted_at = now(), is_active = false, updated_at = now()
         WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL RETURNING *`,
        [id, userId],
    )
    return rows[0] ?? null
}

export async function setWebhookSecretHash(
    userId: number,
    id: number,
    hash: string | null,
): Promise<boolean> {
    const { rowCount } = await pool.query(
        `UPDATE workflows SET webhook_secret_hash = $3
         WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
        [id, userId, hash],
    )
    return rowCount === 1
}

export async function findVersionDefinition(
    workflowId: number,
    version: number,
): Promise<WorkflowDefinition | null> {
    const { rows } = await pool.query<{ definition: WorkflowDefinition }>(
        'SELECT definition FROM workflow_versions WHERE workflow_id = $1 AND version = $2',
        [workflowId, version],
    )
    return rows[0]?.definition ?? null
}
