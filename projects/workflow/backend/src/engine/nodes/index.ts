import type { NodeType } from '@wae/shared'
import { conditionNode } from './condition'
import { createRecordNode } from './createRecord'
import { delayNode } from './delay'
import { emailNode } from './email'
import { httpRequestNode } from './httpRequest'
import { notificationNode } from './notification'
import { triggerNode } from './trigger'
import type { NodeHandler, RegisteredNode } from './types'

/**
 * The registry: node type -> implementation. Adding a node type means adding
 * its schema in shared/src/definition.ts and one entry here. The `satisfies`
 * check makes TypeScript complain if a type is missing.
 */
export const nodeHandlers = {
    trigger: triggerNode,
    condition: conditionNode,
    delay: delayNode,
    http_request: httpRequestNode,
    notification: notificationNode,
    email: emailNode,
    create_record: createRecordNode,
} satisfies { [T in NodeType]: RegisteredNode<T> }

/**
 * Handlers are typed per node type; the executor works with the union. This
 * one widening is safe because the registry key and the node type match.
 */
export function handlerFor(type: NodeType): NodeHandler<NodeType, unknown> {
    return nodeHandlers[type] as unknown as NodeHandler<NodeType, unknown>
}
