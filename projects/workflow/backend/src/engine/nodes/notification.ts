import { resolveTemplate, type NotificationLevel } from '@wae/shared'
import { defineNode } from './types'

/**
 * An internal, simulated notification: there is no push provider behind it.
 * The resolved message is the output, so the execution trace shows exactly
 * what would have been delivered.
 */
export const notificationNode = defineNode<
    'notification',
    { message: string; level: NotificationLevel }
>({
    prepare(node, context) {
        return {
            message: String(resolveTemplate(node.config.message, context)),
            level: node.config.level,
        }
    },

    async run(input) {
        return {
            output: {
                channel: 'in-app (simulated)',
                level: input.level,
                message: input.message,
                deliveredAt: new Date().toISOString(),
            },
        }
    },
})
