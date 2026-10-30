import 'dotenv/config'
import { defineConfig } from 'prisma/config'

// In Prisma 7 the connection URL lives here instead of in schema.prisma.
// The CLI reads this file for migrate/generate; the runtime client gets its
// connection separately through the PrismaPg driver adapter (src/lib/prisma.ts).
export default defineConfig({
    schema: 'prisma/schema.prisma',
    migrations: {
        path: 'prisma/migrations',
    },
    datasource: {
        // `generate` only reads the schema, so it must not fail when the URL is
        // absent (it is set at build time on the host, not on a fresh checkout).
        // `migrate` does connect, and errors on the placeholder if it is unset.
        url: process.env.DATABASE_URL ?? 'postgresql://unset',
    },
})
