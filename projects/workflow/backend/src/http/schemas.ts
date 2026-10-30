import { z } from 'zod'
import {
    EVENT_NAME_PATTERN,
    EXECUTION_STATUSES,
    TRIGGER_TYPES,
    workflowDefinitionSchema,
} from '@wae/shared'

/**
 * Request validation. Every route parses its input with one of these before
 * touching a service; a failure becomes a 400 with the list of problems
 * (see errorHandler.ts).
 */

export const idParam = z.object({ id: z.coerce.number().int().positive() })

const email = z.email('Enter a valid email address').trim().toLowerCase().max(254)

export const password = z
    .string()
    .min(8, 'Use at least 8 characters')
    .max(128, 'Use at most 128 characters')
    .regex(/[A-Za-z]/, 'Include at least one letter')
    .regex(/\d/, 'Include at least one digit')

const name = z.string().trim().min(1, 'Name is required').max(100)

export const registerBody = z.object({ name, email, password })

export const loginBody = z.object({
    email,
    password: z.string().min(1, 'Password is required').max(128),
})

export const updateAccountBody = z.object({ name })

export const changePasswordBody = z.object({
    currentPassword: z.string().min(1).max(128),
    newPassword: password,
})

/** Any JSON object: events, webhooks and manual runs all carry one. */
export const payloadObject = z.record(z.string(), z.unknown())

export const workflowBody = z.object({
    name: z.string().trim().min(1, 'Name is required').max(120),
    description: z.string().trim().max(1000).nullish(),
    definition: workflowDefinitionSchema.optional(),
})

export const runBody = z.object({ payload: payloadObject.default({}) })

export const eventBody = z.object({
    type: z
        .string()
        .trim()
        .regex(EVENT_NAME_PATTERN, 'Event names use letters, digits, dots, dashes and underscores'),
    data: payloadObject.default({}),
})

const page = {
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
}

export const executionsQuery = z.object({
    ...page,
    workflowId: z.coerce.number().int().positive().optional(),
    status: z.enum(EXECUTION_STATUSES).optional(),
    triggerType: z.enum(TRIGGER_TYPES).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
})

export const recordsQuery = z.object({
    ...page,
    collection: z.string().trim().max(50).optional(),
})

export const webhookParams = z.object({
    webhookId: z.string().regex(/^[a-f0-9]{32}$/, 'Unknown webhook'),
})
