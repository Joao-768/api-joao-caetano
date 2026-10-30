/**
 * The vocabulary of the engine: every node type, trigger type, operator and
 * status lives here once, so the API, the worker and the builder never drift
 * apart on a magic string.
 */

export const NODE_TYPES = [
    'trigger',
    'condition',
    'http_request',
    'notification',
    'email',
    'create_record',
    'delay',
] as const
export type NodeType = (typeof NODE_TYPES)[number]

export const TRIGGER_TYPES = ['manual', 'event', 'webhook', 'schedule'] as const
export type TriggerType = (typeof TRIGGER_TYPES)[number]

export const CONDITION_OPERATORS = [
    'equals',
    'not_equals',
    'gt',
    'gte',
    'lt',
    'lte',
    'contains',
    'not_contains',
    'exists',
    'not_exists',
] as const
export type ConditionOperator = (typeof CONDITION_OPERATORS)[number]

/** Operators that only look at the left-hand value. */
export const UNARY_OPERATORS: readonly ConditionOperator[] = ['exists', 'not_exists']

export const OPERATOR_LABELS: Record<ConditionOperator, string> = {
    equals: 'equals',
    not_equals: 'does not equal',
    gt: 'is greater than',
    gte: 'is greater than or equal to',
    lt: 'is less than',
    lte: 'is less than or equal to',
    contains: 'contains',
    not_contains: 'does not contain',
    exists: 'exists',
    not_exists: 'does not exist',
}

/** A condition node has exactly these two outgoing handles. */
export const BRANCH_HANDLES = ['true', 'false'] as const
export type BranchHandle = (typeof BRANCH_HANDLES)[number]

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const
export type HttpMethod = (typeof HTTP_METHODS)[number]

export const HTTP_BODY_TYPES = ['none', 'json', 'text'] as const
export type HttpBodyType = (typeof HTTP_BODY_TYPES)[number]

export const NOTIFICATION_LEVELS = ['info', 'warning', 'critical'] as const
export type NotificationLevel = (typeof NOTIFICATION_LEVELS)[number]

export const DELAY_UNITS = ['seconds', 'minutes', 'hours'] as const
export type DelayUnit = (typeof DELAY_UNITS)[number]

export const DELAY_UNIT_MS: Record<DelayUnit, number> = {
    seconds: 1_000,
    minutes: 60_000,
    hours: 3_600_000,
}

/** Longest delay a single node may wait. */
export const MAX_DELAY_MS = 7 * 24 * 3_600_000

export const HTTP_TIMEOUT_DEFAULT_MS = 10_000
export const HTTP_TIMEOUT_MAX_MS = 30_000

export const MAX_NODES = 50
export const MAX_EDGES = 100

/** Lifecycle of a whole workflow run. */
export const EXECUTION_STATUSES = ['queued', 'running', 'waiting', 'success', 'failed'] as const
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number]

export const FINISHED_EXECUTION_STATUSES: readonly ExecutionStatus[] = ['success', 'failed']

/**
 * Lifecycle of a single node attempt.
 * - retrying: this attempt failed, another one is scheduled
 * - waiting:  a delay node that is holding the execution
 * - skipped:  the node sat on a branch that was not taken
 */
export const STEP_STATUSES = [
    'running',
    'success',
    'failed',
    'retrying',
    'waiting',
    'skipped',
] as const
export type StepStatus = (typeof STEP_STATUSES)[number]

/** Roots a template or condition path may start from. */
export const CONTEXT_ROOTS = ['event', 'steps', 'trigger', 'execution'] as const
export type ContextRoot = (typeof CONTEXT_ROOTS)[number]

/**
 * How many times a node is attempted before the execution fails. Only nodes
 * that talk to the outside world are retried: re-running a condition or a
 * template with the same input gives the same answer.
 */
export const DEFAULT_MAX_ATTEMPTS: Record<NodeType, number> = {
    trigger: 1,
    condition: 1,
    http_request: 3,
    notification: 1,
    email: 3,
    create_record: 2,
    delay: 1,
}

export const MAX_ATTEMPTS_LIMIT = 5

export type NodeCategory = 'trigger' | 'logic' | 'action'

export const NODE_META: Record<
    NodeType,
    { label: string; description: string; category: NodeCategory }
> = {
    trigger: {
        label: 'Trigger',
        description: 'Where every execution starts.',
        category: 'trigger',
    },
    condition: {
        label: 'Condition',
        description: 'Compare a value and branch into true or false.',
        category: 'logic',
    },
    delay: {
        label: 'Delay',
        description: 'Pause the execution and resume it later.',
        category: 'logic',
    },
    http_request: {
        label: 'HTTP request',
        description: 'Call an external URL and keep the response.',
        category: 'action',
    },
    notification: {
        label: 'Notification',
        description: 'Emit an internal notification.',
        category: 'action',
    },
    email: {
        label: 'Email',
        description: 'Send an email over SMTP, or simulate it.',
        category: 'action',
    },
    create_record: {
        label: 'Create record',
        description: 'Store a JSON record in a collection.',
        category: 'action',
    },
}

export const TRIGGER_LABELS: Record<TriggerType, string> = {
    manual: 'Manual',
    event: 'Event',
    webhook: 'Webhook',
    schedule: 'Schedule',
}
