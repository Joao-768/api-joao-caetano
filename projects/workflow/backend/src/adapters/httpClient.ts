import dns from 'node:dns'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import type { LookupFunction } from 'node:net'

/**
 * A minimal HTTP client for the HTTP Request node, with the protections a
 * public-facing automation tool needs:
 *
 *   - SSRF guard: the target host is resolved and every address is checked
 *     against private, loopback and link-local ranges. The check runs inside
 *     the socket's DNS lookup, so the address that is checked is the address
 *     that is connected to (no DNS-rebinding gap between check and use).
 *   - Timeout: the request is destroyed after `timeoutMs`.
 *   - Size limit: at most `maxBytes` of the response body are read.
 *   - No redirects are followed: a 3xx is returned as-is.
 */

export type HttpRequest = {
    method: string
    url: string
    headers: Record<string, string>
    body?: string
    timeoutMs: number
    maxBytes: number
    allowPrivateNetworks: boolean
    signal?: AbortSignal
}

export type HttpResponse = {
    status: number
    statusText: string
    headers: Record<string, string>
    /** Raw body text, cut at maxBytes. */
    text: string
    truncated: boolean
    durationMs: number
}

export type HttpFailureKind = 'timeout' | 'blocked' | 'dns' | 'network' | 'invalid_url' | 'aborted'

export class HttpClientError extends Error {
    constructor(
        readonly kind: HttpFailureKind,
        message: string,
    ) {
        super(message)
        this.name = 'HttpClientError'
    }
}

const blocked = new net.BlockList()
for (const [network, prefix] of [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4],
] as const) {
    blocked.addSubnet(network, prefix, 'ipv4')
}
for (const [network, prefix] of [
    ['::', 128],
    ['::1', 128],
    ['fc00::', 7],
    ['fe80::', 10],
    ['ff00::', 8],
] as const) {
    blocked.addSubnet(network, prefix, 'ipv6')
}

export function isPrivateAddress(address: string): boolean {
    const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)
    if (mapped) return blocked.check(mapped[1], 'ipv4')
    const family = net.isIP(address)
    if (family === 0) return true
    return blocked.check(address, family === 4 ? 'ipv4' : 'ipv6')
}

function guardedLookup(allowPrivate: boolean): LookupFunction {
    return (hostname, options, callback) => {
        dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
            if (err) return callback(err, '', 0)
            const list = addresses as dns.LookupAddress[]
            if (!allowPrivate) {
                const forbidden = list.find((entry) => isPrivateAddress(entry.address))
                if (forbidden) {
                    return callback(
                        new HttpClientError(
                            'blocked',
                            `${hostname} resolves to a private address, which is not allowed`,
                        ),
                        '',
                        0,
                    )
                }
            }
            if (options.all) return callback(null, list)
            callback(null, list[0].address, list[0].family)
        })
    }
}

export function sendHttpRequest(request: HttpRequest): Promise<HttpResponse> {
    let url: URL
    try {
        url = new URL(request.url)
    } catch {
        return Promise.reject(
            new HttpClientError('invalid_url', `"${request.url}" is not a valid URL`),
        )
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return Promise.reject(
            new HttpClientError('invalid_url', 'Only http and https URLs are allowed'),
        )
    }

    // IP literals never go through DNS, so check them directly.
    const host = url.hostname.replace(/^\[|\]$/g, '')
    if (!request.allowPrivateNetworks && net.isIP(host) && isPrivateAddress(host)) {
        return Promise.reject(new HttpClientError('blocked', `Requests to ${host} are not allowed`))
    }

    const client = url.protocol === 'https:' ? https : http
    const started = Date.now()

    return new Promise((resolve, reject) => {
        const req = client.request(url, {
            method: request.method,
            headers: request.headers,
            lookup: guardedLookup(request.allowPrivateNetworks),
        })

        const timer = setTimeout(() => {
            req.destroy(new HttpClientError('timeout', `No response after ${request.timeoutMs} ms`))
        }, request.timeoutMs)

        const onAbort = () =>
            req.destroy(new HttpClientError('aborted', 'The request was cancelled'))
        request.signal?.addEventListener('abort', onAbort, { once: true })

        const finish = () => {
            clearTimeout(timer)
            request.signal?.removeEventListener('abort', onAbort)
        }

        req.on('error', (err) => {
            finish()
            reject(err instanceof HttpClientError ? err : classify(err))
        })

        req.on('response', (res) => {
            const chunks: Buffer[] = []
            let size = 0
            let truncated = false

            res.on('data', (chunk: Buffer) => {
                if (truncated) return
                const room = request.maxBytes - size
                if (chunk.length > room) {
                    chunks.push(chunk.subarray(0, room))
                    size += room
                    truncated = true
                    res.destroy()
                    done()
                    return
                }
                chunks.push(chunk)
                size += chunk.length
            })
            res.on('end', () => done())
            res.on('error', (err) => {
                if (!truncated) {
                    finish()
                    reject(classify(err))
                }
            })

            let settled = false
            function done() {
                if (settled) return
                settled = true
                finish()
                const headers: Record<string, string> = {}
                for (const [key, value] of Object.entries(res.headers)) {
                    if (value !== undefined)
                        headers[key] = Array.isArray(value) ? value.join(', ') : value
                }
                resolve({
                    status: res.statusCode ?? 0,
                    statusText: res.statusMessage ?? '',
                    headers,
                    text: Buffer.concat(chunks).toString('utf8'),
                    truncated,
                    durationMs: Date.now() - started,
                })
            }
        })

        if (request.body !== undefined) req.write(request.body)
        req.end()
    })
}

function classify(err: Error & { code?: string }): HttpClientError {
    if (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN') {
        return new HttpClientError('dns', `Could not resolve host (${err.code})`)
    }
    return new HttpClientError('network', `${err.code ?? 'Network error'}: ${err.message}`)
}
