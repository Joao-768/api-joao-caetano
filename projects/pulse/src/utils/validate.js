// Small input validators. Each returns an error message or null.

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function validateEmail(value) {
    if (typeof value !== 'string' || value.trim() === '') return 'Enter your email address.'
    if (value.length > 254 || !EMAIL_PATTERN.test(value.trim()))
        return 'Enter a valid email address.'
    return null
}

export function validateNewPassword(value) {
    if (typeof value !== 'string' || value.length === 0) return 'Enter a password.'
    if (value.length < 8) return 'Use at least 8 characters.'
    // scrypt input is bounded to keep hashing cost predictable.
    if (value.length > 128) return 'Use at most 128 characters.'
    return null
}

export function validateMonitorName(value) {
    if (typeof value !== 'string' || value.trim() === '') return 'Enter a name.'
    if (value.trim().length > 80) return 'Use at most 80 characters.'
    return null
}

export function normalizeEmail(value) {
    return value.trim().toLowerCase()
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value) {
    return typeof value === 'string' && UUID_PATTERN.test(value)
}

export function parsePage(value, fallback = 1) {
    const page = Number.parseInt(value, 10)
    return Number.isFinite(page) && page > 0 ? Math.min(page, 10_000) : fallback
}
