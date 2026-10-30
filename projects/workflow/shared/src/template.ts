import { getPath, normalizePath, type ExecutionContext } from './paths'

/**
 * Template resolution: `{{ path }}` placeholders inside node configuration are
 * replaced with values from the execution context.
 *
 *   "Hi {{event.customer.name}}"          -> "Hi Ana"
 *   "Order {{steps.http_1.body.id}} done" -> "Order 42 done"
 *   "{{email}}"                           -> "ana@mail.com" (V1 shorthand for event.email)
 *
 * Rules, in the order they matter:
 *
 * 1. Objects and arrays are resolved recursively, so a JSON body or a record
 *    payload can carry placeholders at any depth.
 * 2. A string that is exactly one placeholder keeps the value's type:
 *    `"{{event.total}}"` resolves to the number 149.99, not the string.
 * 3. Inside longer text, values are stringified: objects become JSON and
 *    `null` becomes an empty string.
 * 4. A path that does not exist is an error. The whole resolution fails with
 *    a `TemplateError` listing every missing path, instead of quietly writing
 *    "undefined" into an email or an HTTP request.
 */

export const TEMPLATE_PATTERN = /\{\{\s*([^{}]+?)\s*\}\}/g
const WHOLE_TEMPLATE = /^\{\{\s*([^{}]+?)\s*\}\}$/

export class TemplateError extends Error {
    readonly missing: string[]

    constructor(missing: string[]) {
        const list = missing.map((path) => `{{${path}}}`).join(', ')
        super(`Unresolved template variable${missing.length > 1 ? 's' : ''}: ${list}`)
        this.name = 'TemplateError'
        this.missing = missing
    }
}

export function resolveTemplate<T>(value: T, context: ExecutionContext): unknown {
    const missing = new Set<string>()
    const resolved = resolveValue(value, context, missing)
    if (missing.size > 0) throw new TemplateError([...missing])
    return resolved
}

function resolveValue(value: unknown, context: ExecutionContext, missing: Set<string>): unknown {
    if (typeof value === 'string') return resolveString(value, context, missing)
    if (Array.isArray(value)) return value.map((item) => resolveValue(item, context, missing))
    if (value !== null && typeof value === 'object') {
        const out: Record<string, unknown> = {}
        for (const [key, inner] of Object.entries(value)) {
            out[key] = resolveValue(inner, context, missing)
        }
        return out
    }
    return value
}

function resolveString(text: string, context: ExecutionContext, missing: Set<string>): unknown {
    const whole = text.match(WHOLE_TEMPLATE)
    if (whole) {
        const found = lookup(whole[1], context)
        if (found === undefined) missing.add(whole[1])
        return found
    }

    return text.replace(TEMPLATE_PATTERN, (placeholder, path: string) => {
        const found = lookup(path, context)
        if (found === undefined) {
            missing.add(path)
            return placeholder
        }
        return stringify(found)
    })
}

function lookup(path: string, context: ExecutionContext): unknown {
    try {
        return getPath(context, normalizePath(path))
    } catch {
        return undefined
    }
}

function stringify(value: unknown): string {
    if (value === null) return ''
    if (typeof value === 'object') return JSON.stringify(value)
    return String(value)
}

/**
 * Lists every placeholder path found anywhere in a value, normalised
 * (so "email" is reported as "event.email"). Used by the graph validator to
 * check that `steps.<id>` references point at nodes that run earlier.
 */
export function findTemplatePaths(value: unknown): string[] {
    const found: string[] = []
    collect(value, found)
    return found
}

function collect(value: unknown, found: string[]) {
    if (typeof value === 'string') {
        for (const match of value.matchAll(TEMPLATE_PATTERN)) {
            try {
                found.push(normalizePath(match[1]).join('.'))
            } catch {
                found.push(match[1])
            }
        }
    } else if (Array.isArray(value)) {
        value.forEach((item) => collect(item, found))
    } else if (value !== null && typeof value === 'object') {
        Object.values(value).forEach((item) => collect(item, found))
    }
}
