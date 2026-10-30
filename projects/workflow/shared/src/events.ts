/**
 * Demo events carried over from V1. The engine is not limited to these: any
 * event name matching EVENT_NAME_PATTERN works. They exist so the playground
 * and the builder have realistic payloads to start from.
 */

export type EventPreset = {
    name: string
    label: string
    description: string
    payload: Record<string, unknown>
}

export const EVENT_PRESETS: EventPreset[] = [
    {
        name: 'order.created',
        label: 'Order created',
        description: 'A customer placed an order.',
        payload: {
            orderId: 123,
            customer: 'João',
            email: 'joao@example.com',
            total: 149.99,
            country: 'PT',
        },
    },
    {
        name: 'user.created',
        label: 'User created',
        description: 'Someone signed up.',
        payload: { userId: 45, email: 'ana@example.com', name: 'Ana' },
    },
    {
        name: 'payment.completed',
        label: 'Payment completed',
        description: 'A payment was captured.',
        payload: { paymentId: 9, amount: 59.9, currency: 'EUR' },
    },
    {
        name: 'form.submitted',
        label: 'Form submitted',
        description: 'A contact form was sent.',
        payload: { formId: 2, email: 'visitor@example.com', message: 'Hello!' },
    },
]

export function findEventPreset(name: string): EventPreset | undefined {
    return EVENT_PRESETS.find((preset) => preset.name === name)
}
