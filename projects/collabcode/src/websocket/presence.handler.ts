import type { Server, Socket } from 'socket.io'
import { SOCKET_EVENTS } from './events.js'
import type { PresenceUser } from './events.js'

// Distinct hues that stay readable on the dark editor background.
const COLORS = [
    '#2563eb',
    '#10b981',
    '#f59e0b',
    '#ec4899',
    '#8b5cf6',
    '#06b6d4',
    '#ef4444',
    '#84cc16',
]

export function colorForUser(userId: string): string {
    let hash = 0

    for (let i = 0; i < userId.length; i += 1) {
        hash = (hash * 31 + userId.charCodeAt(i)) | 0
    }

    return COLORS[Math.abs(hash) % COLORS.length]!
}

export async function broadcastPresence(io: Server, projectId: string): Promise<void> {
    const sockets = await io.in(projectId).fetchSockets()
    const seen = new Map<string, PresenceUser>()

    for (const socket of sockets) {
        const user = socket.data.user as PresenceUser | undefined
        if (user) {
            seen.set(user.userId, user)
        }
    }

    io.to(projectId).emit(SOCKET_EVENTS.PRESENCE_UPDATE, { users: [...seen.values()] })
}

export function registerPresence(socket: Socket): void {
    socket.on(SOCKET_EVENTS.CURSOR_UPDATE, (payload: { fileId: string; cursor: unknown }) => {
        if (!socket.projectId || socket.openFileId !== payload.fileId) return

        socket.to(`file:${payload.fileId}`).emit(SOCKET_EVENTS.CURSOR_UPDATE, {
            fileId: payload.fileId,
            userId: socket.user!.id,
            name: socket.user!.name,
            color: colorForUser(socket.user!.id),
            cursor: payload.cursor,
        })
    })
}
