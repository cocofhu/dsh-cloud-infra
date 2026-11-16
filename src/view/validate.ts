import { parsePath } from '../core/json-path.js'
import { AGGREGATES, CHART_TYPES, FORMATS, MAX_VIEW_DEPTH, NODE_KINDS, TONES, type ViewRoot } from './spec.js'

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

  const node = (n: unknown, at: string, depth: number): void => {
    if (depth > MAX_VIEW_DEPTH) { err(at, `nesting deeper than ${MAX_VIEW_DEPTH} levels`); return }
    if (!isObj(n)) { err(at, 'must be a view node object with "kind"'); return }
    const kind = n.kind
    if (typeof kind !== 'string' || !(NODE_KINDS as readonly string[]).includes(kind)) {
      err(`${at}.kind`, `unknown kind ${JSON.stringify(kind)}; use one of ${NODE_KINDS.join(', ')}`)
      return
    }
    switch (kind) {
      case 'group':
        oneOf(n, 'direction', ['row', 'column'], at)
        num(n, 'columns', at, 1, 6)
        if (!Array.isArray(n.children) || !n.children.length) err(`${at}.children`, 'required non-empty array of nodes')
        else n.children.forEach((c, i) => node(c, `${at}.children[${i}]`, depth + 1))
        break
      case 'tabs':
        if (!Array.isArray(n.tabs) || !n.tabs.length) err(`${at}.tabs`, 'required non-empty array of { label, body }')
        else n.tabs.forEach((t, i) => {
          if (!isObj(t)) return err(`${at}.tabs[${i}]`, 'must be { label, body }')
          str(t, 'label', `${at}.tabs[${i}]`, true)
          node(t.body, `${at}.tabs[${i}].body`, depth + 1)
        })
        break
      case 'card':
        str(n, 'title', at); str(n, 'subtitle', at)
        node(n.body, `${at}.body`, depth + 1)
        break
      case 'table':
        str(n, 'title', at)
        data(n, 'data', at)
        num(n, 'pageSize', at, 5, 200)
        if (n.columns !== undefined) {
          if (!Array.isArray(n.columns) || !n.columns.length) err(`${at}.columns`, 'must be a non-empty array of { key, title?, format? }')
          else n.columns.forEach((c, i) => {
            if (!isObj(c)) return err(`${at}.columns[${i}]`, 'must be { key, title?, format? }')
            path(c, 'key', `${at}.columns[${i}]`, true)
            str(c, 'title', `${at}.columns[${i}]`)
            oneOf(c, 'format', FORMATS, `${at}.columns[${i}]`)
            num(c, 'width', `${at}.columns[${i}]`, 20, 800)
          })
        }
        break
      case 'kv':
        str(n, 'title', at)
        data(n, 'data', at)
        num(n, 'columns', at, 1, 4)
        if (n.items !== undefined) {
          if (!Array.isArray(n.items)) err(`${at}.items`, 'must be an array of { label?, path, format? }')
          else n.items.forEach((it, i) => {
            if (!isObj(it)) return err(`${at}.items[${i}]`, 'must be { label?, path, format? }')
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
          if (!isObj(it)) return err(p, 'must be { label, value, unit?, tone? }')
          str(it, 'label', p, true)
          const v = it.value
          if (isBinding(v)) {
            path(v as Obj, 'path', `${p}.value`)
            oneOf(v as Obj, 'agg', AGGREGATES, `${p}.value`)
          } else if (v !== null && !['string', 'number', 'boolean'].includes(typeof v)) {
            err(`${p}.value`, 'must be a scalar or a binding { ref, path, agg? }')
          }
          str(it, 'unit', p); str(it, 'hint', p)
          oneOf(it, 'tone', TONES, p); oneOf(it, 'format', FORMATS, p)
        })
        break
      case 'chart':
        oneOf(n, 'chart', CHART_TYPES, at, true)
        str(n, 'title', at)
        data(n, 'data', at)
        path(n, 'x', at); path(n, 'series', at); path(n, 'value', at)
        if (Array.isArray(n.y)) n.y.forEach((_, i) => path(n.y as unknown as Obj, String(i), `${at}.y`))
        else path(n, 'y', at)
        oneOf(n, 'agg', AGGREGATES, at)
        oneOf(n, 'format', FORMATS, at); oneOf(n, 'xFormat', FORMATS, at)
        num(n, 'height', at, 120, 900)
        num(n, 'max', at)
        if (n.chart === 'heatmap' && (n.x === undefined || n.y === undefined)) err(at, 'heatmap needs x, y (category paths) and value')
        if (n.chart === 'scatter' && (n.x === undefined || n.y === undefined)) err(at, 'scatter needs numeric x and y paths')
        break
      case 'echarts':
        str(n, 'title', at)
        if (!isObj(n.option)) err(`${at}.option`, 'required ECharts option object')
        num(n, 'height', at, 120, 900)
        if (n.data !== undefined) {
          if (!isObj(n.data)) err(`${at}.data`, 'must map dataset ids to data sources')
          else for (const k of Object.keys(n.data)) data(n.data, k, `${at}.data`)
        }
        break
      case 'timeline':
        str(n, 'title', at)
        data(n, 'data', at)
        path(n, 'time', at, true); path(n, 'label', at, true); path(n, 'description', at); path(n, 'tone', at)
        break
      case 'tree':
        str(n, 'title', at)
        data(n, 'data', at)
        path(n, 'label', at, true); path(n, 'children', at); path(n, 'value', at)
        break
      case 'markdown':
        str(n, 'text', at, true)
        break
      case 'alert':
        str(n, 'text', at, true); str(n, 'title', at)
        oneOf(n, 'tone', TONES, at)
        break
      case 'json':
        str(n, 'title', at)
        data(n, 'data', at)
        break
    }
  }

  if (!isObj(input)) return ['view: must be an object { v: 1, title?, body }']
  const root = input as Partial<ViewRoot> & Obj
  if (root.v !== undefined && root.v !== 1) err('view.v', 'only version 1 is supported')
  if (root.title !== undefined && typeof root.title !== 'string') err('view.title', 'must be a string')
  node(root.body, 'view.body', 1)
  return errors
}
