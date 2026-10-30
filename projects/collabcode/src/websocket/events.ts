export const SOCKET_EVENTS = {
    ROOM_JOIN: 'room:join',
    ROOM_LEAVE: 'room:leave',
    ROOM_ERROR: 'room:error',

    DOCUMENT_SYNC: 'document:sync',
    DOCUMENT_UPDATE: 'document:update',

    CURSOR_UPDATE: 'cursor:update',
    PRESENCE_UPDATE: 'presence:update',

    CHAT_MESSAGE: 'chat:message',

    FILE_CREATED: 'file:created',
    FILE_RENAMED: 'file:renamed',
    FILE_DELETED: 'file:deleted',
} as const

export type RoomJoinPayload = {
    projectId: string
}

export type DocumentSyncPayload = {
    fileId: string
    update: ArrayBuffer
}

export type DocumentUpdatePayload = {
    fileId: string
    update: ArrayBuffer
}

export type PresenceUser = {
    userId: string
    name: string
    color: string
}
