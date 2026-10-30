import { prisma } from '../lib/prisma.js'
import { hashPassword, verifyPassword } from '../lib/password.js'

export type PublicUser = {
    id: string
    email: string
    name: string
}

export class AuthError extends Error {
    constructor(
        message: string,
        public status: number,
    ) {
        super(message)
        this.name = 'AuthError'
    }
}

export async function register(email: string, name: string, password: string): Promise<PublicUser> {
    const existing = await prisma.user.findUnique({ where: { email } })

    if (existing) {
        throw new AuthError('Email already registered', 409)
    }

    const user = await prisma.user.create({
        data: { email, name, passwordHash: await hashPassword(password) },
        select: { id: true, email: true, name: true },
    })

    return user
}

export async function login(email: string, password: string): Promise<PublicUser> {
    const user = await prisma.user.findUnique({ where: { email } })

    if (!user || !(await verifyPassword(password, user.passwordHash))) {
        throw new AuthError('Invalid email or password', 401)
    }

    return { id: user.id, email: user.email, name: user.name }
}

export async function getUserById(id: string): Promise<PublicUser | null> {
    return prisma.user.findUnique({
        where: { id },
        select: { id: true, email: true, name: true },
    })
}
