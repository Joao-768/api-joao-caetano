import { Router } from 'express'
import * as projectController from '../controllers/project.controller.js'
import { validateBody } from '../middleware/validate.middleware.js'
import { requireAuth } from '../middleware/auth.middleware.js'
import * as fileController from '../controllers/file.controller.js'
import * as messageController from '../controllers/message.controller.js'

export const projectRoutes = Router()

projectRoutes.use(requireAuth)

projectRoutes.get('/', projectController.list)
projectRoutes.post(
    '/',
    validateBody(projectController.createProjectSchema),
    projectController.create,
)
projectRoutes.get('/:id', projectController.get)
projectRoutes.post('/:id/join', projectController.join)
projectRoutes.delete('/:id', projectController.remove)
projectRoutes.get('/:id/files', fileController.list)
projectRoutes.post(
    '/:id/files',
    validateBody(fileController.createFileSchema),
    fileController.create,
)
projectRoutes.get('/:id/messages', messageController.list)
