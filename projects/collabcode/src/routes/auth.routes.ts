import { Router } from 'express'
import * as authController from '../controllers/auth.controller.js'
import { validateBody } from '../middleware/validate.middleware.js'
import { requireAuth } from '../middleware/auth.middleware.js'

export const authRoutes = Router()

authRoutes.post('/register', validateBody(authController.registerSchema), authController.register)
authRoutes.post('/login', validateBody(authController.loginSchema), authController.login)
authRoutes.post('/logout', authController.logout)
authRoutes.get('/me', requireAuth, authController.me)
