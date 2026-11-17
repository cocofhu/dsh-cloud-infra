import { ToolArgsError } from '@deepseek-ai/dsh-tools'
import { getPath } from '../core/json-path.js'
import { isBinding } from './validate.js'
import type {
  Aggregate, Binding, ChartNode, Column, CompiledChart, CompiledColumn, CompiledNode, CompiledView, ContentNode, DataSource,
  Format, JsonObject, JsonValue, StatItem, ViewNode, ViewRoot,
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
const PAGE_SIZE = 10
const MAX_CELL_CHARS = 2000

class Compiler {
  truncated = false
  readonly summary: string[] = []

  constructor(private readonly resolve: CompileOptions['resolve'], private readonly maxRows: number) {}

  stack(items: ViewNode[], at: string): CompiledNode {
    return { kind: 'group', children: items.map((n, i) => this.node(n, `${at}[${i}]`)) }
  }

  node(n: ViewNode, at: string): CompiledNode {
    switch (n.kind) {
      case 'tabs':
        return { kind: 'tabs', tabs: n.tabs.map((t, i) => ({ label: t.label, body: this.stack(t.items, `${at}.tabs[${i}].items`) })) }
      case 'table':
        return this.table(n, at)
      case 'kv':
        return this.kv(n, at)
      case 'stats':
        return { kind: 'stats', items: n.items.map((it, i) => this.stat(it, `${at}.items[${i}]`)) }
      case 'chart':
        return this.chart(n, at)
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

  private table(n: Extract<ContentNode, { kind: 'table' }>, at: string): CompiledNode {
    const rows = this.rows(n.data, `${at}.data`)
    const columns: CompiledColumn[] = (n.columns ?? inferColumns(rows)).map((c: Column) => ({
      key: c.key, title: c.title ?? c.key, ...(c.format ? { format: c.format } : {}),
    }))
    const kept = this.cap(rows)
    const cells = kept.map((r) => columns.map((c) => cell(getPath(r, c.key))))
    this.summary.push(`table${n.title ? ` "${n.title}"` : ''}: ${rows.length} rows × ${columns.length} columns (${columns.map((c) => c.key).join(', ')})`)
    return { kind: 'table', ...opt('title', n.title), columns, rows: cells, total: rows.length, pageSize: PAGE_SIZE }
  }

  private kv(n: Extract<ContentNode, { kind: 'kv' }>, at: string): CompiledNode {
    let value = this.data(n.data, `${at}.data`)
    if (Array.isArray(value) && value.length === 1) value = value[0]!
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new ToolArgsError([`${at}.data: kv needs an object (or a one-item array)`])
    }
    const items: { label?: string; path: string; format?: Format }[] = n.items
      ?? Object.keys(value).filter((k) => isScalar(value[k])).slice(0, 40).map((k) => ({ path: k, ...(guessFormat(k) ? { format: guessFormat(k) } : {}) }))
    this.summary.push(`kv${n.title ? ` "${n.title}"` : ''}: ${items.length} fields`)
    return {
      kind: 'kv', ...opt('title', n.title),
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
    return { label: it.label, value, ...opt('unit', it.unit), ...opt('format', it.format), ...opt('tone', it.tone) }
  }

  private chart(n: ChartNode, at: string): CompiledChart {
    const base = { kind: 'chart' as const, chart: n.chart, ...opt('title', n.title), ...opt('unit', n.unit), ...opt('format', n.format) }
    const raw = this.data(n.data, `${at}.data`)
    const ys = n.y === undefined ? [] : Array.isArray(n.y) ? n.y : [n.y]
    const label = `chart ${n.chart}${n.title ? ` "${n.title}"` : ''}`

    // Column mode: data is an object holding parallel arrays.
    if (raw && typeof raw === 'object' && !Array.isArray(raw) && !mapRows(raw)) {
      const xs = n.x ? getPath(raw, n.x) : undefined
      if (!Array.isArray(xs)) throw new ToolArgsError([`${at}: data is an object, so x must point to an array inside it`])
      const series = ys.map((y) => {
        const values = getPath(raw, y)
        if (!Array.isArray(values)) throw new ToolArgsError([`${at}.y: "${y}" is not an array in the data object`])
        return { name: y, data: values.map(toNumber) }
      })
      return this.finishCategorical(base, xs, series, label, n.x)
    }

    const rows = this.rows(n.data, `${at}.data`)

    if (n.chart === 'pie') {
      const groups = new Map<string, JsonValue[]>()
      for (const r of rows) {
        const name = text(n.x ? getPath(r, n.x) : r)
        const bucket = groups.get(name) ?? []
        bucket.push(ys[0] ? getPath(r, ys[0]) ?? null : r)
        groups.set(name, bucket)
      }
      const agg: Aggregate = ys[0] ? 'sum' : 'count'
      const slices = [...groups].map(([name, vals]) => ({ name, value: toNumber(aggregate(vals, agg)) ?? 0 }))
      this.summary.push(`${label}: ${slices.length} slices`)
      return { ...base, series: [], slices: slices.slice(0, 200) }
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
      return this.finishCategorical(base, categories, series, label, n.x)
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
    const agg: Aggregate = ys.length ? 'sum' : 'count'
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
    return this.finishCategorical(base, categories, series, label, n.x)
  }

  private finishCategorical(base: Omit<CompiledChart, 'series'>, categories: JsonValue[], series: { name: string; data: (number | null)[] }[], label: string, x?: string): CompiledChart {
    let cats = categories
    let ser = series.slice(0, 50)
    if (cats.length > this.maxRows) {
      this.truncated = true
      cats = cats.slice(-this.maxRows)
      ser = ser.map((s) => ({ ...s, data: s.data.slice(-this.maxRows) }))
    }
    this.summary.push(`${label}: ${ser.length} series × ${cats.length} points (${ser.map((s) => s.name).slice(0, 6).join(', ')})`)
    const time = x !== undefined && TIME_KEY.test(x) && cats.length > 0 && cats.every(looksLikeTime)
    return { ...base, ...(time ? { xFormat: 'datetime' as const } : {}), categories: cats, series: ser, ...(categories.length > cats.length ? { truncated: categories.length - cats.length } : {}) }
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

function toNumber(v: JsonValue | undefined): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  return null
}

export function aggregate(values: JsonValue[], agg: Aggregate): JsonValue {
  if (agg === 'count') return values.length
  const nums = values.map(toNumber).filter((n): n is number => n !== null)
  return nums.length ? round(nums.reduce((a, b) => a + b, 0)) : null
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

const TIME_KEY = /(time|date|timestamps?|At)$/i

function looksLikeTime(v: JsonValue): boolean {
  if (typeof v === 'number') return v >= 1e9
  return typeof v === 'string' && (/^\d{4}-\d{2}-\d{2}/.test(v) || /^\d{10,13}$/.test(v))
}

function guessFormat(key: string): Format | undefined {
  if (/(Status|State)$/.test(key)) return 'status'
  if (/(Time|Date|At)$/.test(key)) return 'datetime'
  return undefined
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
    const body = compiler.stack(root.items, 'view.items')
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
