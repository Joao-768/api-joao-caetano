import { Router } from 'express'
import * as fileController from '../controllers/file.controller.js'
import { validateBody } from '../middleware/validate.middleware.js'
import { requireAuth } from '../middleware/auth.middleware.js'

export const fileRoutes = Router()

fileRoutes.use(requireAuth)

fileRoutes.get('/:fileId', fileController.get)
fileRoutes.patch('/:fileId', validateBody(fileController.renameFileSchema), fileController.rename)
fileRoutes.delete('/:fileId', fileController.remove)
