import 'dotenv/config'
import { z } from 'zod'

const envSchema = z.object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    DATABASE_URL: z.string().min(1),
    JWT_SECRET: z.string().min(32),
    JWT_EXPIRES_IN: z.string().default('7d'),
    CLIENT_ORIGIN: z.url(),
})

// Hosted by api-joao-caetano next to other projects, so every variable of this
// one carries the COLLAB_ prefix (COLLAB_DATABASE_URL, COLLAB_JWT_SECRET...)
// and cannot collide with another project's. NODE_ENV is shared.
const PREFIX = 'COLLAB_'

const scoped = Object.fromEntries(
    Object.entries(process.env)
        .filter(([key]) => key.startsWith(PREFIX))
        .map(([key, value]) => [key.slice(PREFIX.length), value]),
)

const parsed = envSchema.safeParse({ NODE_ENV: process.env.NODE_ENV, ...scoped })

// Throw instead of exiting: the host catches it and keeps the other projects up.
if (!parsed.success) {
    throw new Error(`Invalid ${PREFIX} environment variables:\n${z.prettifyError(parsed.error)}`)
}

export const env = parsed.data
