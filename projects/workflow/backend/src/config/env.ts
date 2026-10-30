import 'dotenv/config'
import { z } from 'zod'

/**
 * Every environment variable the API and the worker read, validated once at
 * startup. A missing or malformed value stops the process with a clear
 * message instead of surfacing later as an obscure runtime error.
 */

const bool = z
    .enum(['true', 'false', '1', '0'])
    .transform((value) => value === 'true' || value === '1')

const schema = z
    .object({
        NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
        LOG_LEVEL: z
            .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
            .default('info'),
        DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
        DATABASE_SSL: bool.default(false),
        /**
         * Shares the Supabase pooler with Pulse Monitor: in session mode every
         * pooled connection holds one of the project's backend connections.
         */
        DATABASE_POOL_MAX: z.coerce.number().int().min(2).max(50).default(5),
        REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
        QUEUE_PREFIX: z.string().min(1).default('wae'),

        JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
        JWT_EXPIRES_IN: z.string().default('7d'),

        /** Comma-separated list of origins allowed by CORS. */
        FRONTEND_URL: z.string().default('http://localhost:5176'),

        /**
         * Node jobs running at the same time. The worker always runs inside the
         * host process, which other projects share, so the default is low.
         */
        WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(2),
        /** First retry waits this long, then doubles on every attempt. */
        RETRY_BACKOFF_MS: z.coerce.number().int().min(10).default(2000),
        /** Upper bound for any single node, whatever its own config says. */
        NODE_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30_000),

        /**
         * Budget of active time per execution; delay nodes do not count. This
         * and the two limits below keep one bad workflow from starving the
         * other projects that share the process.
         */
        EXECUTION_TIMEOUT_MS: z.coerce.number().int().min(1000).default(300_000),
        /** Ceiling on attempts per node, whatever the node itself asks for. */
        MAX_ATTEMPTS_CAP: z.coerce.number().int().min(1).max(5).default(3),
        /** Queued or running executions one user may have; more are refused. */
        MAX_ACTIVE_EXECUTIONS_PER_USER: z.coerce.number().int().min(1).default(5),

        HTTP_ALLOW_PRIVATE_NETWORKS: bool.default(false),
        HTTP_MAX_RESPONSE_BYTES: z.coerce.number().int().min(1024).default(1_000_000),

        /** Email goes through Resend's HTTP API; without a key it is simulated. */
        RESEND_API_KEY: z.string().optional(),
        EMAIL_FROM: z.string().default('FlowEngine <onboarding@resend.dev>'),
    })
    .superRefine((env, ctx) => {
        if (env.NODE_ENV === 'production' && env.JWT_SECRET.length < 32) {
            ctx.addIssue({
                code: 'custom',
                path: ['JWT_SECRET'],
                message: 'Use at least 32 characters for JWT_SECRET in production',
            })
        }
    })

/**
 * Hosted by api-joao-caetano next to other projects, so every variable of this
 * one carries the WORKFLOW_ prefix (WORKFLOW_DATABASE_URL, WORKFLOW_JWT_SECRET...)
 * and cannot collide with another project's. NODE_ENV is shared.
 */
const PREFIX = 'WORKFLOW_'

function scopedEnv(): Record<string, string | undefined> {
    const scoped: Record<string, string | undefined> = { NODE_ENV: process.env.NODE_ENV }
    for (const [key, value] of Object.entries(process.env)) {
        if (key.startsWith(PREFIX)) scoped[key.slice(PREFIX.length)] = value
    }
    return scoped
}

function load() {
    const parsed = schema.safeParse(scopedEnv())
    if (!parsed.success) {
        const lines = parsed.error.issues.map(
            (issue) => `  ${PREFIX}${issue.path.join('.')}: ${issue.message}`,
        )
        // Throw instead of exiting: the host catches it and keeps the other
        // projects up.
        throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`)
    }
    return parsed.data
}

export const env = load()

export const corsOrigins = env.FRONTEND_URL.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
