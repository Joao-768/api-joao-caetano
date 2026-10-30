import { execFile } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { app } from './app.js'
import { prisma } from './lib/prisma.js'
import { registerSocketHandlers } from './websocket/index.js'
import { persistAll } from './websocket/room.manager.js'

// Entry point for api-joao-caetano, which replaces the standalone index.ts:
// the host owns the HTTP server and the Socket.io server, and mounts this
// project at /collabcode.

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const run = promisify(execFile)

// Same step the standalone start script ran before the server came up.
async function migrate(): Promise<void> {
    await run(resolve(projectRoot, 'node_modules/.bin/prisma'), ['migrate', 'deploy'], {
        cwd: projectRoot,
        timeout: 120_000,
    })
}

export async function start() {
    await migrate()

    return {
        app,
        sockets: registerSocketHandlers,
        async ping(): Promise<void> {
            await prisma.$queryRaw`SELECT 1`
        },
        async stop(): Promise<void> {
            await persistAll()
            await prisma.$disconnect()
        },
    }
}
