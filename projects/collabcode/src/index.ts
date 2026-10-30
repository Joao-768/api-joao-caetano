import { createServer } from 'node:http'
import { app } from './app.js'
import { env } from './lib/env.js'
import { createSocketServer } from './websocket/index.js'
import { persistAll } from './websocket/room.manager.js'

const httpServer = createServer(app)

createSocketServer(httpServer)

// Bind on 0.0.0.0, not the default. A host platform reaches the container over
// IPv4, and the default binding leaves it unreachable from outside.
httpServer.listen(env.PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${env.PORT}`)
})

async function shutdown(): Promise<void> {
    await persistAll()
    httpServer.close(() => process.exit(0))
}

process.on('SIGINT', () => void shutdown())
process.on('SIGTERM', () => void shutdown())
