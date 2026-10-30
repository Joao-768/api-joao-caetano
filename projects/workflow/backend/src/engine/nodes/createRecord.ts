import { resolveTemplate } from '@wae/shared'
import { NodeError } from '../errors'
import { defineNode } from './types'

/**
 * Persists structured JSON into the `records` table. Values keep their types
 * ("{{event.total}}" stays a number), and nested objects are resolved too.
 * The write is idempotent per execution step, so a retry cannot duplicate it.
 */
export const createRecordNode = defineNode<'create_record', { collection: string; data: unknown }>({
    prepare(node, context) {
        return {
            collection: node.config.collection,
            data: resolveTemplate(node.config.data, context),
        }
    },

    async run(input, node, runtime) {
        const size = JSON.stringify(input.data).length
        if (size > 100_000) {
            throw new NodeError(
                'record_too_large',
                `The record is ${size} bytes; the limit is 100000`,
                false,
            )
        }
        const { record, created } = await runtime.services.createRecord({
            userId: runtime.execution.userId,
            workflowId: runtime.execution.workflowId,
            executionId: runtime.execution.id,
            nodeId: node.id,
            collection: input.collection,
            data: input.data,
        })
        return {
            output: {
                id: record.id,
                collection: record.collection,
                data: record.data,
                createdAt: record.createdAt,
                ...(created
                    ? {}
                    : { note: 'Record already existed for this step; not written twice' }),
            },
        }
    },
})
