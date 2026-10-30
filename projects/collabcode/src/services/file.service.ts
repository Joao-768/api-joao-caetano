import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { requireOwnership } from '../middleware/permission.middleware.js'

export class FileError extends Error {
    constructor(
        message: string,
        public status: number,
    ) {
        super(message)
        this.name = 'FileError'
    }
}

export const SUPPORTED_LANGUAGES = ['javascript', 'typescript', 'json', 'html', 'css'] as const

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]

async function assertMember(projectId: string, userId: string): Promise<void> {
    const membership = await prisma.projectMember.findUnique({
        where: { projectId_userId: { projectId, userId } },
    })

    if (!membership) {
        throw new FileError('Project not found', 404)
    }
}

export async function listFiles(projectId: string, userId: string) {
    await assertMember(projectId, userId)

    return prisma.file.findMany({
        where: { projectId },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, language: true, createdAt: true, updatedAt: true },
    })
}

export async function getFile(fileId: string, userId: string) {
    const file = await prisma.file.findUnique({
        where: { id: fileId },
        select: {
            id: true,
            name: true,
            language: true,
            content: true,
            projectId: true,
        },
    })

    if (!file) {
        throw new FileError('File not found', 404)
    }

    await assertMember(file.projectId, userId)

    return file
}

export async function createFile(
    projectId: string,
    userId: string,
    name: string,
    language: SupportedLanguage,
) {
    await assertMember(projectId, userId)

    try {
        return await prisma.file.create({
            data: { projectId, name, language },
            select: { id: true, name: true, language: true, createdAt: true, updatedAt: true },
        })
    } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
            throw new FileError('A file with that name already exists', 409)
        }
        throw err
    }
}

export async function renameFile(fileId: string, userId: string, name: string) {
    const file = await getFile(fileId, userId)

    try {
        return await prisma.file.update({
            where: { id: file.id },
            data: { name },
            select: { id: true, name: true, language: true, createdAt: true, updatedAt: true },
        })
    } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
            throw new FileError('A file with that name already exists', 409)
        }
        throw err
    }
}

export async function deleteFile(fileId: string, userId: string) {
    const file = await getFile(fileId, userId)

    // Per the permission model, collaborators may create and edit files but
    // only the owner may remove them.
    await requireOwnership(file.projectId, userId)

    await prisma.file.delete({ where: { id: file.id } })
    return { projectId: file.projectId }
}
