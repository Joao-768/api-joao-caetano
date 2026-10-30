import { Router } from 'express'
import { PLANS } from '../config/plans.js'
import { pool } from '../db/pool.js'
import * as authController from '../controllers/auth.controller.js'
import * as incidentController from '../controllers/incident.controller.js'
import * as monitorController from '../controllers/monitor.controller.js'
import * as notificationController from '../controllers/notification.controller.js'
import { optionalAuth, requireAuth } from '../middleware/auth.js'
import {
    forgotLimiter,
    loginLimiter,
    registerLimiter,
    resetLimiter,
} from '../middleware/security.js'

// Public ------------------------------------------------------------------

const publicRoutes = Router()

publicRoutes.get('/health', async (_req, res) => {
    await pool.query('SELECT 1')
    res.json({ status: 'ok' })
})

publicRoutes.get('/plans', (_req, res) => {
    res.json({ plans: Object.values(PLANS) })
})

// Auth --------------------------------------------------------------------

const auth = Router()
auth.post('/register', registerLimiter, authController.register)
auth.post('/login', loginLimiter, authController.login)
auth.post('/logout', authController.logout)
// Answers { user: null } for visitors instead of 401, so public pages can ask.
auth.get('/me', optionalAuth, authController.me)
auth.post('/forgot-password', forgotLimiter, authController.forgotPassword)
auth.get('/reset-password/validate', resetLimiter, authController.checkResetToken)
auth.post('/reset-password', resetLimiter, authController.resetPassword)

// Monitors, checks, metrics and export ------------------------------------

const monitors = Router()
monitors.use(requireAuth)
monitors.get('/', monitorController.list)
monitors.post('/', monitorController.create)
monitors.get('/:id', monitorController.get)
monitors.patch('/:id', monitorController.rename)
monitors.delete('/:id', monitorController.remove)
monitors.post('/:id/pause', monitorController.pause)
monitors.post('/:id/resume', monitorController.resume)
monitors.get('/:id/metrics', monitorController.metrics)
monitors.get('/:id/checks', monitorController.checks)
monitors.get('/:id/incidents', monitorController.incidents)
monitors.get('/:id/export/checks.csv', monitorController.exportChecks)
monitors.get('/:id/export/incidents.csv', monitorController.exportIncidents)

// Dashboard ---------------------------------------------------------------

const dashboard = Router()
dashboard.use(requireAuth)
dashboard.get('/', monitorController.dashboard)

// Incidents across all monitors -------------------------------------------

const incidents = Router()
incidents.use(requireAuth)
incidents.get('/', incidentController.list)

// Notifications -----------------------------------------------------------

const notifications = Router()
notifications.use(requireAuth)
notifications.get('/', notificationController.list)
notifications.get('/unread-count', notificationController.unreadCount)
notifications.post('/read-all', notificationController.markAllRead)
notifications.patch('/:id', notificationController.update)

export const apiRouter = Router()
apiRouter.use('/', publicRoutes)
apiRouter.use('/auth', auth)
apiRouter.use('/monitors', monitors)
apiRouter.use('/dashboard', dashboard)
apiRouter.use('/incidents', incidents)
apiRouter.use('/notifications', notifications)
