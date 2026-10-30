import { Router } from 'express'
import { authRoutes } from './auth.routes.js'
import { projectRoutes } from './project.routes.js'
import { fileRoutes } from './file.routes.js'

export const apiRoutes = Router()

apiRoutes.use('/auth', authRoutes)

apiRoutes.use('/files', fileRoutes)

apiRoutes.use('/projects', projectRoutes)
