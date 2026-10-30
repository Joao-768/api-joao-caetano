import type { ConditionOperator } from '@wae/shared'

/**
 * Evaluates one comparison, without eval and without an expression language.
 *
 * The right-hand value comes from a text field in the builder, so it is
 * usually a string. Before comparing, it is coerced towards the type of the
 * left-hand value read from the context:
 *
 *   left is a number   "100"   -> 100
 *   left is a boolean  "true"  -> true
 *   left is null       "null"  -> null
 *   anything else      compared as written
 *
 * Ordering operators (gt, gte, lt, lte) only compare numbers; numeric
 * strings count as numbers. A missing left-hand value makes every
 * comparison false, which is what `exists` / `not_exists` are for.
 */

export type ConditionOutcome = {
    result: boolean
    left: unknown
    operator: ConditionOperator
    right: unknown
    reason?: string
}

export function evaluateCondition(
    left: unknown,
    operator: ConditionOperator,
    rawRight: unknown,
): ConditionOutcome {
    const right = coerceTowards(left, rawRight)
    const outcome = (result: boolean, reason?: string): ConditionOutcome => ({
        result,
        left,
        operator,
        right,
        ...(reason ? { reason } : {}),
    })

    switch (operator) {
        case 'exists':
            return outcome(left !== undefined && left !== null)
        case 'not_exists':
            return outcome(left === undefined || left === null)
    }

    if (left === undefined)
        return outcome(
            operator === 'not_equals' || operator === 'not_contains',
            'The value does not exist',
        )

    switch (operator) {
        case 'equals':
            return outcome(isEqual(left, right))
        case 'not_equals':
            return outcome(!isEqual(left, right))
        case 'contains':
            return outcome(contains(left, right))
        case 'not_contains':
            return outcome(!contains(left, right))
        case 'gt':
        case 'gte':
        case 'lt':
        case 'lte': {
            const a = toNumber(left)
            const b = toNumber(right)
            if (a === null || b === null)
                return outcome(false, 'Only numbers can be compared this way')
            const result =
                operator === 'gt'
                    ? a > b
                    : operator === 'gte'
                      ? a >= b
                      : operator === 'lt'
                        ? a < b
                        : a <= b
            return outcome(result)
        }
    }
}

function coerceTowards(left: unknown, right: unknown): unknown {
    if (typeof right !== 'string') return right
    if (typeof left === 'number') return toNumber(right) ?? right
    if (typeof left === 'boolean' && (right === 'true' || right === 'false'))
        return right === 'true'
    if (left === null && right === 'null') return null
    return right
}

function toNumber(value: unknown): number | null {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value)
        return Number.isFinite(parsed) ? parsed : null
    }
    return null
}

function isEqual(left: unknown, right: unknown): boolean {
    if (left !== null && typeof left === 'object')
        return JSON.stringify(left) === JSON.stringify(right)
    return left === right
}

function contains(left: unknown, right: unknown): boolean {
    if (typeof left === 'string') return left.includes(String(right))
    if (Array.isArray(left)) return left.some((item) => isEqual(item, coerceTowards(item, right)))
    return false
}
