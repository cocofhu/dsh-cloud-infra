import type { ParamNode } from './catalog.js'
import type { JsonObject, JsonValue } from './types.js'

/**
 * Bring model-written params in line with the declared field types: numbers
 * and booleans for string fields become strings (Tencent's VPC `Limit` is a
 * string), numeric strings for number fields become numbers, "true"/"false"
 * become booleans, and a single value for a list field becomes a one-item list.
 * Unknown fields and values that do not fit are left for the API to reject.
 */
export function coerceParams(params: JsonObject, nodes: ParamNode[]): { params: JsonObject; changed: string[] } {
  const changed: string[] = []
  const walk = (obj: JsonObject, fields: ParamNode[], at: string): JsonObject => {
    const out: JsonObject = { ...obj }
    for (const field of fields) {
      if (!Object.hasOwn(obj, field.name)) continue
      const path = at ? `${at}.${field.name}` : field.name
      const next = coerceValue(obj[field.name]!, field, path, changed, walk)
      out[field.name] = next
    }
    return out
  }
  return { params: walk(params, nodes, ''), changed }
}

type Walk = (obj: JsonObject, fields: ParamNode[], at: string) => JsonObject

function coerceValue(value: JsonValue, field: ParamNode, path: string, changed: string[], walk: Walk): JsonValue {
  const isList = field.type.endsWith('[]')
  const base = isList ? field.type.slice(0, -2) : field.type
  if (isList) {
    let list = value
    if (!Array.isArray(list)) {
      if (list === null) return list
      list = [list]
      changed.push(`${path}: wrapped in a list`)
    }
    return list.map((item, i) => coerceItem(item, base, field, `${path}[${i}]`, changed, walk))
  }
  return coerceItem(value, base, field, path, changed, walk)
}

function coerceItem(value: JsonValue, base: string, field: ParamNode, path: string, changed: string[], walk: Walk): JsonValue {
  if (base === 'string' && (typeof value === 'number' || typeof value === 'boolean')) {
    changed.push(`${path}: ${typeof value} → string`)
    return String(value)
  }
  if (base === 'number' && typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    changed.push(`${path}: string → number`)
    return Number(value)
  }
  if (base === 'boolean' && (value === 'true' || value === 'false')) {
    changed.push(`${path}: string → boolean`)
    return value === 'true'
  }
  if (field.children && value && typeof value === 'object' && !Array.isArray(value)) return walk(value, field.children, path)
  return value
}
