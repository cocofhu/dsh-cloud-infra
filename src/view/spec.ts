/**
 * Cloud View: the declarative view protocol shared by the host and the client.
 *
 * The model writes a `ViewRoot` (data inline or bound to cached results by ref);
 * the host validates and compiles it into a self-contained `CompiledView`, which
 * is persisted in the tool result's presentation metadata and rendered by the client.
 * This module must stay free of Node and React imports.
 */

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }
export type JsonObject = { [key: string]: JsonValue }

export const VIEW_VERSION = 1

export const TONES = ['neutral', 'info', 'success', 'warning', 'danger'] as const
export type Tone = (typeof TONES)[number]

export const FORMATS = ['number', 'percent', 'bytes', 'datetime', 'status'] as const
export type Format = (typeof FORMATS)[number]

export const CHART_TYPES = ['line', 'bar', 'pie'] as const
export type ChartType = (typeof CHART_TYPES)[number]

export const AGGREGATES = ['count', 'sum'] as const
export type Aggregate = (typeof AGGREGATES)[number]

/** Points into a cached `cloud_call` result. */
export interface Binding { ref: string; path?: string }
export type DataSource = JsonValue[] | JsonObject | Binding

export interface Column { key: string; title?: string; format?: Format }

// ---- authored spec (what the model writes) ----

/** The four content components; a view stacks them top to bottom, optionally inside tabs. */
export type ContentNode =
  | { kind: 'stats'; items: StatItem[] }
  | { kind: 'table'; title?: string; data: DataSource; columns?: Column[] }
  | ChartNode
  | { kind: 'kv'; title?: string; data: DataSource; items?: { path: string; label?: string; format?: Format }[] }

export type ViewNode = ContentNode | { kind: 'tabs'; tabs: { label: string; items: ContentNode[] }[] }

export interface StatItem {
  label: string
  value: JsonPrimitive | (Binding & { agg?: Aggregate })
  unit?: string
  format?: Format
  tone?: Tone
}

export interface ChartNode {
  kind: 'chart'
  chart: ChartType
  title?: string
  data: DataSource
  /** Category / time path. Row mode: relative to each row. Column mode: an array path. */
  x?: string
  /** Value path(s), summed per x. Omitted = count rows per x. */
  y?: string | string[]
  /** Split rows into one series per value of this path (row mode), or name each row-series. */
  series?: string
  unit?: string
  format?: Format
}

export interface ViewRoot { v: 1; title?: string; items: ViewNode[] }

// ---- compiled view (what the client renders) ----

export interface CompiledColumn { key: string; title: string; format?: Format }

export interface CompiledSeries { name: string; data: (number | null)[] }

export type CompiledNode =
  /** Internal vertical stack: the view root and each tab body. */
  | { kind: 'group'; children: CompiledNode[] }
  | { kind: 'tabs'; tabs: { label: string; body: CompiledNode }[] }
  | { kind: 'table'; title?: string; columns: CompiledColumn[]; rows: JsonValue[][]; total: number; pageSize: number }
  | { kind: 'kv'; title?: string; items: { label: string; value: JsonValue; format?: Format }[] }
  | { kind: 'stats'; items: { label: string; value: JsonValue; unit?: string; format?: Format; tone?: Tone }[] }
  | CompiledChart

export interface CompiledChart {
  kind: 'chart'
  chart: ChartType
  title?: string
  /** Category axis for line/bar. */
  categories?: JsonValue[]
  series: CompiledSeries[]
  /** pie slices. */
  slices?: { name: string; value: number }[]
  unit?: string
  format?: Format
  /** Inferred from the x path or values; formats the category axis. */
  xFormat?: Format
  /** Rows dropped by the size limits. */
  truncated?: number
}

export interface CompiledView {
  v: 1
  title?: string
  body: CompiledNode
  /** True when any data source was cut by the size limits. */
  truncated?: boolean
}

export const CONTENT_KINDS = ['stats', 'table', 'chart', 'kv'] as const
export const NODE_KINDS = [...CONTENT_KINDS, 'tabs'] as const
export type NodeKind = (typeof NODE_KINDS)[number]

/** Generic status words → tone; shared so host summaries and client badges agree. */
export function statusTone(value: unknown): Tone {
  const s = String(value ?? '').toLowerCase()
  if (!s) return 'neutral'
  if (/^(running|normal|available|active|online|success(ful)?|succeeded|ok|healthy|enabled?|bound|in_?use|up|pass(ed)?|ready|completed?|true)$/.test(s)) return 'success'
  if (/(fail|error|abnormal|unhealthy|offline|down|denied|expired|isolated|broken|false$)/.test(s)) return 'danger'
  if (/(pending|starting|stopping|creating|rebooting|launching|processing|progress|updating|deleting|isolating|terminating|shutdown|warn|wait|init)/.test(s)) return 'warning'
  if (/(stopped|terminated|disabled|inactive|closed|unbound|released|deleted)/.test(s)) return 'neutral'
  return 'info'
}
