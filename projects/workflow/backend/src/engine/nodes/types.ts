import type { BranchHandle, ExecutionContext, NodeOfType, NodeType } from '@wae/shared'
import type { EmailSender } from '../../adapters/email'
import type { HttpRequest, HttpResponse } from '../../adapters/httpClient'
import type { createRecordOnce } from '../../repositories/records'

/**
 * Every node type implements the same three-part contract, which keeps the
 * executor free of per-type logic:
 *
 *   prepare(node, context)  Resolve templates into the concrete input for
 *                           this run. Pure: no I/O. What it returns is
 *                           stored as the step's `input`.
 *   redact(input)           Optional. Hides secrets (auth headers) in the
 *                           stored copy of the input.
 *   run(input, runtime)     Do the work. Returns the step's `output`, plus
 *                           which branch to take (conditions) or how long to
 *                           wait before the next node (delays).
 */

export type NodeResult = {
    output: unknown
    /** Conditions only: which outgoing handle to follow. */
    branch?: BranchHandle
    /** Delay only: schedule the next node this many ms from now. */
    waitMs?: number
}

/** Side-effecting services, injected so tests can replace them. */
export type EngineServices = {
    email: EmailSender
    http: (request: HttpRequest) => Promise<HttpResponse>
    createRecord: typeof createRecordOnce
}

export type NodeRuntime = {
    execution: { id: number; userId: number; workflowId: number }
    signal: AbortSignal
    services: EngineServices
}

export type NodeHandler<T extends NodeType, Input> = {
    prepare(node: NodeOfType<T>, context: ExecutionContext): Input
    redact?(input: Input): unknown
    run(input: Input, node: NodeOfType<T>, runtime: NodeRuntime): Promise<NodeResult>
}

/** Identity helper that lets TypeScript infer `Input` per handler. */
export function defineNode<T extends NodeType, Input>(
    handler: NodeHandler<T, Input>,
): NodeHandler<T, Input> {
    return handler
}

/** What the registry stores: any input type, as long as the node type matches. */
export type RegisteredNode<T extends NodeType> = {
    prepare(node: NodeOfType<T>, context: ExecutionContext): unknown
    redact?(input: never): unknown
    run(input: never, node: NodeOfType<T>, runtime: NodeRuntime): Promise<NodeResult>
}
