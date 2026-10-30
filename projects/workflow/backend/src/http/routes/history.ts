import { Router } from 'express'
import { authed, requireAuth } from '../../auth/auth'
import { notFound } from '../../lib/errors'
import { dashboardStats } from '../../repositories/dashboard'
import { findExecutionDetail, listExecutions } from '../../repositories/executions'
import { listCollections, listRecords } from '../../repositories/records'
import { executionsQuery, idParam, recordsQuery } from '../schemas'

/** Read-only views over what the engine persisted. */
export const executionsRouter = Router()
executionsRouter.use(requireAuth)

executionsRouter.get(
    '/',
    authed(async (req, res) => {
        res.json(await listExecutions(req.auth.userId, executionsQuery.parse(req.query)))
    }),
)

executionsRouter.get(
    '/:id',
    authed(async (req, res) => {
        const { id } = idParam.parse(req.params)
        const execution = await findExecutionDetail(req.auth.userId, id)
        if (!execution) throw notFound('Execution')
        res.json(execution)
    }),
)

export const recordsRouter = Router()
recordsRouter.use(requireAuth)

recordsRouter.get(
    '/',
    authed(async (req, res) => {
        res.json(await listRecords(req.auth.userId, recordsQuery.parse(req.query)))
    }),
)

recordsRouter.get(
    '/collections',
    authed(async (req, res) => {
        res.json(await listCollections(req.auth.userId))
    }),
)

export const dashboardRouter = Router()
dashboardRouter.use(requireAuth)

dashboardRouter.get(
    '/',
    authed(async (req, res) => {
        res.json(await dashboardStats(req.auth.userId))
    }),
)
