import type { JsonValue } from './types.js'

export interface TruncatedJson {
  text: string
  truncated: boolean
}

const ARRAY_STEPS = [Infinity, 50, 20, 10, 5, 3, 1]
const STRING_STEPS = [Infinity, 2000, 500, 200, 80]

/**
 * Serialize `value` within `maxChars`, shrinking long arrays and strings first
 * so the model still sees the shape of every field. Elided items leave a
 * marker string with the original length.
 */
export function truncateJson(value: JsonValue, maxChars: number): TruncatedJson {
  for (const maxItems of ARRAY_STEPS) {
    for (const maxString of STRING_STEPS) {
      const shrunk = shrink(value, maxItems, maxString)
      const text = JSON.stringify(shrunk, null, 1)
      if (text.length <= maxChars) {
        return { text, truncated: maxItems !== Infinity || maxString !== Infinity }
      }
    }
  }
  const text = JSON.stringify(shrink(value, 1, 80))
  return { text: text.length <= maxChars ? text : `${text.slice(0, Math.max(0, maxChars - 1))}…`, truncated: true }
}

function shrink(value: JsonValue, maxItems: number, maxString: number): JsonValue {
  if (typeof value === 'string') {
    return value.length > maxString ? `${value.slice(0, maxString)}…(${value.length} chars)` : value
  }
  if (Array.isArray(value)) {
    const kept = value.slice(0, maxItems).map((item) => shrink(item, maxItems, maxString))
    if (value.length > maxItems) kept.push(`…(+${value.length - maxItems} more, ${value.length} total)`)
    return kept
  }
  if (value && typeof value === 'object') {
    const out: Record<string, JsonValue> = {}
    for (const [k, v] of Object.entries(value)) out[k] = shrink(v, maxItems, maxString)
    return out
  }
  return value
}
