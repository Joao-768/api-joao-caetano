import type { DataRecord, Paginated } from '@wae/shared'
import { json, pool } from '../db/pool'

type RecordRow = {
    id: string
    collection: string
    data: unknown
    workflow_id: number | null
    workflow_name: string | null
    execution_id: number | null
    created_at: Date
}

function toRecord(row: RecordRow): DataRecord {
    return {
        id: Number(row.id),
        collection: row.collection,
        data: row.data,
        workflowId: row.workflow_id,
        workflowName: row.workflow_name,
        executionId: row.execution_id,
        createdAt: row.created_at.toISOString(),
    }
}

/**
 * Writes the record for one step of one execution. If the step is retried
 * (or its job runs twice after a crash) the unique (execution_id, node_id)
 * constraint turns the second insert into a no-op and the original record is
 * returned: the side effect happens once.
 */
export async function createRecordOnce(input: {
    userId: number
    workflowId: number
    executionId: number
    nodeId: string
    collection: string
    data: unknown
}): Promise<{ record: DataRecord; created: boolean }> {
    const inserted = await pool.query<RecordRow>(
        `INSERT INTO records (user_id, workflow_id, execution_id, node_id, collection, data)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (execution_id, node_id) DO NOTHING
         RETURNING *, NULL::text AS workflow_name`,
        [
            input.userId,
            input.workflowId,
            input.executionId,
            input.nodeId,
            input.collection,
            json(input.data),
        ],
    )
    if (inserted.rows[0]) return { record: toRecord(inserted.rows[0]), created: true }

    const existing = await pool.query<RecordRow>(
        'SELECT *, NULL::text AS workflow_name FROM records WHERE execution_id = $1 AND node_id = $2',
        [input.executionId, input.nodeId],
    )
    return { record: toRecord(existing.rows[0]), created: false }
}

export async function listRecords(
    userId: number,
    filters: { collection?: string; page: number; pageSize: number },
): Promise<Paginated<DataRecord>> {
    const params: unknown[] = [userId]
    let where = 'r.user_id = $1'
    if (filters.collection) {
        params.push(filters.collection)
        where += ' AND r.collection = $2'
    }

    const [items, count] = await Promise.all([
        pool.query<RecordRow>(
            `SELECT r.*, w.name AS workflow_name FROM records r
             LEFT JOIN workflows w ON w.id = r.workflow_id
             WHERE ${where}
             ORDER BY r.created_at DESC, r.id DESC
             LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
            [...params, filters.pageSize, (filters.page - 1) * filters.pageSize],
        ),
        pool.query<{ total: number }>(
            `SELECT count(*)::int AS total FROM records r WHERE ${where}`,
            params,
        ),
    ])

    return {
        items: items.rows.map(toRecord),
        page: filters.page,
        pageSize: filters.pageSize,
        total: count.rows[0].total,
    }
}

export async function listCollections(
    userId: number,
): Promise<{ collection: string; count: number }[]> {
    const { rows } = await pool.query<{ collection: string; count: number }>(
        `SELECT collection, count(*)::int AS count FROM records WHERE user_id = $1
         GROUP BY collection ORDER BY collection`,
        [userId],
    )
    return rows
}
