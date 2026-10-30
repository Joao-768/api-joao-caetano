import { defineNode } from './types'

/**
 * The trigger is the first step of every execution. Its work already
 * happened (an event arrived, a webhook was called, a cron fired), so it
 * simply records the payload that started the run.
 */
export const triggerNode = defineNode<'trigger', { type: string; payload: unknown }>({
    prepare(node, context) {
        return { type: node.config.type, payload: context.event }
    },

    async run(input) {
        return { output: input.payload }
    },
})
