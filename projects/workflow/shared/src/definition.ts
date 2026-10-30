import { z } from 'zod'
import {
    BRANCH_HANDLES,
    CONDITION_OPERATORS,
    DELAY_UNIT_MS,
    DELAY_UNITS,
    HTTP_BODY_TYPES,
    HTTP_METHODS,
    HTTP_TIMEOUT_DEFAULT_MS,
    HTTP_TIMEOUT_MAX_MS,
    MAX_ATTEMPTS_LIMIT,
    MAX_DELAY_MS,
    MAX_EDGES,
    MAX_NODES,
    NODE_TYPES,
    NOTIFICATION_LEVELS,
    UNARY_OPERATORS,
} from './constants'
import { checkCron } from './cron'

/**
 * A workflow is stored as a graph: a list of nodes and the edges between
 * them. This file describes that graph at two levels of strictness.
 *
 * 1. The *structural* schema (`workflowDefinitionSchema`) only checks the
 *    shape: nodes have ids and types, edges have a source and a target. A
 *    draft that passes it can be saved, even if it is not finished yet.
 *
 * 2. The *node config* schemas below check that each node is fully and
 *    correctly configured. `validateDefinition` (validation.ts) applies them
 *    together with the graph rules before a workflow may be activated or run.
 */

export const NODE_ID_PATTERN = /^[a-z][a-z0-9_]{0,39}$/

const nodeId = z
    .string()
    .regex(NODE_ID_PATTERN, 'Node ids use lowercase letters, digits and underscores')

const position = z.object({ x: z.number().finite(), y: z.number().finite() })

// ---------------------------------------------------------------------------
// Structural schema
// ---------------------------------------------------------------------------

export const workflowNodeShapeSchema = z.object({
    id: nodeId,
    type: z.enum(NODE_TYPES),
    label: z.string().max(80).optional(),
    position,
    config: z.record(z.string(), z.unknown()),
})

export const workflowEdgeSchema = z.object({
    id: z.string().min(1).max(100),
    source: nodeId,
    target: nodeId,
    sourceHandle: z.enum(BRANCH_HANDLES).nullish(),
})

export const workflowDefinitionSchema = z.object({
    nodes: z.array(workflowNodeShapeSchema).max(MAX_NODES, `At most ${MAX_NODES} nodes`),
    edges: z.array(workflowEdgeSchema).max(MAX_EDGES, `At most ${MAX_EDGES} edges`),
})

export type WorkflowNodeShape = z.infer<typeof workflowNodeShapeSchema>
export type WorkflowEdge = z.infer<typeof workflowEdgeSchema>
export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>

// ---------------------------------------------------------------------------
// Node configuration schemas
// ---------------------------------------------------------------------------

export const EVENT_NAME_PATTERN = /^[a-z0-9][a-z0-9_.-]{0,99}$/i

export const triggerConfigSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('manual') }),
    z.object({
        type: z.literal('event'),
        eventName: z
            .string()
            .regex(
                EVENT_NAME_PATTERN,
                'Event names use letters, digits, dots, dashes and underscores',
            ),
    }),
    z.object({ type: z.literal('webhook') }),
    z
        .object({
            type: z.literal('schedule'),
            cron: z.string().min(1, 'A cron expression is required'),
            timezone: z.string().default('UTC'),
        })
        .superRefine((value, ctx) => {
            const check = checkCron(value.cron, value.timezone)
            if (!check.valid) ctx.addIssue({ code: 'custom', path: ['cron'], message: check.error })
        }),
])

export const conditionConfigSchema = z
    .object({
        path: z.string().trim().min(1, 'Choose the value to compare'),
        operator: z.enum(CONDITION_OPERATORS),
        value: z.string().max(500).optional(),
    })
    .superRefine((value, ctx) => {
        if (!UNARY_OPERATORS.includes(value.operator) && value.value === undefined) {
            ctx.addIssue({
                code: 'custom',
                path: ['value'],
                message: 'A value to compare is required',
            })
        }
    })

const keyValue = z.object({
    key: z.string().trim().min(1, 'Header and query keys cannot be empty').max(200),
    value: z.string().max(2000),
})

const maxAttempts = z.number().int().min(1).max(MAX_ATTEMPTS_LIMIT).optional()

export const httpRequestConfigSchema = z
    .object({
        method: z.enum(HTTP_METHODS),
        url: z
            .string()
            .trim()
            .min(1, 'A URL is required')
            .refine(
                (url) => /^https?:\/\//i.test(url) || url.startsWith('{{'),
                'The URL must start with http:// or https://',
            ),
        headers: z.array(keyValue).max(20).default([]),
        query: z.array(keyValue).max(20).default([]),
        bodyType: z.enum(HTTP_BODY_TYPES).default('none'),
        body: z.unknown().optional(),
        timeoutMs: z
            .number()
            .int()
            .min(500)
            .max(HTTP_TIMEOUT_MAX_MS)
            .default(HTTP_TIMEOUT_DEFAULT_MS),
        maxAttempts,
    })
    .superRefine((value, ctx) => {
        if (value.bodyType === 'text' && typeof value.body !== 'string') {
            ctx.addIssue({
                code: 'custom',
                path: ['body'],
                message: 'A text body must be a string',
            })
        }
        if (value.bodyType !== 'none' && value.method === 'GET') {
            ctx.addIssue({
                code: 'custom',
                path: ['bodyType'],
                message: 'GET requests cannot send a body',
            })
        }
    })

export const notificationConfigSchema = z.object({
    message: z.string().trim().min(1, 'A message is required').max(2000),
    level: z.enum(NOTIFICATION_LEVELS).default('info'),
})

export const emailConfigSchema = z.object({
    to: z.string().trim().min(1, 'A recipient is required').max(320),
    subject: z.string().trim().min(1, 'A subject is required').max(300),
    body: z.string().max(10_000).default(''),
    maxAttempts,
})

export const COLLECTION_PATTERN = /^[a-z][a-z0-9_]{0,49}$/

export const createRecordConfigSchema = z.object({
    collection: z
        .string()
        .regex(COLLECTION_PATTERN, 'Collections use lowercase letters, digits and underscores'),
    data: z.record(z.string(), z.unknown()),
})

export const delayConfigSchema = z
    .object({
        amount: z.number().int().min(1, 'Wait at least one unit'),
        unit: z.enum(DELAY_UNITS),
    })
    .refine((value) => value.amount * DELAY_UNIT_MS[value.unit] <= MAX_DELAY_MS, {
        message: 'A single delay cannot exceed 7 days',
        path: ['amount'],
    })

// ---------------------------------------------------------------------------
// Fully typed nodes, available once a definition has been validated
// ---------------------------------------------------------------------------

function typedNode<T extends (typeof NODE_TYPES)[number], C extends z.ZodType>(type: T, config: C) {
    return z.object({
        id: nodeId,
        type: z.literal(type),
        label: z.string().max(80).optional(),
        position,
        config,
    })
}

export const workflowNodeSchema = z.discriminatedUnion('type', [
    typedNode('trigger', triggerConfigSchema),
    typedNode('condition', conditionConfigSchema),
    typedNode('http_request', httpRequestConfigSchema),
    typedNode('notification', notificationConfigSchema),
    typedNode('email', emailConfigSchema),
    typedNode('create_record', createRecordConfigSchema),
    typedNode('delay', delayConfigSchema),
])

export type WorkflowNode = z.infer<typeof workflowNodeSchema>
export type TriggerConfig = z.infer<typeof triggerConfigSchema>
export type ConditionConfig = z.infer<typeof conditionConfigSchema>
export type HttpRequestConfig = z.infer<typeof httpRequestConfigSchema>
export type NotificationConfig = z.infer<typeof notificationConfigSchema>
export type EmailConfig = z.infer<typeof emailConfigSchema>
export type CreateRecordConfig = z.infer<typeof createRecordConfigSchema>
export type DelayConfig = z.infer<typeof delayConfigSchema>

/** Narrow a node union member by its type. */
export type NodeOfType<T extends WorkflowNode['type']> = Extract<WorkflowNode, { type: T }>

/** A definition whose nodes passed every config schema and graph rule. */
export type ValidWorkflowDefinition = {
    nodes: WorkflowNode[]
    edges: WorkflowEdge[]
}
