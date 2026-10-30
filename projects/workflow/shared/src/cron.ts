import { CronExpressionParser } from 'cron-parser'

export type CronCheck = { valid: true; next: Date } | { valid: false; error: string }

/**
 * Validates a standard five-field cron expression (minute hour day month
 * weekday). Six-field expressions with seconds are rejected on purpose: a
 * workflow firing every second is not a schedule, it is load.
 */
export function checkCron(expression: string, timezone = 'UTC'): CronCheck {
    const trimmed = expression.trim()
    const fields = trimmed.split(/\s+/)

    if (fields.length !== 5) {
        return {
            valid: false,
            error: 'Use five fields: minute hour day-of-month month day-of-week',
        }
    }

    if (!isValidTimezone(timezone)) {
        return { valid: false, error: `Unknown timezone "${timezone}"` }
    }

    try {
        const parsed = CronExpressionParser.parse(trimmed, { tz: timezone })
        return { valid: true, next: parsed.next().toDate() }
    } catch (err) {
        return {
            valid: false,
            error: err instanceof Error ? err.message : 'Invalid cron expression',
        }
    }
}

export function isValidTimezone(timezone: string): boolean {
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: timezone })
        return true
    } catch {
        return false
    }
}
