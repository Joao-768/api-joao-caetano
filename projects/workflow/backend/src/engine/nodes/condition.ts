import { readPath, resolveTemplate, type ConditionOperator } from '@wae/shared'
import { evaluateCondition } from '../conditions'
import { defineNode } from './types'

type ConditionInput = {
    path: string
    left: unknown
    operator: ConditionOperator
    right: unknown
}

/**
 * Reads a value from the context, compares it, and tells the executor which
 * branch to follow. The left side is a path (a missing value is allowed:
 * that is what "exists" checks); the right side may contain templates.
 */
export const conditionNode = defineNode<'condition', ConditionInput>({
    prepare(node, context) {
        return {
            path: node.config.path,
            left: readPath(context, node.config.path),
            operator: node.config.operator,
            right:
                node.config.value === undefined
                    ? undefined
                    : resolveTemplate(node.config.value, context),
        }
    },

    async run(input) {
        const outcome = evaluateCondition(input.left, input.operator, input.right)
        return { output: outcome, branch: outcome.result ? 'true' : 'false' }
    },
})
