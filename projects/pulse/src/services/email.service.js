// Email delivery, separate from auth logic. Auth asks for "send the reset
// email"; this module decides how it is written and delivered.
//
// With RESEND_API_KEY set, mail goes through Resend. Without it (local
// development), the message is written to the server log instead, so the
// reset flow can still be tested end to end.

import { Resend } from 'resend'
import { env } from '../config/env.js'
import { logger } from '../utils/logger.js'

const resend = env.resendApiKey ? new Resend(env.resendApiKey) : null

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)
}

async function deliver({ to, subject, html, text }) {
    if (!resend) {
        if (env.isProduction) {
            throw new Error('RESEND_API_KEY is not configured')
        }
        logger.info('Email (dev transport, not sent)', { to, subject, text })
        return
    }

    const { error } = await resend.emails.send({ from: env.emailFrom, to, subject, html, text })
    if (error) {
        throw new Error(`Resend rejected the email: ${error.message}`)
    }
    logger.info('Email sent', { to, subject })
}

export async function sendPasswordResetEmail({ to, resetUrl, expiresInMinutes }) {
    const subject = 'Reset your Pulse Monitor password'
    const text = [
        'Someone asked to reset the password for this Pulse Monitor account.',
        '',
        `Choose a new password here (the link expires in ${expiresInMinutes} minutes and works once):`,
        resetUrl,
        '',
        'If this was not you, ignore this email. Your password stays the same.',
    ].join('\n')

    const html = `
        <div style="font-family: -apple-system, Segoe UI, sans-serif; max-width: 480px; color: #10131a;">
            <p style="font-size: 13px; letter-spacing: 0.08em; text-transform: uppercase; color: #5b6472;">Pulse Monitor</p>
            <h1 style="font-size: 22px; margin: 8px 0 16px;">Reset your password</h1>
            <p>Someone asked to reset the password for this account. The link expires in
               ${expiresInMinutes} minutes and works once.</p>
            <p style="margin: 28px 0;">
                <a href="${escapeHtml(resetUrl)}"
                   style="background: #10131a; color: #ffffff; padding: 12px 20px; border-radius: 6px; text-decoration: none;">
                   Choose a new password</a>
            </p>
            <p style="color: #5b6472; font-size: 14px;">If this was not you, ignore this email. Your password stays the same.</p>
        </div>`

    await deliver({ to, subject, html, text })
}
