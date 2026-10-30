import type { RequestHandler } from 'express'
import { prisma } from '../lib/prisma.js'

export class PermissionError extends Error {
    constructor(
        message: string,
        public status: number,
    ) {
        super(message)
        this.name = 'PermissionError'
    }
}

/**
 * Loads the caller's membership for a project and attaches the role.
 * Non-members get 404 rather than 403, so a project's existence is not
 * revealed to people who were never invited.
 */
export async function requireMembership(projectId: string, userId: string) {
    const membership = await prisma.projectMember.findUnique({
        where: { projectId_userId: { projectId, userId } },
        select: { role: true },
    })

    if (!membership) {
        throw new PermissionError('Project not found', 404)
    }

    return membership
}

export async function requireOwnership(projectId: string, userId: string) {
    const membership = await requireMembership(projectId, userId)

    if (membership.role !== 'OWNER') {
        throw new PermissionError('Only the project owner can do that', 403)
    }

    return membership
}

/** Route guard for endpoints keyed by a project id in the path. */
export const requireProjectOwner: RequestHandler = async (req, _res, next) => {
    try {
        await requireOwnership(req.params.id as string, req.user!.id)
        next()
    } catch (error) {
        next(error)
    }
}
