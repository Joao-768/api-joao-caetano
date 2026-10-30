import type { PublicUser } from '../services/auth.service.js'

declare global {
    namespace Express {
        interface Request {
            user?: PublicUser
        }
    }
}

export {}
