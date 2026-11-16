import type { JsonValue } from './types.js'

type Segment = { kind: 'key'; key: string } | { kind: 'index'; index: number } | { kind: 'all' }

const SEGMENT = /([^.[\]]+)|\[(\d+|\*)\]/g

export function parsePath(path: string): Segment[] {
  const trimmed = path.trim()
  if (!trimmed) return []
  const segments: Segment[] = []
  let consumed = 0
  for (const match of trimmed.matchAll(SEGMENT)) {
    const gap = trimmed.slice(consumed, match.index)
    if (gap && gap !== '.') throw new SyntaxError(`invalid path "${path}" near "${gap}"`)
    consumed = match.index + match[0].length
    if (match[1] !== undefined) segments.push({ kind: 'key', key: match[1] })
    else if (match[2] === '*') segments.push({ kind: 'all' })
    else segments.push({ kind: 'index', index: Number(match[2]) })
  }
  if (consumed !== trimmed.length) throw new SyntaxError(`invalid path "${path}"`)
  return segments
}

/**
 * Read `a.b[0].c` or `a[*].b` from a JSON value. A `[*]` segment maps the rest
 * of the path over the array; missing keys yield `undefined`.
 */
export function getPath(value: JsonValue | undefined, path: string | Segment[]): JsonValue | undefined {
  const segments = typeof path === 'string' ? parsePath(path) : path
  let current: JsonValue | undefined = value
  for (let i = 0; i < segments.length; i++) {
    if (current === undefined || current === null) return undefined
    const seg = segments[i]!
    if (seg.kind === 'all') {
      if (!Array.isArray(current)) return undefined
      const rest = segments.slice(i + 1)
      return current.map((item) => getPath(item, rest) ?? null)
    }
    if (seg.kind === 'index') {
      current = Array.isArray(current) ? current[seg.index] : undefined
    } else {
      current = typeof current === 'object' && !Array.isArray(current) ? current[seg.key] : undefined
    }
  }
  return current
}
