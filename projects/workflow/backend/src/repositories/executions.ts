import type {
    ExecutionDetail,
    ExecutionError,
    ExecutionStatus,
    ExecutionStep,
    ExecutionSummary,
    NodeType,
    Paginated,
    StepStatus,
    TriggerType,
    WorkflowDefinition,
} from '@wae/shared'
import { json, pool, type Queryable } from '../db/pool'

/**
 * Executions and their steps. Two audiences use this module:
 *
 *   - the API reads history (always scoped to a user_id), and
 *   - the engine moves executions through their lifecycle
 *     queued -> running -> (waiting -> running)* -> success | failed.
 *
 * The engine's writes are guarded by the execution's current state in the
 * WHERE clause, so a duplicate or stale job cannot move an execution that
 * has already moved on.
 */

export type ExecutionRow = {
    id: number
    user_id: number
    workflow_id: number
    workflow_version: number
    status: ExecutionStatus
    trigger_type: TriggerType
    trigger_data: unknown
    current_node_id: string | null
    created_at: Date
    started_at: Date | null
    finished_at: Date | null
    duration_ms: number | null
    error: ExecutionError | null
}

type SummaryRow = ExecutionRow & { workflow_name: string; workflow_deleted: boolean }

type StepRow = {
    id: string
    execution_id: number
    node_id: string
    node_type: NodeType
    status: StepStatus
    attempt: number
    max_attempts: number
    input: unknown
    output: unknown
    error: ExecutionError | null
    started_at: Date
    finished_at: Date | null
    duration_ms: number | null
}

const iso = (date: Date | null) => (date ? date.toISOString() : null)

export function toExecutionSummary(row: SummaryRow): ExecutionSummary {
    return {
        id: row.id,
        workflowId: row.workflow_id,
        workflowName: row.workflow_name,
        workflowDeleted: row.workflow_deleted,
        workflowVersion: row.workflow_version,
        status: row.status,
        triggerType: row.trigger_type,
        createdAt: row.created_at.toISOString(),
        startedAt: iso(row.started_at),
        finishedAt: iso(row.finished_at),
        durationMs: row.duration_ms,
        error: row.error,
    }
}

function toStep(row: StepRow): ExecutionStep {
    return {
        id: Number(row.id),
        nodeId: row.node_id,
        nodeType: row.node_type,
        status: row.status,
        attempt: row.attempt,
        maxAttempts: row.max_attempts,
        input: row.input,
        output: row.output,
        error: row.error,
        startedAt: row.started_at.toISOString(),
        finishedAt: iso(row.finished_at),
        durationMs: row.duration_ms,
    }
}

// ---------------------------------------------------------------------------
// Reading history (API)
// ---------------------------------------------------------------------------

export type ExecutionFilters = {
    workflowId?: number
    status?: ExecutionStatus
    triggerType?: TriggerType
    from?: Date
    to?: Date
    page: number
    pageSize: number
}

const SUMMARY_SELECT = `
    SELECT e.*, w.name AS workflow_name, (w.deleted_at IS NOT NULL) AS workflow_deleted
    FROM executions e
    JOIN workflows w ON w.id = e.workflow_id
`

export async function listExecutions(
    userId: number,
    filters: ExecutionFilters,
): Promise<Paginated<ExecutionSummary>> {
    const where = ['e.user_id = $1']
    const params: unknown[] = [userId]
    const add = (clause: string, value: unknown) => {
        params.push(value)
        where.push(clause.replace('?', `$${params.length}`))
    }

    if (filters.workflowId) add('e.workflow_id = ?', filters.workflowId)
    if (filters.status) add('e.status = ?', filters.status)
    if (filters.triggerType) add('e.trigger_type = ?', filters.triggerType)
    if (filters.from) add('e.created_at >= ?', filters.from)
    if (filters.to) add('e.created_at < ?', filters.to)

    const whereSql = where.join(' AND ')
    const offset = (filters.page - 1) * filters.pageSize

    const [items, count] = await Promise.all([
        pool.query<SummaryRow>(
            `${SUMMARY_SELECT} WHERE ${whereSql}
             ORDER BY e.created_at DESC, e.id DESC
             LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
            [...params, filters.pageSize, offset],
        ),
        pool.query<{ total: number }>(
            `SELECT count(*)::int AS total FROM executions e WHERE ${whereSql}`,
            params,
        ),
    ])

    return {
        items: items.rows.map(toExecutionSummary),
        page: filters.page,
        pageSize: filters.pageSize,
        total: count.rows[0].total,
    }
}

export async function recentExecutions(userId: number, limit: number): Promise<ExecutionSummary[]> {
    const { rows } = await pool.query<SummaryRow>(
        `${SUMMARY_SELECT} WHERE e.user_id = $1 ORDER BY e.created_at DESC, e.id DESC LIMIT $2`,
        [userId, limit],
    )
    return rows.map(toExecutionSummary)
}

export async function findExecutionDetail(
    userId: number,
    id: number,
): Promise<ExecutionDetail | null> {
    const { rows } = await pool.query<SummaryRow & { definition: WorkflowDefinition }>(
        `SELECT e.*, w.name AS workflow_name, (w.deleted_at IS NOT NULL) AS workflow_deleted, v.definition
         FROM executions e
         JOIN workflows w ON w.id = e.workflow_id
         JOIN workflow_versions v ON v.workflow_id = e.workflow_id AND v.version = e.workflow_version
         WHERE e.id = $1 AND e.user_id = $2`,
        [id, userId],
    )
    const row = rows[0]
    if (!row) return null

    return {
        ...toExecutionSummary(row),
        triggerData: row.trigger_data,
        currentNodeId: row.current_node_id,
        definition: row.definition,
        steps: await listSteps(id),
    }
}

export async function listSteps(executionId: number): Promise<ExecutionStep[]> {
    const { rows } = await pool.query<StepRow>(
        'SELECT * FROM execution_steps WHERE execution_id = $1 ORDER BY id',
        [executionId],
    )
    return rows.map(toStep)
}

// ---------------------------------------------------------------------------
// Lifecycle (engine)
// ---------------------------------------------------------------------------

export async function insertExecution(
    db: Queryable,
    input: {
        userId: number
        workflowId: number
        workflowVersion: number
        triggerType: TriggerType
        triggerData: unknown
        startNodeId: string | null
    },
): Promise<ExecutionRow> {
    const { rows } = await db.query<ExecutionRow>(
        `INSERT INTO executions (user_id, workflow_id, workflow_version, status, trigger_type, trigger_data, current_node_id)
         VALUES ($1, $2, $3, 'queued', $4, $5, $6) RETURNING *`,
        [
            input.userId,
            input.workflowId,
            input.workflowVersion,
            input.triggerType,
            json(input.triggerData),
            input.startNodeId,
        ],
    )
    return rows[0]
}

/**
 * Takes ownership of `nodeId` for this job. Succeeds only if the execution
 * is still in progress and its cursor points at this node; otherwise the job
 * is stale (a duplicate, or the execution already finished) and must do
 * nothing.
 */
export async function claimNode(executionId: number, nodeId: string): Promise<ExecutionRow | null> {
    const { rows } = await pool.query<ExecutionRow>(
        `UPDATE executions SET status = 'running', started_at = coalesce(started_at, now())
         WHERE id = $1 AND current_node_id = $2 AND status IN ('queued', 'running', 'waiting')
         RETURNING *`,
        [executionId, nodeId],
    )
    return rows[0] ?? null
}

/** Moves the cursor from one node to the next. */
export async function advanceExecution(
    db: Queryable,
    executionId: number,
    fromNodeId: string,
    toNodeId: string,
    status: 'running' | 'waiting',
): Promise<boolean> {
    const { rowCount } = await db.query(
        `UPDATE executions SET current_node_id = $3, status = $4
         WHERE id = $1 AND current_node_id = $2 AND status IN ('running', 'waiting')`,
        [executionId, fromNodeId, toNodeId, status],
    )
    return rowCount === 1
}

export async function finishExecution(
    db: Queryable,
    executionId: number,
    status: 'success' | 'failed',
    error: ExecutionError | null = null,
): Promise<boolean> {
    const { rowCount } = await db.query(
        `UPDATE executions SET
             status = $2,
             error = $3,
             current_node_id = CASE WHEN $2 = 'failed' THEN current_node_id END,
             started_at = coalesce(started_at, now()),
             finished_at = now(),
             duration_ms = greatest(0, round(extract(epoch FROM now() - coalesce(started_at, created_at)) * 1000))::int
         WHERE id = $1 AND status NOT IN ('success', 'failed')`,
        [executionId, status, json(error)],
    )
    return rowCount === 1
}

export async function hasSucceeded(executionId: number, nodeId: string): Promise<boolean> {
    const { rows } = await pool.query(
        `SELECT 1 FROM execution_steps WHERE execution_id = $1 AND node_id = $2 AND status IN ('success', 'waiting') LIMIT 1`,
        [executionId, nodeId],
    )
    return rows.length > 0
}

/**
 * Outputs of every node that has completed, keyed by node id. This is the
 * `steps` part of the execution context; rebuilding it from the database on
 * every job is what lets any worker pick up any step.
 */
export async function completedOutputs(executionId: number): Promise<Record<string, unknown>> {
    const { rows } = await pool.query<{ node_id: string; output: unknown }>(
        `SELECT node_id, output FROM execution_steps
         WHERE execution_id = $1 AND status IN ('success', 'waiting')
         ORDER BY id`,
        [executionId],
    )
    return Object.fromEntries(rows.map((row) => [row.node_id, row.output]))
}

export async function startStep(input: {
    executionId: number
    nodeId: string
    nodeType: NodeType
    attempt: number
    maxAttempts: number
}): Promise<number> {
    const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO execution_steps (execution_id, node_id, node_type, status, attempt, max_attempts)
         VALUES ($1, $2, $3, 'running', $4, $5) RETURNING id`,
        [input.executionId, input.nodeId, input.nodeType, input.attempt, input.maxAttempts],
    )
    return Number(rows[0].id)
}

export async function finishStep(
    db: Queryable,
    stepId: number,
    result: {
        status: StepStatus
        input?: unknown
        output?: unknown
        error?: ExecutionError | null
    },
): Promise<void> {
    await db.query(
        `UPDATE execution_steps SET
             status = $2,
             input = $3,
             output = $4,
             error = $5,
             finished_at = CASE WHEN $2 = 'waiting' THEN NULL ELSE now() END,
             duration_ms = CASE WHEN $2 = 'waiting' THEN NULL
                 ELSE greatest(0, round(extract(epoch FROM now() - started_at) * 1000))::int END
         WHERE id = $1`,
        [
            stepId,
            result.status,
            json(result.input),
            json(result.output),
            json(result.error ?? null),
        ],
    )
}

/** A delay step stops "waiting" when the node after it starts. */
export async function completeWaitingSteps(executionId: number): Promise<void> {
    await pool.query(
        `UPDATE execution_steps SET
             status = 'success',
             finished_at = now(),
             duration_ms = greatest(0, round(extract(epoch FROM now() - started_at) * 1000))::int
         WHERE execution_id = $1 AND status = 'waiting'`,
        [executionId],
    )
}

/** Records the nodes that never ran because their branch was not taken. */
export async function insertSkippedSteps(
    db: Queryable,
    executionId: number,
    nodes: { id: string; type: NodeType }[],
): Promise<void> {
    for (const node of nodes) {
        await db.query(
            `INSERT INTO execution_steps (execution_id, node_id, node_type, status, attempt, max_attempts, finished_at, duration_ms)
             VALUES ($1, $2, $3, 'skipped', 0, 0, now(), 0)`,
            [executionId, node.id, node.type],
        )
    }
}

export async function executedNodeIds(db: Queryable, executionId: number): Promise<Set<string>> {
    const { rows } = await db.query<{ node_id: string }>(
        'SELECT DISTINCT node_id FROM execution_steps WHERE execution_id = $1',
        [executionId],
    )
    return new Set(rows.map((row) => row.node_id))
}

/** Used when the engine itself crashed mid-step: close any step left open. */
export async function failOpenSteps(executionId: number, error: ExecutionError): Promise<void> {
    await pool.query(
        `UPDATE execution_steps SET
             status = 'failed',
             error = $2,
             finished_at = now(),
             duration_ms = greatest(0, round(extract(epoch FROM now() - started_at) * 1000))::int
         WHERE execution_id = $1 AND status = 'running'`,
        [executionId, json(error)],
    )
}
