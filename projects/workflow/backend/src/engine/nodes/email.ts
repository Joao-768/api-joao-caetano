import { resolveTemplate } from '@wae/shared'
import { NodeError } from '../errors'
import { defineNode } from './types'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Sends through the configured EmailSender (SMTP, or simulated in dev). */
export const emailNode = defineNode<'email', { to: string; subject: string; body: string }>({
    prepare(node, context) {
        return {
            to: String(resolveTemplate(node.config.to, context)).trim(),
            subject: String(resolveTemplate(node.config.subject, context)),
            body: String(resolveTemplate(node.config.body, context)),
        }
    },

    async run(input, _node, runtime) {
        if (!EMAIL.test(input.to)) {
            throw new NodeError(
                'invalid_recipient',
                `"${input.to}" is not a valid email address`,
                false,
            )
        }
        const receipt = await runtime.services.email.send({
            to: input.to,
            subject: input.subject,
            text: input.body,
        })
        return {
            output: {
                delivery: receipt.mode,
                simulated: receipt.mode === 'simulated',
                messageId: receipt.messageId,
                to: input.to,
                subject: input.subject,
                acceptedAt: receipt.acceptedAt,
            },
        }
    },
})
