import crypto from 'node:crypto'
import type { EventResponse, QueuedExecution } from '@wae/shared'
import { AppError, notFound } from '../lib/errors'
import { logger } from '../lib/logger'
import { findActiveEventWorkflows, findWorkflowByWebhookId } from '../repositories/workflows'
import { startExecution } from './executions'
import { hashSecret } from './workflows'

/**
 * Event trigger: every active workflow of this user listening for
 * `eventName` gets its own execution. Each workflow is started
 * independently, so a problem with one does not stop the others.
 */
export async function dispatchEvent(
    userId: number,
    eventName: string,
    data: unknown,
): Promise<EventResponse> {
    const workflows = await findActiveEventWorkflows(userId, eventName)
    const matched: QueuedExecution[] = []
    let queueDown: unknown = null

    for (const workflow of workflows) {
        try {
            const execution = await startExecution({
                workflow,
                triggerType: 'event',
                payload: data,
            })
            matched.push({
                workflowId: workflow.id,
                workflowName: workflow.name,
                executionId: execution.id,
            })
        } catch (err) {
            logger.error({ err, workflowId: workflow.id }, 'Could not start workflow for event')
            queueDown = err
        }
    }

    if (queueDown && matched.length === 0) throw queueDown
    return { event: eventName, matched }
}

/**
 * Webhook trigger. The endpoint is public, so it gives nothing away: an
 * unknown id, a deleted workflow, an inactive one and one whose trigger is
 * not a webhook all answer the same 404.
 */
export async function receiveWebhook(
    webhookId: string,
    providedSecret: string | undefined,
    payload: unknown,
) {
    const workflow = await findWorkflowByWebhookId(webhookId)
    if (!workflow || !workflow.is_active || workflow.trigger_type !== 'webhook') {
        throw notFound('Webhook')
    }

    if (workflow.webhook_secret_hash) {
        const valid =
            providedSecret !== undefined &&
            crypto.timingSafeEqual(
                Buffer.from(hashSecret(providedSecret)),
                Buffer.from(workflow.webhook_secret_hash),
            )
        if (!valid)
            throw new AppError(401, 'invalid_webhook_secret', 'Missing or invalid webhook secret')
    }

    return startExecution({ workflow, triggerType: 'webhook', payload })
}
