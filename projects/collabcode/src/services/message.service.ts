import { prisma } from '../lib/prisma.js'

export class MessageError extends Error {
    constructor(
        message: string,
        public status: number,
    ) {
        super(message)
        this.name = 'MessageError'
    }
}

const MESSAGE_PAGE_SIZE = 50

async function assertMember(projectId: string, userId: string): Promise<void> {
    const membership = await prisma.projectMember.findUnique({
        where: { projectId_userId: { projectId, userId } },
    })

    if (!membership) {
        throw new MessageError('Project not found', 404)
    }
}

export async function listMessages(projectId: string, userId: string) {
    await assertMember(projectId, userId)

    const messages = await prisma.message.findMany({
        where: { projectId },
        orderBy: { createdAt: 'desc' },
        take: MESSAGE_PAGE_SIZE,
        select: {
            id: true,
            content: true,
            createdAt: true,
            user: { select: { id: true, name: true } },
        },
    })

    // Queried newest-first to get the latest page, returned oldest-first so the
    // client can append without reordering.
    return messages.reverse()
}

export async function createMessage(projectId: string, userId: string, content: string) {
    await assertMember(projectId, userId)

    return prisma.message.create({
        data: { projectId, userId, content },
        select: {
            id: true,
            content: true,
            createdAt: true,
            user: { select: { id: true, name: true } },
        },
    })
}
