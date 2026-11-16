import { ToolArgsError } from '@deepseek-ai/dsh-tools'
import { getPath } from '../core/json-path.js'
import { isBinding } from './validate.js'
import type {
  Aggregate, Binding, ChartNode, Column, CompiledChart, CompiledColumn, CompiledNode, CompiledView, DataSource,
  Format, JsonObject, JsonValue, StatItem, TreeNode, ViewNode, ViewRoot,
} from './spec.js'

export interface CompileOptions {
  /** Read a binding from the result cache; throws when the ref is gone. */
  resolve: (binding: Binding) => JsonValue | undefined
  maxRows?: number
  maxBytes?: number
}

export interface CompileResult {
  view: CompiledView
  /** One line per data node, for the model-facing summary. */
  summary: string[]
}

const DEFAULT_MAX_ROWS = 2000
const DEFAULT_MAX_BYTES = 1024 * 1024
const MAX_INFERRED_COLUMNS = 12
const MAX_TREE_NODES = 2000
const MAX_CELL_CHARS = 2000

class Compiler {
  truncated = false
  readonly summary: string[] = []

  constructor(private readonly resolve: CompileOptions['resolve'], private readonly maxRows: number) {}

  node(n: ViewNode, at: string): CompiledNode {
    switch (n.kind) {
      case 'group':
        return { kind: 'group', direction: n.direction ?? 'column', ...(n.columns ? { columns: n.columns } : {}), children: n.children.map((c, i) => this.node(c, `${at}.children[${i}]`)) }
      case 'tabs':
        return { kind: 'tabs', tabs: n.tabs.map((t, i) => ({ label: t.label, body: this.node(t.body, `${at}.tabs[${i}].body`) })) }
      case 'card':
        return { kind: 'card', ...opt('title', n.title), ...opt('subtitle', n.subtitle), body: this.node(n.body, `${at}.body`) }
      case 'table':
        return this.table(n, at)
      case 'kv':
        return this.kv(n, at)
      case 'stats':
        return { kind: 'stats', items: n.items.map((it, i) => this.stat(it, `${at}.items[${i}]`)) }
      case 'chart':
        return this.chart(n, at)
      case 'echarts':
        return this.echarts(n, at)
      case 'timeline': {
        const rows = this.rows(n.data, `${at}.data`)
        const kept = this.cap(rows)
        this.summary.push(`timeline${n.title ? ` "${n.title}"` : ''}: ${rows.length} events`)
        return {
          kind: 'timeline', ...opt('title', n.title), total: rows.length,
          items: kept.map((r) => ({
            time: scalar(getPath(r, n.time)),
            label: text(getPath(r, n.label)),
            ...(n.description ? { description: text(getPath(r, n.description)) } : {}),
            ...(n.tone ? { tone: text(getPath(r, n.tone)) } : {}),
          })),
        }
      }
      case 'tree': {
        const roots = this.data(n.data, `${at}.data`)
        const list = Array.isArray(roots) ? roots : [roots ?? null]
        let count = 0
        const walk = (items: JsonValue[], depth: number): TreeNode[] => {
          const out: TreeNode[] = []
          for (const item of items) {
            if (count >= MAX_TREE_NODES) { this.truncated = true; break }
            count++
            const kids = getPath(item, n.children ?? 'children')
            out.push({
              label: text(getPath(item, n.label)),
              ...(n.value ? { value: text(getPath(item, n.value)) } : {}),
              ...(Array.isArray(kids) && kids.length && depth < 8 ? { children: walk(kids, depth + 1) } : {}),
            })
          }
          return out
        }
        const nodes = walk(list, 0)
        this.summary.push(`tree${n.title ? ` "${n.title}"` : ''}: ${count} nodes`)
        return { kind: 'tree', ...opt('title', n.title), nodes, total: count }
      }
      case 'markdown':
        return { kind: 'markdown', text: n.text }
      case 'alert':
        return { kind: 'alert', tone: n.tone ?? 'info', ...opt('title', n.title), text: n.text }
      case 'json': {
        const value = this.data(n.data, `${at}.data`) ?? null
        this.summary.push(`json${n.title ? ` "${n.title}"` : ''}`)
        return { kind: 'json', ...opt('title', n.title), data: value }
      }
    }
  }

  private data(source: DataSource, at: string): JsonValue | undefined {
    if (!isBinding(source)) return source as JsonValue
    const value = this.resolve(source)
    if (value === undefined) {
      throw new ToolArgsError([`${at}: path "${source.path ?? ''}" not found in ${source.ref}; check the field names with cloud_result ref="${source.ref}"`])
    }
    return value
  }

  private rows(source: DataSource, at: string): JsonValue[] {
    const value = this.data(source, at)
    if (Array.isArray(value)) return value
    const entries = mapRows(value)
    if (entries) return entries
    const where = isBinding(source) ? `${source.ref}${source.path ? ` path "${source.path}"` : ''}` : 'inline data'
    const hint = value && typeof value === 'object' ? `; it is an object with keys ${Object.keys(value).slice(0, 12).join(', ')}` : ''
    throw new ToolArgsError([`${at}: needs an array but ${where} is ${value === null ? 'null' : typeof value}${hint}`])
  }

  private cap<T>(rows: T[]): T[] {
    if (rows.length <= this.maxRows) return rows
    this.truncated = true
    return rows.slice(0, this.maxRows)
  }

  private table(n: Extract<ViewNode, { kind: 'table' }>, at: string): CompiledNode {
    const rows = this.rows(n.data, `${at}.data`)
    const columns: CompiledColumn[] = (n.columns ?? inferColumns(rows)).map((c: Column) => ({
      key: c.key, title: c.title ?? c.key, ...(c.format ? { format: c.format } : {}), ...(c.width ? { width: c.width } : {}),
    }))
    const kept = this.cap(rows)
    const cells = kept.map((r) => columns.map((c) => cell(getPath(r, c.key))))
    this.summary.push(`table${n.title ? ` "${n.title}"` : ''}: ${rows.length} rows × ${columns.length} columns (${columns.map((c) => c.key).join(', ')})`)
    return { kind: 'table', ...opt('title', n.title), columns, rows: cells, total: rows.length, pageSize: n.pageSize ?? 20 }
  }

  private kv(n: Extract<ViewNode, { kind: 'kv' }>, at: string): CompiledNode {
    let value = this.data(n.data, `${at}.data`)
    if (Array.isArray(value) && value.length === 1) value = value[0]!
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new ToolArgsError([`${at}.data: kv needs an object (or a one-item array)`])
    }
    const items: { label?: string; path: string; format?: Format }[] = n.items
      ?? Object.keys(value).filter((k) => isScalar(value[k])).slice(0, 40).map((k) => ({ path: k, ...(guessFormat(k) ? { format: guessFormat(k) } : {}) }))
    this.summary.push(`kv${n.title ? ` "${n.title}"` : ''}: ${items.length} fields`)
    return {
      kind: 'kv', ...opt('title', n.title), ...(n.columns ? { columns: n.columns } : {}),
      items: items.map((it) => ({ label: it.label ?? it.path, value: cell(getPath(value, it.path)), ...(it.format ? { format: it.format } : {}) })),
    }
  }

  private stat(it: StatItem, at: string) {
    let value: JsonValue
    if (isBinding(it.value)) {
      const b = it.value
      const raw = this.data({ ref: b.ref, ...(b.path ? { path: b.path } : {}) }, `${at}.value`)
      value = Array.isArray(raw) ? aggregate(raw, b.agg ?? 'count') : raw && typeof raw === 'object' ? Object.keys(raw).length : raw ?? null
    } else {
      value = it.value
    }
    return { label: it.label, value, ...opt('unit', it.unit), ...opt('format', it.format), ...opt('tone', it.tone), ...opt('hint', it.hint) }
  }

  private chart(n: ChartNode, at: string): CompiledChart {
    const base = {
      kind: 'chart' as const, chart: n.chart, ...opt('title', n.title), ...(n.stack ? { stack: true } : {}),
      ...opt('unit', n.unit), ...opt('format', n.format), ...opt('xFormat', n.xFormat), ...(n.height ? { height: n.height } : {}),
    }
    const raw = this.data(n.data, `${at}.data`)
    const ys = n.y === undefined ? [] : Array.isArray(n.y) ? n.y : [n.y]
    const label = `chart ${n.chart}${n.title ? ` "${n.title}"` : ''}`

    if (n.chart === 'gauge') {
      const v = ys[0] ? getPath(raw ?? null, ys[0]) : raw
      const num = toNumber(Array.isArray(v) ? v[0] : v) ?? 0
      this.summary.push(`${label}: ${num}`)
      return { ...base, series: [], gauge: { value: num, max: n.max ?? (n.format === 'percent' ? 100 : Math.max(100, num)) } }
    }

    // Column mode: data is an object holding parallel arrays.
    if (raw && typeof raw === 'object' && !Array.isArray(raw) && !mapRows(raw)) {
      const xs = n.x ? getPath(raw, n.x) : undefined
      if (!Array.isArray(xs)) throw new ToolArgsError([`${at}: data is an object, so x must point to an array inside it`])
      const series = ys.map((y) => {
        const values = getPath(raw, y)
        if (!Array.isArray(values)) throw new ToolArgsError([`${at}.y: "${y}" is not an array in the data object`])
        return { name: y, data: values.map(toNumber) }
      })
      return this.finishCategorical(base, xs, series, label)
    }

    const rows = this.rows(n.data, `${at}.data`)

    if (n.chart === 'pie' || n.chart === 'donut') {
      const groups = new Map<string, JsonValue[]>()
      for (const r of rows) {
        const name = text(n.x ? getPath(r, n.x) : r)
        const bucket = groups.get(name) ?? []
        bucket.push(ys[0] ? getPath(r, ys[0]) ?? null : r)
        groups.set(name, bucket)
      }
      const agg = n.agg ?? (ys[0] ? 'sum' : 'count')
      const slices = [...groups].map(([name, vals]) => ({ name, value: toNumber(aggregate(vals, agg)) ?? 0 }))
      this.summary.push(`${label}: ${slices.length} slices`)
      return { ...base, series: [], slices: slices.slice(0, 200) }
    }

    if (n.chart === 'scatter') {
      const groups = new Map<string, [number, number][]>()
      for (const r of this.cap(rows)) {
        const x = toNumber(getPath(r, n.x!)); const y = toNumber(getPath(r, ys[0]!))
        if (x === null || y === null) continue
        const name = n.series ? text(getPath(r, n.series)) : ys[0]!
        groups.set(name, [...(groups.get(name) ?? []), [x, y]])
      }
      this.summary.push(`${label}: ${rows.length} points`)
      return { ...base, series: [], points: [...groups].map(([name, data]) => ({ name, data })) }
    }

    if (n.chart === 'heatmap') {
      const xCats: JsonValue[] = []; const yCats: JsonValue[] = []
      const cells: [number, number, number][] = []
      for (const r of this.cap(rows)) {
        const xv = scalar(getPath(r, n.x!)); const yv = scalar(getPath(r, ys[0]!))
        const v = toNumber(n.value ? getPath(r, n.value) : 1)
        let xi = xCats.indexOf(xv); if (xi < 0) xi = xCats.push(xv) - 1
        let yi = yCats.indexOf(yv); if (yi < 0) yi = yCats.push(yv) - 1
        if (v !== null) cells.push([xi, yi, v])
      }
      this.summary.push(`${label}: ${xCats.length}×${yCats.length} cells`)
      return { ...base, series: [], categories: xCats, yCategories: yCats, cells }
    }

    // Row-series mode: each row carries its own x and y arrays (e.g. monitor DataPoints).
    const firstX = rows.length && n.x ? getPath(rows[0], n.x) : undefined
    if (Array.isArray(firstX) && ys[0]) {
      const xSet = new Map<string, JsonValue>()
      const perRow = rows.slice(0, 50).map((r, i) => {
        const xs = (getPath(r, n.x!) as JsonValue[] | undefined) ?? []
        const vs = (getPath(r, ys[0]!) as JsonValue[] | undefined) ?? []
        const map = new Map<string, number | null>()
        xs.forEach((x, j) => { const k = JSON.stringify(x); xSet.set(k, x); map.set(k, toNumber(vs[j])) })
        return { name: n.series ? text(getPath(r, n.series)) : `${ys[0]} #${i + 1}`, map }
      })
      const categories = sortCategories([...xSet.values()])
      const series = perRow.map(({ name, map }) => ({ name, data: categories.map((c) => map.get(JSON.stringify(c)) ?? null) }))
      return this.finishCategorical(base, categories, series, label)
    }

    // Row mode: one category per distinct x; one series per y path or per `series` group.
    const kept = this.cap(rows)
    const xKey = (r: JsonValue) => scalar(n.x ? getPath(r, n.x) : null)
    const categories: JsonValue[] = []
    const catIndex = new Map<string, number>()
    for (const r of kept) {
      const k = JSON.stringify(xKey(r))
      if (!catIndex.has(k)) { catIndex.set(k, categories.length); categories.push(xKey(r)) }
    }
    const agg = n.agg ?? (ys.length ? 'sum' : 'count')
    const buckets = new Map<string, JsonValue[][]>()
    const push = (name: string, idx: number, v: JsonValue) => {
      let b = buckets.get(name)
      if (!b) { b = categories.map(() => []); buckets.set(name, b) }
      b[idx]!.push(v)
    }
    for (const r of kept) {
      const idx = catIndex.get(JSON.stringify(xKey(r)))!
      if (n.series) {
        push(text(getPath(r, n.series)), idx, ys[0] ? getPath(r, ys[0]) ?? null : 1)
      } else if (ys.length) {
        for (const y of ys) push(y, idx, getPath(r, y) ?? null)
      } else {
        push('count', idx, 1)
      }
    }
    const series = [...buckets].map(([name, b]) => ({ name, data: b.map((vals) => (vals.length ? toNumber(aggregate(vals, agg)) : null)) }))
    return this.finishCategorical(base, categories, series, label)
  }

  private finishCategorical(base: Omit<CompiledChart, 'series'>, categories: JsonValue[], series: { name: string; data: (number | null)[] }[], label: string): CompiledChart {
    let cats = categories
    let ser = series.slice(0, 50)
    if (cats.length > this.maxRows) {
      this.truncated = true
      cats = cats.slice(-this.maxRows)
      ser = ser.map((s) => ({ ...s, data: s.data.slice(-this.maxRows) }))
    }
    this.summary.push(`${label}: ${ser.length} series × ${cats.length} points (${ser.map((s) => s.name).slice(0, 6).join(', ')})`)
    return { ...base, categories: cats, series: ser, ...(categories.length > cats.length ? { truncated: categories.length - cats.length } : {}) }
  }

  private echarts(n: Extract<ViewNode, { kind: 'echarts' }>, at: string): CompiledNode {
    const option = sanitizeOption(n.option) as JsonObject
    if (n.data) {
      const datasets: JsonValue[] = Array.isArray(option.dataset) ? [...option.dataset] : option.dataset ? [option.dataset] : []
      for (const [id, source] of Object.entries(n.data)) {
        const value = this.data(source, `${at}.data.${id}`)
        datasets.push({ id, source: Array.isArray(value) ? this.cap(value) : value ?? [] })
      }
      option.dataset = datasets
    }
    this.summary.push(`echarts${n.title ? ` "${n.title}"` : ''}`)
    return { kind: 'echarts', ...opt('title', n.title), option, ...(n.height ? { height: n.height } : {}) }
  }
}

/** A map of objects (e.g. a multi-region result) becomes one row per entry: { key, ...value }. */
function mapRows(value: JsonValue | undefined): JsonValue[] | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const entries = Object.entries(value)
  if (!entries.length || !entries.every(([, v]) => v && typeof v === 'object' && !Array.isArray(v))) return undefined
  return entries.map(([key, v]) => ({ key, ...(v as JsonObject) }))
}

function opt<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return (value === undefined ? {} : { [key]: value }) as { [P in K]?: V }
}

function isScalar(v: unknown): boolean {
  return v === null || ['string', 'number', 'boolean'].includes(typeof v)
}

function scalar(v: JsonValue | undefined): JsonValue {
  if (v === undefined) return null
  return isScalar(v) ? v : JSON.stringify(v)
}

function text(v: JsonValue | undefined): string {
  if (v === undefined || v === null) return ''
  return typeof v === 'string' ? v : isScalar(v) ? String(v) : JSON.stringify(v)
}

/** Table/kv cell: scalars as is, short arrays of scalars joined, other structures as compact JSON. */
function cell(v: JsonValue | undefined): JsonValue {
  if (v === undefined) return null
  if (typeof v === 'string') return v.length > MAX_CELL_CHARS ? `${v.slice(0, MAX_CELL_CHARS)}…` : v
  if (isScalar(v)) return v
  if (Array.isArray(v) && v.every(isScalar)) return v.length <= 20 ? v : [...v.slice(0, 20), `…+${v.length - 20}`]
  const json = JSON.stringify(v)
  return json.length > MAX_CELL_CHARS ? `${json.slice(0, MAX_CELL_CHARS)}…` : v
}

export function toNumber(v: JsonValue | undefined): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  return null
}

export function aggregate(values: JsonValue[], agg: Aggregate): JsonValue {
  if (agg === 'count') return values.length
  if (agg === 'first') return values[0] ?? null
  const nums = values.map(toNumber).filter((n): n is number => n !== null)
  if (!nums.length) return null
  switch (agg) {
    case 'sum': return round(nums.reduce((a, b) => a + b, 0))
    case 'avg': return round(nums.reduce((a, b) => a + b, 0) / nums.length)
    case 'min': return Math.min(...nums)
    case 'max': return Math.max(...nums)
  }
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6
}

function sortCategories(values: JsonValue[]): JsonValue[] {
  return values.every((v) => typeof v === 'number') ? [...values].sort((a, b) => (a as number) - (b as number)) : values
}

/** Up to 12 scalar columns, top-level first, then one level into objects (e.g. Placement.Zone). */
export function inferColumns(rows: JsonValue[]): Column[] {
  const keys: string[] = []
  const add = (k: string) => { if (!keys.includes(k) && keys.length < MAX_INFERRED_COLUMNS) keys.push(k) }
  const sample = rows.slice(0, 50).filter((r): r is JsonObject => !!r && typeof r === 'object' && !Array.isArray(r))
  if (!sample.length) return [{ key: '', title: 'value' }]
  const filled = (k: string) => sample.some((r) => { const v = getPath(r, k); return v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length) })
  const consider = (k: string) => { if (!keys.includes(k) && filled(k)) add(k) }
  for (const r of sample) for (const [k, v] of Object.entries(r)) if (isScalar(v) || (Array.isArray(v) && v.every(isScalar))) consider(k)
  for (const r of sample) for (const [k, v] of Object.entries(r)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) for (const [k2, v2] of Object.entries(v)) if (isScalar(v2)) consider(`${k}.${k2}`)
  }
  return keys.map((key) => ({ key, ...(guessFormat(key) ? { format: guessFormat(key) } : {}) }))
}

function guessFormat(key: string): Format | undefined {
  if (/(Status|State)$/.test(key)) return 'status'
  if (/(Time|Date|At)$/.test(key)) return 'datetime'
  return undefined
}

const UNSAFE_STRING = /^\s*image:\/\/|url\s*\(|javascript:/i

/** Drop external resource references and non-JSON content from a passthrough ECharts option. */
export function sanitizeOption(value: JsonValue, depth = 0): JsonValue {
  if (depth > 20) return null
  if (typeof value === 'string') return UNSAFE_STRING.test(value) ? '' : value
  if (Array.isArray(value)) return value.map((v) => sanitizeOption(v, depth + 1))
  if (value && typeof value === 'object') {
    const out: JsonObject = {}
    for (const [k, v] of Object.entries(value)) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue
      out[k] = sanitizeOption(v, depth + 1)
    }
    return out
  }
  return value
}

/**
 * Validate-then-compile entry: bind data, shape it per component and keep the
 * serialized view under `maxBytes` by shrinking the row cap.
 */
export function compileView(root: ViewRoot, options: CompileOptions): CompileResult {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  let maxRows = options.maxRows ?? DEFAULT_MAX_ROWS
  for (;;) {
    const compiler = new Compiler(options.resolve, maxRows)
    const body = compiler.node(root.body, 'view.body')
    const view: CompiledView = { v: 1, ...(root.title ? { title: root.title } : {}), body }
    if (compiler.truncated) view.truncated = true
    const size = JSON.stringify(view).length
    if (size <= maxBytes || maxRows <= 10) {
      if (size > maxBytes) throw new ToolArgsError([`view is ${(size / 1024).toFixed(0)}KB after shrinking; select fewer columns or rows`])
      return { view, summary: compiler.summary }
    }
    maxRows = Math.max(10, Math.floor(maxRows / 2))
  }
}
