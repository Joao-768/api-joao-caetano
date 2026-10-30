import { Server } from 'socket.io'
import type { Server as HttpServer } from 'node:http'
import cookie from 'cookie'
import { env } from '../lib/env.js'
import { verifyToken } from '../lib/jwt.js'
import { getUserById } from '../services/auth.service.js'
import { prisma } from '../lib/prisma.js'
import { AUTH_COOKIE } from '../middleware/auth.middleware.js'
import { SOCKET_EVENTS } from './events.js'
import type { RoomJoinPayload, DocumentUpdatePayload } from './events.js'
import * as roomManager from './room.manager.js'
import { registerPresence, broadcastPresence, colorForUser } from './presence.handler.js'
import { registerChat } from './chat.handler.js'

export type SocketUser = {
    id: string
    name: string
    email: string
}

declare module 'socket.io' {
    interface Socket {
        user?: SocketUser
        projectId?: string
        openFileId?: string
    }
}

// Set once the socket server exists, so HTTP handlers can announce file
// changes to the room without importing the server itself.
let ioRef: Server | null = null

export function emitToProject(projectId: string, event: string, payload: unknown): void {
    ioRef?.to(projectId).emit(event, payload)
}

export function createSocketServer(httpServer: HttpServer): Server {
    const io = new Server(httpServer, {
        cors: { origin: env.CLIENT_ORIGIN, credentials: true },
    })

    ioRef = io

    io.use(async (socket, next) => {
        try {
            const header = socket.handshake.headers.cookie
            if (!header) return next(new Error('Not authenticated'))

            const token = cookie.parse(header)[AUTH_COOKIE]
            if (!token) return next(new Error('Not authenticated'))

            const { userId } = verifyToken(token)
            const user = await getUserById(userId)
            if (!user) return next(new Error('Not authenticated'))

            socket.user = user
            next()
        } catch {
            next(new Error('Not authenticated'))
        }
    })

    io.on('connection', (socket) => {
        socket.data.user = {
            userId: socket.user!.id,
            name: socket.user!.name,
            color: colorForUser(socket.user!.id),
        }

        registerPresence(socket)
        registerChat(io, socket)

        socket.on(SOCKET_EVENTS.ROOM_JOIN, async ({ projectId }: RoomJoinPayload) => {
            const membership = await prisma.projectMember.findUnique({
                where: { projectId_userId: { projectId, userId: socket.user!.id } },
            })

            if (!membership) {
                socket.emit(SOCKET_EVENTS.ROOM_ERROR, { error: 'Not a member of this project' })
                return
            }

            socket.projectId = projectId
            await socket.join(projectId)
            await broadcastPresence(io, projectId)
        })

        socket.on(SOCKET_EVENTS.DOCUMENT_SYNC, async ({ fileId }: { fileId: string }) => {
            if (!socket.projectId) return

            const file = await prisma.file.findUnique({
                where: { id: fileId },
                select: { projectId: true },
            })

            if (!file || file.projectId !== socket.projectId) return

            if (socket.openFileId && socket.openFileId !== fileId) {
                await roomManager.releaseDoc(socket.openFileId)
            }

            const doc = await roomManager.loadDoc(fileId)
            socket.openFileId = fileId
            await socket.join(`file:${fileId}`)

            socket.emit(SOCKET_EVENTS.DOCUMENT_SYNC, {
                fileId,
                update: roomManager.encodeState(doc),
            })
        })

        socket.on(SOCKET_EVENTS.DOCUMENT_UPDATE, ({ fileId, update }: DocumentUpdatePayload) => {
            if (socket.openFileId !== fileId) return

            roomManager.applyUpdate(fileId, new Uint8Array(update))
            socket.to(`file:${fileId}`).emit(SOCKET_EVENTS.DOCUMENT_UPDATE, { fileId, update })
        })

        socket.on('disconnect', () => {
            if (socket.openFileId) {
                void roomManager.releaseDoc(socket.openFileId)
            }
            if (socket.projectId) {
                void broadcastPresence(io, socket.projectId)
            }
        })
    })

    return io
}
