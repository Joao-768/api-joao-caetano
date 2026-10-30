import 'dotenv/config'
import { z } from 'zod'

const envSchema = z.object({
    PORT: z.coerce.number().default(4100),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    DATABASE_URL: z.string().min(1),
    JWT_SECRET: z.string().min(32),
    JWT_EXPIRES_IN: z.string().default('7d'),
    CLIENT_ORIGIN: z.url(),
})

// Render exposes the service's public URL as RENDER_EXTERNAL_URL. The client is
// served from that same origin, so it doubles as CLIENT_ORIGIN in production.
const parsed = envSchema.safeParse({
    ...process.env,
    CLIENT_ORIGIN: process.env.CLIENT_ORIGIN ?? process.env.RENDER_EXTERNAL_URL,
})

if (!parsed.success) {
    console.error('Invalid environment variables:')
    console.error(z.prettifyError(parsed.error))
    process.exit(1)
}

export const env = parsed.data
