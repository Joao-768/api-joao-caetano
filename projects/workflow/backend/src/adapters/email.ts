import { env } from '../config/env'
import { NodeError } from '../engine/errors'

/**
 * Email is sent through an adapter so the engine does not care how.
 *
 *   RESEND_API_KEY set      -> ResendEmailSender delivers through Resend's
 *                              HTTP API (the host blocks outbound SMTP ports,
 *                              so SMTP is not an option there)
 *   RESEND_API_KEY missing  -> SimulatedEmailSender records the message and
 *                              reports `mode: "simulated"`, so the app works
 *                              with no paid service and the trace says so plainly.
 */

export type EmailMessage = { to: string; subject: string; text: string }
export type EmailReceipt = { mode: 'resend' | 'simulated'; messageId: string; acceptedAt: string }

export interface EmailSender {
    readonly mode: EmailReceipt['mode']
    send(message: EmailMessage): Promise<EmailReceipt>
}

export class SimulatedEmailSender implements EmailSender {
    readonly mode = 'simulated' as const
    readonly sent: EmailMessage[] = []

    async send(message: EmailMessage): Promise<EmailReceipt> {
        this.sent.push(message)
        return {
            mode: this.mode,
            messageId: `simulated-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            acceptedAt: new Date().toISOString(),
        }
    }
}

const RESEND_URL = 'https://api.resend.com/emails'

export class ResendEmailSender implements EmailSender {
    readonly mode = 'resend' as const

    constructor(private readonly apiKey: string) {}

    async send(message: EmailMessage): Promise<EmailReceipt> {
        const response = await fetch(RESEND_URL, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ from: env.EMAIL_FROM, ...message }),
            signal: AbortSignal.timeout(15_000),
        })
        const body = (await response.json().catch(() => ({}))) as { id?: string; message?: string }

        if (!response.ok) {
            // Rate limits and server errors may pass; anything else (a bad
            // address, an unverified sender) will fail the same way again.
            const retryable = response.status === 429 || response.status >= 500
            throw new NodeError(
                'email_rejected',
                `Resend answered ${response.status}: ${body.message ?? response.statusText}`,
                retryable,
            )
        }
        return {
            mode: this.mode,
            messageId: body.id ?? 'unknown',
            acceptedAt: new Date().toISOString(),
        }
    }
}

export function createEmailSender(): EmailSender {
    return env.RESEND_API_KEY
        ? new ResendEmailSender(env.RESEND_API_KEY)
        : new SimulatedEmailSender()
}
