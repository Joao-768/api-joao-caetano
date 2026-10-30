import { Router } from 'express'
import { authed, requireAuth } from '../../auth/auth'
import { listWorkflows } from '../../repositories/workflows'
import * as workflows from '../../services/workflows'
import { triggerLimiter } from '../rateLimits'
import { idParam, runBody, workflowBody } from '../schemas'

export const workflowsRouter = Router()
workflowsRouter.use(requireAuth)

workflowsRouter.get(
    '/',
    authed(async (req, res) => {
        res.json(await listWorkflows(req.auth.userId))
    }),
)

workflowsRouter.post(
    '/',
    authed(async (req, res) => {
        const input = workflowBody.parse(req.body)
        res.status(201).json(await workflows.createWorkflow(req.auth.userId, input))
    }),
)

workflowsRouter.get(
    '/:id',
    authed(async (req, res) => {
        const { id } = idParam.parse(req.params)
        res.json(workflows.toDetail(await workflows.getWorkflow(req.auth.userId, id)))
    }),
)

workflowsRouter.put(
    '/:id',
    authed(async (req, res) => {
        const { id } = idParam.parse(req.params)
        const input = workflowBody.parse(req.body)
        res.json(await workflows.updateWorkflow(req.auth.userId, id, input))
    }),
)

/** Soft delete: the workflow disappears, its execution history stays. */
workflowsRouter.delete(
    '/:id',
    authed(async (req, res) => {
        const { id } = idParam.parse(req.params)
        await workflows.deleteWorkflow(req.auth.userId, id)
        res.status(204).end()
    }),
)

workflowsRouter.post(
    '/:id/activate',
    authed(async (req, res) => {
        const { id } = idParam.parse(req.params)
        res.json(await workflows.setActive(req.auth.userId, id, true))
    }),
)

workflowsRouter.post(
    '/:id/deactivate',
    authed(async (req, res) => {
        const { id } = idParam.parse(req.params)
        res.json(await workflows.setActive(req.auth.userId, id, false))
    }),
)

workflowsRouter.post(
    '/:id/duplicate',
    authed(async (req, res) => {
        const { id } = idParam.parse(req.params)
        res.status(201).json(await workflows.duplicateWorkflow(req.auth.userId, id))
    }),
)

/** Manual run with a JSON payload. Answers 202: the worker does the work. */
workflowsRouter.post(
    '/:id/run',
    triggerLimiter,
    authed(async (req, res) => {
        const { id } = idParam.parse(req.params)
        const { payload } = runBody.parse(req.body ?? {})
        const execution = await workflows.runManually(req.auth.userId, id, payload)
        res.status(202).json({ executionId: execution.id, status: execution.status })
    }),
)

/** Returns the new secret once. Only its hash is stored. */
workflowsRouter.post(
    '/:id/webhook-secret',
    authed(async (req, res) => {
        const { id } = idParam.parse(req.params)
        res.status(201).json({ secret: await workflows.rotateWebhookSecret(req.auth.userId, id) })
    }),
)

workflowsRouter.delete(
    '/:id/webhook-secret',
    authed(async (req, res) => {
        const { id } = idParam.parse(req.params)
        await workflows.removeWebhookSecret(req.auth.userId, id)
        res.status(204).end()
    }),
)
