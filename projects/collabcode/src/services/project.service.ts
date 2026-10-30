import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'

export class ProjectError extends Error {
    constructor(
        message: string,
        public status: number,
    ) {
        super(message)
        this.name = 'ProjectError'
    }
}

export async function listProjects(userId: string) {
    return prisma.project.findMany({
        where: { members: { some: { userId } } },
        orderBy: { updatedAt: 'desc' },
        select: {
            id: true,
            name: true,
            createdAt: true,
            updatedAt: true,
            ownerId: true,
            _count: { select: { files: true, members: true } },
        },
    })
}

export async function createProject(userId: string, name: string) {
    return prisma.project.create({
        data: {
            name,
            ownerId: userId,
            members: { create: { userId, role: 'OWNER' } },
        },
        select: { id: true, name: true, createdAt: true, updatedAt: true, ownerId: true },
    })
}

export async function getProject(projectId: string, userId: string) {
    const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: {
            id: true,
            name: true,
            createdAt: true,
            updatedAt: true,
            ownerId: true,
            members: {
                select: {
                    role: true,
                    user: { select: { id: true, name: true, email: true } },
                },
            },
        },
    })

    if (!project) {
        throw new ProjectError('Project not found', 404)
    }

    if (!project.members.some((m) => m.user.id === userId)) {
        throw new ProjectError('Project not found', 404)
    }

    return project
}

export async function joinProject(projectId: string, userId: string) {
    const project = await prisma.project.findUnique({ where: { id: projectId } })

    if (!project) {
        throw new ProjectError('Project not found', 404)
    }

    try {
        await prisma.projectMember.create({
            data: { projectId, userId, role: 'COLLABORATOR' },
        })
    } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
            return project
        }
        throw err
    }

    return project
}

export async function deleteProject(projectId: string, userId: string) {
    const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { ownerId: true },
    })

    if (!project) {
        throw new ProjectError('Project not found', 404)
    }

    if (project.ownerId !== userId) {
        throw new ProjectError('Only the owner can delete this project', 403)
    }

    await prisma.project.delete({ where: { id: projectId } })
}
