import type { WorkflowDefinition } from '@wae/shared'
import { hashPassword } from '../auth/auth'
import { logger } from '../lib/logger'
import { closeQueue } from '../queue/queue'
import { createWorkflow, setActive } from '../services/workflows'
import { pool } from './pool'

/**
 * Creates a demo account with working example workflows:
 *
 *   npm run seed   ->   demo@example.com / demo12345
 *
 * Running it again resets that account's workflows to the originals; other
 * accounts are never touched.
 */

export const DEMO_EMAIL = 'demo@example.com'
export const DEMO_PASSWORD = 'demo12345'

const at = (x: number, y: number) => ({ x, y })

type Demo = { name: string; description: string; active: boolean; definition: WorkflowDefinition }

export const DEMO_WORKFLOWS: Demo[] = [
    {
        name: 'Large order alert',
        description: 'Notify the team about orders over 100 and keep a record of them.',
        active: true,
        definition: {
            nodes: [
                {
                    id: 'trigger',
                    type: 'trigger',
                    label: 'Order created',
                    position: at(0, 0),
                    config: { type: 'event', eventName: 'order.created' },
                },
                {
                    id: 'is_large',
                    type: 'condition',
                    label: 'Total over 100?',
                    position: at(0, 140),
                    config: { path: 'event.total', operator: 'gt', value: '100' },
                },
                {
                    id: 'notify_team',
                    type: 'notification',
                    label: 'Notify team',
                    position: at(-160, 300),
                    config: {
                        level: 'warning',
                        message:
                            'Large order #{{event.orderId}} from {{event.customer}}: {{event.total}} EUR',
                    },
                },
                {
                    id: 'save_order',
                    type: 'create_record',
                    label: 'Save large order',
                    position: at(-160, 450),
                    config: {
                        collection: 'large_orders',
                        data: {
                            orderId: '{{event.orderId}}',
                            customer: '{{event.customer}}',
                            total: '{{event.total}}',
                        },
                    },
                },
            ],
            edges: [
                { id: 'e1', source: 'trigger', target: 'is_large' },
                { id: 'e2', source: 'is_large', target: 'notify_team', sourceHandle: 'true' },
                { id: 'e3', source: 'notify_team', target: 'save_order' },
            ],
        },
    },
    {
        name: 'Portuguese customer webhook',
        description:
            'Webhook: customers from PT are forwarded to an HTTP endpoint and stored; others raise a notification.',
        active: true,
        definition: {
            nodes: [
                {
                    id: 'trigger',
                    type: 'trigger',
                    label: 'Webhook',
                    position: at(0, 0),
                    config: { type: 'webhook' },
                },
                {
                    id: 'is_pt',
                    type: 'condition',
                    label: 'Country is PT?',
                    position: at(0, 140),
                    config: { path: 'event.country', operator: 'equals', value: 'PT' },
                },
                {
                    id: 'forward',
                    type: 'http_request',
                    label: 'Forward to CRM',
                    position: at(-180, 300),
                    config: {
                        method: 'POST',
                        url: 'https://httpbin.org/anything/crm',
                        headers: [],
                        query: [],
                        bodyType: 'json',
                        body: {
                            name: '{{event.name}}',
                            email: '{{event.email}}',
                            source: 'workflow-engine',
                        },
                        timeoutMs: 10000,
                    },
                },
                {
                    id: 'store_customer',
                    type: 'create_record',
                    label: 'Store customer',
                    position: at(-180, 450),
                    config: {
                        collection: 'pt_customers',
                        data: {
                            name: '{{event.name}}',
                            email: '{{event.email}}',
                            crmStatus: '{{steps.forward.status}}',
                        },
                    },
                },
                {
                    id: 'notify_other',
                    type: 'notification',
                    label: 'Other country',
                    position: at(180, 300),
                    config: {
                        level: 'info',
                        message: 'New customer {{event.name}} from {{event.country}}',
                    },
                },
            ],
            edges: [
                { id: 'e1', source: 'trigger', target: 'is_pt' },
                { id: 'e2', source: 'is_pt', target: 'forward', sourceHandle: 'true' },
                { id: 'e3', source: 'forward', target: 'store_customer' },
                { id: 'e4', source: 'is_pt', target: 'notify_other', sourceHandle: 'false' },
            ],
        },
    },
    {
        name: 'Delayed welcome',
        description: 'Wait a little after sign-up, then send a welcome email.',
        active: true,
        definition: {
            nodes: [
                {
                    id: 'trigger',
                    type: 'trigger',
                    label: 'User created',
                    position: at(0, 0),
                    config: { type: 'event', eventName: 'user.created' },
                },
                {
                    id: 'wait',
                    type: 'delay',
                    label: 'Wait 30 seconds',
                    position: at(0, 140),
                    config: { amount: 30, unit: 'seconds' },
                },
                {
                    id: 'welcome_email',
                    type: 'email',
                    label: 'Welcome email',
                    position: at(0, 280),
                    config: {
                        to: '{{event.email}}',
                        subject: 'Welcome, {{event.name}}!',
                        body: 'Hi {{event.name}}, thanks for signing up.',
                    },
                },
            ],
            edges: [
                { id: 'e1', source: 'trigger', target: 'wait' },
                { id: 'e2', source: 'wait', target: 'welcome_email' },
            ],
        },
    },
    {
        name: 'Minute heartbeat',
        description: 'Schedule demo: activate it and a record is written every minute.',
        active: false,
        definition: {
            nodes: [
                {
                    id: 'trigger',
                    type: 'trigger',
                    label: 'Every minute',
                    position: at(0, 0),
                    config: { type: 'schedule', cron: '* * * * *', timezone: 'UTC' },
                },
                {
                    id: 'beat',
                    type: 'create_record',
                    label: 'Write heartbeat',
                    position: at(0, 140),
                    config: {
                        collection: 'heartbeats',
                        data: { at: '{{event.scheduledAt}}', execution: '{{execution.id}}' },
                    },
                },
            ],
            edges: [{ id: 'e1', source: 'trigger', target: 'beat' }],
        },
    },
    {
        name: 'Flaky endpoint',
        description:
            'Retry demo: the HTTP call always returns 500, so it is retried three times and fails.',
        active: false,
        definition: {
            nodes: [
                {
                    id: 'trigger',
                    type: 'trigger',
                    label: 'Manual',
                    position: at(0, 0),
                    config: { type: 'manual' },
                },
                {
                    id: 'call_api',
                    type: 'http_request',
                    label: 'Call unstable API',
                    position: at(0, 140),
                    config: {
                        method: 'GET',
                        url: 'https://httpbin.org/status/500',
                        headers: [],
                        query: [],
                        bodyType: 'none',
                        timeoutMs: 5000,
                        maxAttempts: 3,
                    },
                },
            ],
            edges: [{ id: 'e1', source: 'trigger', target: 'call_api' }],
        },
    },
]

export async function seedDemo(): Promise<{ userId: number }> {
    const passwordHash = await hashPassword(DEMO_PASSWORD)
    const { rows } = await pool.query<{ id: number }>(
        `INSERT INTO users (name, email, password_hash) VALUES ('Demo', $1, $2)
         ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
         RETURNING id`,
        [DEMO_EMAIL, passwordHash],
    )
    const userId = rows[0].id

    // Reset: archive the demo account's current workflows (history is kept).
    await pool.query(
        'UPDATE workflows SET deleted_at = now(), is_active = false WHERE user_id = $1 AND deleted_at IS NULL',
        [userId],
    )

    for (const demo of DEMO_WORKFLOWS) {
        const created = await createWorkflow(userId, {
            name: demo.name,
            description: demo.description,
            definition: demo.definition,
        })
        if (demo.active) await setActive(userId, created.id, true)
    }
    return { userId }
}

if (require.main === module) {
    seedDemo()
        .then(() =>
            logger.info(
                { login: `${DEMO_EMAIL} / ${DEMO_PASSWORD}`, workflows: DEMO_WORKFLOWS.length },
                'Demo account ready',
            ),
        )
        .catch((err) => {
            logger.error({ err }, 'Seed failed')
            process.exitCode = 1
        })
        .finally(async () => {
            await closeQueue()
            await pool.end()
        })
}
