// Turns a raw HTTP response (or network error) into a check outcome.
//
// Success is decided by rules instead of a hard-coded "status === 200", so
// later versions can add per-monitor expectations (expected status, keyword in
// body, max latency) by adding rules without touching the runner.

import { STATUS_CODES } from 'node:http'

export const ERROR_TYPES = {
    TIMEOUT: 'TIMEOUT',
    DNS: 'DNS',
    CONNECTION_REFUSED: 'CONNECTION_REFUSED',
    CONNECTION_RESET: 'CONNECTION_RESET',
    TLS: 'TLS',
    HTTP_4XX: 'HTTP_4XX',
    HTTP_5XX: 'HTTP_5XX',
    HTTP_OTHER: 'HTTP_OTHER',
    TOO_MANY_REDIRECTS: 'TOO_MANY_REDIRECTS',
    BLOCKED: 'BLOCKED',
    NETWORK: 'NETWORK',
}

function describeStatus(code) {
    const text = STATUS_CODES[code]
    return text ? `HTTP ${code} ${text}` : `HTTP ${code}`
}

// Each rule returns null when it passes or { errorType, message } when it fails.
// Rules run in order; the first failure wins.
export const DEFAULT_RESPONSE_RULES = [
    function statusIsSuccessOrRedirect({ statusCode }) {
        if (statusCode >= 200 && statusCode < 400) return null
        if (statusCode >= 400 && statusCode < 500) {
            return { errorType: ERROR_TYPES.HTTP_4XX, message: describeStatus(statusCode) }
        }
        if (statusCode >= 500) {
            return { errorType: ERROR_TYPES.HTTP_5XX, message: describeStatus(statusCode) }
        }
        return { errorType: ERROR_TYPES.HTTP_OTHER, message: describeStatus(statusCode) }
    },
]

export function evaluateResponse(response, rules = DEFAULT_RESPONSE_RULES) {
    for (const rule of rules) {
        const failure = rule(response)
        if (failure) {
            return { success: false, ...failure }
        }
    }
    return { success: true, errorType: null, message: null }
}

const TLS_CODES = new Set([
    'CERT_HAS_EXPIRED',
    'CERT_NOT_YET_VALID',
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'SELF_SIGNED_CERT_IN_CHAIN',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
    'ERR_TLS_CERT_ALTNAME_INVALID',
    'ERR_SSL_WRONG_VERSION_NUMBER',
])

// Maps a thrown fetch/DNS error to a failure category and a readable message.
export function classifyNetworkError(error) {
    const cause = error?.cause ?? error
    // Happy-eyeballs connects (IPv4 + IPv6) fail with an AggregateError.
    const code = cause?.code ?? cause?.errors?.[0]?.code ?? error?.code

    if (error?.name === 'BlockedTargetError') {
        return { errorType: ERROR_TYPES.BLOCKED, message: error.message }
    }
    if (error?.name === 'TooManyRedirectsError') {
        return { errorType: ERROR_TYPES.TOO_MANY_REDIRECTS, message: error.message }
    }
    if (
        error?.name === 'TimeoutError' ||
        error?.name === 'AbortError' ||
        code === 'UND_ERR_CONNECT_TIMEOUT' ||
        code === 'UND_ERR_HEADERS_TIMEOUT' ||
        code === 'ETIMEDOUT'
    ) {
        return { errorType: ERROR_TYPES.TIMEOUT, message: 'Request timed out' }
    }
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'ENODATA') {
        return { errorType: ERROR_TYPES.DNS, message: 'DNS lookup failed: host not found' }
    }
    if (code === 'ECONNREFUSED') {
        return { errorType: ERROR_TYPES.CONNECTION_REFUSED, message: 'Connection refused' }
    }
    if (code === 'ECONNRESET' || code === 'UND_ERR_SOCKET' || code === 'EPIPE') {
        return { errorType: ERROR_TYPES.CONNECTION_RESET, message: 'Connection reset by server' }
    }
    if (TLS_CODES.has(code) || /certificate|ssl|tls/i.test(cause?.message ?? '')) {
        return {
            errorType: ERROR_TYPES.TLS,
            message: `TLS error: ${cause?.message ?? code ?? 'handshake failed'}`,
        }
    }
    if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') {
        return { errorType: ERROR_TYPES.NETWORK, message: 'Host unreachable' }
    }
    return {
        errorType: ERROR_TYPES.NETWORK,
        message: `Network error${code ? ` (${code})` : ''}`,
    }
}
