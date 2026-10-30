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
        PORT: z.coerce.number().int().positive().default(3000),

        DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
        DATABASE_SSL: bool.default(false),
        REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
        QUEUE_PREFIX: z.string().min(1).default('wae'),

        JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
        JWT_EXPIRES_IN: z.string().default('7d'),

        /** Comma-separated list of origins allowed by CORS. */
        FRONTEND_URL: z.string().default('http://localhost:5176'),

        /** Run the worker inside the API process (single-process hosting). */
        RUN_WORKER_IN_API: bool.default(false),
        WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(5),
        /** First retry waits this long, then doubles on every attempt. */
        RETRY_BACKOFF_MS: z.coerce.number().int().min(10).default(2000),
        /** Upper bound for any single node, whatever its own config says. */
        NODE_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30_000),

        HTTP_ALLOW_PRIVATE_NETWORKS: bool.default(false),
        HTTP_MAX_RESPONSE_BYTES: z.coerce.number().int().min(1024).default(1_000_000),

        SMTP_HOST: z.string().optional(),
        SMTP_PORT: z.coerce.number().int().positive().default(587),
        SMTP_SECURE: bool.default(false),
        SMTP_USER: z.string().optional(),
        SMTP_PASS: z.string().optional(),
        SMTP_FROM: z.string().default('Workflow Engine <no-reply@example.com>'),
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

function load() {
    const parsed = schema.safeParse(process.env)
    if (!parsed.success) {
        const lines = parsed.error.issues.map(
            (issue) => `  ${issue.path.join('.')}: ${issue.message}`,
        )
        // The logger depends on this config, so this is the one place that
        // writes to stderr directly.
        process.stderr.write(`Invalid environment configuration:\n${lines.join('\n')}\n`)
        process.exit(1)
    }
    return parsed.data
}

export const env = load()

export const corsOrigins = env.FRONTEND_URL.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
