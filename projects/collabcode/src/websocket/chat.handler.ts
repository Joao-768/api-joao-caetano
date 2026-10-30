import type { Server, Socket } from 'socket.io'
import { SOCKET_EVENTS } from './events.js'
import * as messageService from '../services/message.service.js'

const MAX_MESSAGE_LENGTH = 2000

export function registerChat(io: Server, socket: Socket): void {
    socket.on(SOCKET_EVENTS.CHAT_MESSAGE, async ({ content }: { content: string }) => {
        if (!socket.projectId) return

        const trimmed = typeof content === 'string' ? content.trim() : ''

        if (!trimmed || trimmed.length > MAX_MESSAGE_LENGTH) return

        try {
            const message = await messageService.createMessage(
                socket.projectId,
                socket.user!.id,
                trimmed,
            )

            io.to(socket.projectId).emit(SOCKET_EVENTS.CHAT_MESSAGE, { message })
        } catch {
            socket.emit(SOCKET_EVENTS.ROOM_ERROR, { error: 'Could not send that message' })
        }
    })
}
