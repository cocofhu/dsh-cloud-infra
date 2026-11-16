import { parsePath } from '../core/json-path.js'
import { AGGREGATES, CHART_TYPES, CONTENT_KINDS, FORMATS, NODE_KINDS, TONES } from './spec.js'

type Obj = Record<string, unknown>

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

export function isBinding(v: unknown): v is { ref: string; path?: string } {
  if (!isObj(v) || typeof v.ref !== 'string') return false
  return Object.keys(v).every((k) => k === 'ref' || k === 'path' || k === 'agg')
}

/**
 * Check an authored view and return every problem with its location, e.g.
 * `body.children[1].columns[0].key: required string`. An empty list means valid.
 */
export function validateView(input: unknown): string[] {
  const errors: string[] = []
  const err = (at: string, msg: string) => { if (errors.length < 30) errors.push(`${at}: ${msg}`) }

  const str = (o: Obj, key: string, at: string, required = false): void => {
    const v = o[key]
    if (v === undefined) { if (required) err(`${at}.${key}`, 'required string'); return }
    if (typeof v !== 'string') err(`${at}.${key}`, 'must be a string')
  }
  const path = (o: Obj, key: string, at: string, required = false): void => {
    str(o, key, at, required)
    if (typeof o[key] === 'string') {
      try { parsePath(o[key] as string) } catch (e) { err(`${at}.${key}`, (e as Error).message) }
    }
  }
  const oneOf = (o: Obj, key: string, allowed: readonly string[], at: string, required = false): void => {
    const v = o[key]
    if (v === undefined) { if (required) err(`${at}.${key}`, `required, one of ${allowed.join(' | ')}`); return }
    if (typeof v !== 'string' || !allowed.includes(v)) err(`${at}.${key}`, `must be one of ${allowed.join(' | ')}`)
  }
  const num = (o: Obj, key: string, at: string, min = -Infinity, max = Infinity): void => {
    const v = o[key]
    if (v === undefined) return
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) err(`${at}.${key}`, `must be a number in [${min}, ${max}]`)
  }
  const data = (o: Obj, key: string, at: string): void => {
    const v = o[key]
    if (v === undefined) { err(`${at}.${key}`, 'required: inline array/object or a binding { "ref": "r1", "path": "InstanceSet" }'); return }
    if (isBinding(v)) {
      if (!/^r\d+$/.test(v.ref)) err(`${at}.${key}.ref`, 'must be a cloud_call ref such as "r1"')
      if (v.path !== undefined) path(v as Obj, 'path', `${at}.${key}`)
      return
    }
    if (!Array.isArray(v) && !isObj(v)) err(`${at}.${key}`, 'must be an array, an object, or a binding { "ref", "path" }')
  }

  const items = (list: unknown, at: string, allowTabs: boolean): void => {
    if (!Array.isArray(list) || !list.length) {
      err(at, `required non-empty array of components (${(allowTabs ? NODE_KINDS : CONTENT_KINDS).join(', ')}), shown top to bottom`)
      return
    }
    list.forEach((n, i) => node(n, `${at}[${i}]`, allowTabs))
  }

  const node = (n: unknown, at: string, allowTabs: boolean): void => {
    if (!isObj(n)) { err(at, 'must be a component object with "kind"'); return }
    const kind = n.kind
    const allowed: readonly string[] = allowTabs ? NODE_KINDS : CONTENT_KINDS
    if (typeof kind !== 'string' || !allowed.includes(kind)) {
      const nested = kind === 'tabs' ? '; tabs cannot be nested' : ''
      err(`${at}.kind`, `unknown kind ${JSON.stringify(kind)}${nested}; use one of ${allowed.join(', ')}`)
      return
    }
    switch (kind) {
      case 'tabs':
        if (!Array.isArray(n.tabs) || !n.tabs.length) err(`${at}.tabs`, 'required non-empty array of { label, items }')
        else n.tabs.forEach((t, i) => {
          if (!isObj(t)) return err(`${at}.tabs[${i}]`, 'must be { label, items }')
          str(t, 'label', `${at}.tabs[${i}]`, true)
          items(t.items, `${at}.tabs[${i}].items`, false)
        })
        break
      case 'table':
        str(n, 'title', at)
        data(n, 'data', at)
        if (n.columns !== undefined) {
          if (!Array.isArray(n.columns) || !n.columns.length) err(`${at}.columns`, 'must be a non-empty array of { key, title?, format? }')
          else n.columns.forEach((c, i) => {
            if (!isObj(c)) return err(`${at}.columns[${i}]`, 'must be { key, title?, format? }')
            path(c, 'key', `${at}.columns[${i}]`, true)
            str(c, 'title', `${at}.columns[${i}]`)
            oneOf(c, 'format', FORMATS, `${at}.columns[${i}]`)
          })
        }
        break
      case 'kv':
        str(n, 'title', at)
        data(n, 'data', at)
        if (n.items !== undefined) {
          if (!Array.isArray(n.items)) err(`${at}.items`, 'must be an array of { path, label?, format? }')
          else n.items.forEach((it, i) => {
            if (!isObj(it)) return err(`${at}.items[${i}]`, 'must be { path, label?, format? }')
            path(it, 'path', `${at}.items[${i}]`, true)
            str(it, 'label', `${at}.items[${i}]`)
            oneOf(it, 'format', FORMATS, `${at}.items[${i}]`)
          })
        }
        break
      case 'stats':
        if (!Array.isArray(n.items) || !n.items.length) err(`${at}.items`, 'required non-empty array of { label, value }')
        else n.items.forEach((it, i) => {
          const p = `${at}.items[${i}]`
          if (!isObj(it)) return err(p, 'must be { label, value, unit?, format?, tone? }')
          str(it, 'label', p, true)
          const v = it.value
          if (isBinding(v)) {
            path(v as Obj, 'path', `${p}.value`)
            oneOf(v as Obj, 'agg', AGGREGATES, `${p}.value`)
          } else if (v !== null && !['string', 'number', 'boolean'].includes(typeof v)) {
            err(`${p}.value`, 'must be a scalar or a binding { ref, path, agg? }')
          }
          str(it, 'unit', p)
          oneOf(it, 'tone', TONES, p); oneOf(it, 'format', FORMATS, p)
        })
        break
      case 'chart':
        oneOf(n, 'chart', CHART_TYPES, at, true)
        str(n, 'title', at); str(n, 'unit', at)
        data(n, 'data', at)
        path(n, 'x', at); path(n, 'series', at)
        if (Array.isArray(n.y)) n.y.forEach((_, i) => path(n.y as unknown as Obj, String(i), `${at}.y`))
        else path(n, 'y', at)
        oneOf(n, 'format', FORMATS, at)
        break
    }
  }

  if (!isObj(input)) return ['view: must be an object { title?, items }']
  if (input.v !== undefined && input.v !== 1) err('view.v', 'only version 1 is supported')
  if (input.title !== undefined && typeof input.title !== 'string') err('view.title', 'must be a string')
  items(input.items, 'view.items', true)
  return errors
}
