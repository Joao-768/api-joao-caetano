import nodemailer from 'nodemailer'
import { env } from '../config/env'

/**
 * Email is sent through an adapter so the engine does not care how.
 *
 *   SMTP_HOST set      -> SmtpEmailSender delivers through that server
 *   SMTP_HOST missing  -> SimulatedEmailSender records the message and
 *                         reports `mode: "simulated"`, so the app works with
 *                         no paid service and the trace says so plainly.
 */

export type EmailMessage = { to: string; subject: string; text: string }
export type EmailReceipt = { mode: 'smtp' | 'simulated'; messageId: string; acceptedAt: string }

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

export class SmtpEmailSender implements EmailSender {
    readonly mode = 'smtp' as const
    private transport = nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_SECURE,
        auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
        connectionTimeout: 10_000,
        socketTimeout: 15_000,
    })

    async send(message: EmailMessage): Promise<EmailReceipt> {
        const info = await this.transport.sendMail({ from: env.SMTP_FROM, ...message })
        return { mode: this.mode, messageId: info.messageId, acceptedAt: new Date().toISOString() }
    }
}

export function createEmailSender(): EmailSender {
    return env.SMTP_HOST ? new SmtpEmailSender() : new SimulatedEmailSender()
}
