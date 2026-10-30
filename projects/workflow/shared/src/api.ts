import type { ExecutionStatus, NodeType, StepStatus, TriggerType } from './constants'
import type { WorkflowDefinition } from './definition'
import type { ValidationIssue } from './validation'

/**
 * Shapes returned by the HTTP API. The backend builds them from database rows
 * and the frontend consumes them, so both sides share one definition.
 * Dates travel as ISO strings.
 */

export type ApiErrorBody = {
    error: {
        code: string
        message: string
        details?: unknown
    }
}

export type User = {
    id: number
    name: string
    email: string
    createdAt: string
}

export type AuthResponse = {
    token: string
    user: User
}

export type ExecutionRef = {
    id: number
    status: ExecutionStatus
    createdAt: string
}

export type WorkflowSummary = {
    id: number
    name: string
    description: string | null
    triggerType: TriggerType | null
    triggerEvent: string | null
    isActive: boolean
    version: number
    createdAt: string
    updatedAt: string
    lastExecution: ExecutionRef | null
}

export type WebhookInfo = {
    id: string
    /** Path relative to the API base URL, e.g. /webhooks/abc123 */
    path: string
    hasSecret: boolean
}

export type WorkflowDetail = WorkflowSummary & {
    definition: WorkflowDefinition
    webhook: WebhookInfo
    nextScheduledRun: string | null
    issues: ValidationIssue[]
}

export type ExecutionSummary = {
    id: number
    workflowId: number
    workflowName: string
    workflowDeleted: boolean
    workflowVersion: number
    status: ExecutionStatus
    triggerType: TriggerType
    createdAt: string
    startedAt: string | null
    finishedAt: string | null
    durationMs: number | null
    error: ExecutionError | null
}

export type ExecutionError = {
    code: string
    message: string
    nodeId?: string
}

export type ExecutionStep = {
    id: number
    nodeId: string
    nodeType: NodeType
    status: StepStatus
    attempt: number
    maxAttempts: number
    input: unknown
    output: unknown
    error: ExecutionError | null
    startedAt: string
    finishedAt: string | null
    durationMs: number | null
}

export type ExecutionDetail = ExecutionSummary & {
    triggerData: unknown
    currentNodeId: string | null
    definition: WorkflowDefinition
    steps: ExecutionStep[]
}

export type Paginated<T> = {
    items: T[]
    page: number
    pageSize: number
    total: number
}

export type QueuedExecution = {
    workflowId: number
    workflowName: string
    executionId: number
}

export type EventResponse = {
    event: string
    matched: QueuedExecution[]
}

export type WebhookResponse = {
    status: 'queued'
    executionId: number
}

export type DashboardStats = {
    workflows: { total: number; active: number }
    last24h: { total: number; success: number; failed: number; inProgress: number }
    successRate: number | null
    failedTotal: number
    daily: { date: string; success: number; failed: number }[]
    recent: ExecutionSummary[]
}

export type DataRecord = {
    id: number
    collection: string
    data: unknown
    workflowId: number | null
    workflowName: string | null
    executionId: number | null
    createdAt: string
}
