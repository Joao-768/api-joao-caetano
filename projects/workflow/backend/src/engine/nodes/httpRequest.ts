import { resolveTemplate, type HttpBodyType, type HttpMethod } from '@wae/shared'
import { env } from '../../config/env'
import { HttpClientError, type HttpResponse } from '../../adapters/httpClient'
import { NodeError } from '../errors'
import { defineNode } from './types'

type HttpInput = {
    method: HttpMethod
    url: string
    headers: Record<string, string>
    bodyType: HttpBodyType
    body: unknown
    timeoutMs: number
}

/** How much of a response body is kept in the execution trace. */
const STORED_BODY_LIMIT = 16_000

const SENSITIVE = /authorization|cookie|token|secret|password|api[-_]?key/i

/**
 * A real HTTP call. Everything in the config can use templates, including
 * nested JSON bodies. Retry behaviour follows the response:
 *
 *   timeout, connection error, 5xx, 429  -> retryable
 *   other 4xx, blocked host, bad URL     -> fails immediately
 */
export const httpRequestNode = defineNode<'http_request', HttpInput>({
    prepare(node, context) {
        const config = node.config
        const rawUrl = String(resolveTemplate(config.url, context))
        let url: URL
        try {
            url = new URL(rawUrl)
        } catch {
            throw new NodeError('invalid_url', `"${rawUrl}" is not a valid URL`, false)
        }
        for (const { key, value } of config.query) {
            url.searchParams.append(key, String(resolveTemplate(value, context)))
        }

        const headers: Record<string, string> = {}
        for (const { key, value } of config.headers) {
            headers[key.toLowerCase()] = String(resolveTemplate(value, context))
        }

        return {
            method: config.method,
            url: url.toString(),
            headers,
            bodyType: config.bodyType,
            body: config.bodyType === 'none' ? undefined : resolveTemplate(config.body, context),
            timeoutMs: Math.min(config.timeoutMs, env.NODE_TIMEOUT_MS),
        }
    },

    redact(input) {
        const url = new URL(input.url)
        // Copy the keys first: the loop changes the parameters it iterates.
        for (const key of Array.from(url.searchParams.keys())) {
            if (SENSITIVE.test(key)) url.searchParams.set(key, '[redacted]')
        }
        const headers = Object.fromEntries(
            Object.entries(input.headers).map(([key, value]) => [
                key,
                SENSITIVE.test(key) ? '[redacted]' : value,
            ]),
        )
        return { ...input, url: url.toString(), headers }
    },

    async run(input, _node, runtime) {
        const headers: Record<string, string> = {
            'user-agent': 'workflow-automation-engine/2',
            ...input.headers,
        }
        let body: string | undefined
        if (input.bodyType === 'json') {
            body = JSON.stringify(input.body)
            headers['content-type'] ??= 'application/json'
        } else if (input.bodyType === 'text') {
            body = String(input.body ?? '')
            headers['content-type'] ??= 'text/plain; charset=utf-8'
        }

        let response: HttpResponse
        try {
            response = await runtime.services.http({
                method: input.method,
                url: input.url,
                headers,
                body,
                timeoutMs: input.timeoutMs,
                maxBytes: env.HTTP_MAX_RESPONSE_BYTES,
                allowPrivateNetworks: env.HTTP_ALLOW_PRIVATE_NETWORKS,
                signal: runtime.signal,
            })
        } catch (err) {
            throw toHttpNodeError(err)
        }

        const output = {
            status: response.status,
            statusText: response.statusText,
            contentType: response.headers['content-type'] ?? null,
            body: parseBody(response),
            truncated: response.truncated || response.text.length > STORED_BODY_LIMIT,
            durationMs: response.durationMs,
        }

        if (response.status >= 400) {
            const retryable = response.status >= 500 || response.status === 429
            throw new NodeError(
                'http_status',
                `The server responded with ${response.status} ${response.statusText}`.trim(),
                retryable,
                {
                    status: response.status,
                    body: response.text.slice(0, 2000),
                },
            )
        }

        return { output }
    },
})

function parseBody(response: HttpResponse): unknown {
    const isJson = /json/i.test(response.headers['content-type'] ?? '')
    if (isJson && !response.truncated) {
        try {
            const parsed = JSON.parse(response.text)
            if (response.text.length <= STORED_BODY_LIMIT) return parsed
        } catch {
            // Fall through and keep the text.
        }
    }
    return response.text.slice(0, STORED_BODY_LIMIT)
}

function toHttpNodeError(err: unknown): NodeError {
    if (!(err instanceof HttpClientError)) {
        return new NodeError('http_error', err instanceof Error ? err.message : String(err), true)
    }
    switch (err.kind) {
        case 'timeout':
            return new NodeError('http_timeout', err.message, true)
        case 'network':
            return new NodeError('http_network', err.message, true)
        case 'aborted':
            return new NodeError('node_timeout', 'The node took too long and was stopped', true)
        case 'dns':
            return new NodeError('http_dns', err.message, false)
        case 'blocked':
            return new NodeError('http_blocked', err.message, false)
        case 'invalid_url':
            return new NodeError('invalid_url', err.message, false)
    }
}
