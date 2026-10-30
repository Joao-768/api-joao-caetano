import { Router } from 'express'
import type { WebhookResponse } from '@wae/shared'
import { authed, requireAuth } from '../../auth/auth'
import { dispatchEvent, receiveWebhook } from '../../services/triggers'
import { triggerLimiter, webhookLimiter } from '../rateLimits'
import { eventBody, payloadObject, webhookParams } from '../schemas'

/** POST /events: fire a named event for the logged-in user (the playground uses this). */
export const eventsRouter = Router()

eventsRouter.post(
    '/',
    requireAuth,
    triggerLimiter,
    authed(async (req, res) => {
        const input = eventBody.parse(req.body)
        res.status(202).json(await dispatchEvent(req.auth.userId, input.type, input.data))
    }),
)

/**
 * POST /webhooks/:webhookId: public. The JSON body becomes the event
 * payload. If the workflow has a secret, the caller must send it in the
 * X-Webhook-Secret header.
 */
export const webhooksRouter = Router()

webhooksRouter.post('/:webhookId', webhookLimiter, async (req, res) => {
    const { webhookId } = webhookParams.parse(req.params)
    const payload = payloadObject.parse(req.body ?? {})
    const secret = req.header('x-webhook-secret') ?? undefined
    const execution = await receiveWebhook(webhookId, secret, payload)
    res.status(202).json({ status: 'queued', executionId: execution.id } satisfies WebhookResponse)
})
