import { DELAY_UNIT_MS, type DelayUnit } from '@wae/shared'
import { defineNode } from './types'

/**
 * A delay does not sleep. It returns `waitMs`, and the executor enqueues the
 * next node as a *delayed* BullMQ job. The worker is free to run other work
 * meanwhile, and the wait survives a worker restart because it lives in Redis.
 */
export const delayNode = defineNode<'delay', { amount: number; unit: DelayUnit; ms: number }>({
    prepare(node) {
        const { amount, unit } = node.config
        return { amount, unit, ms: amount * DELAY_UNIT_MS[unit] }
    },

    async run(input) {
        return {
            output: { waitedMs: input.ms, resumeAt: new Date(Date.now() + input.ms).toISOString() },
            waitMs: input.ms,
        }
    },
})
