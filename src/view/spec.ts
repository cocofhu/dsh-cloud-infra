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
export const MAX_VIEW_DEPTH = 6

export const TONES = ['neutral', 'info', 'success', 'warning', 'danger'] as const
export type Tone = (typeof TONES)[number]

export const FORMATS = ['text', 'number', 'percent', 'bytes', 'currency', 'datetime', 'duration', 'status', 'tag', 'code', 'link'] as const
export type Format = (typeof FORMATS)[number]

export const CHART_TYPES = ['line', 'area', 'bar', 'hbar', 'pie', 'donut', 'scatter', 'heatmap', 'gauge'] as const
export type ChartType = (typeof CHART_TYPES)[number]

export const AGGREGATES = ['count', 'sum', 'avg', 'min', 'max', 'first'] as const
export type Aggregate = (typeof AGGREGATES)[number]

/** Points into a cached `cloud_call` result. */
export interface Binding { ref: string; path?: string }
export type DataSource = JsonValue[] | JsonObject | Binding

export interface Column { key: string; title?: string; format?: Format; width?: number }

// ---- authored spec (what the model writes) ----

export type ViewNode =
  | { kind: 'group'; direction?: 'row' | 'column'; columns?: number; children: ViewNode[] }
  | { kind: 'tabs'; tabs: { label: string; body: ViewNode }[] }
  | { kind: 'card'; title?: string; subtitle?: string; body: ViewNode }
  | { kind: 'table'; title?: string; data: DataSource; columns?: Column[]; pageSize?: number }
  | { kind: 'kv'; title?: string; data: DataSource; items?: { label?: string; path: string; format?: Format }[]; columns?: number }
  | { kind: 'stats'; items: StatItem[] }
  | ChartNode
  | { kind: 'echarts'; title?: string; option: JsonObject; data?: Record<string, DataSource>; height?: number }
  | { kind: 'timeline'; title?: string; data: DataSource; time: string; label: string; description?: string; tone?: string }
  | { kind: 'tree'; title?: string; data: DataSource; label: string; children?: string; value?: string }
  | { kind: 'markdown'; text: string }
  | { kind: 'alert'; tone?: Tone; title?: string; text: string }
  | { kind: 'json'; title?: string; data: DataSource }

export interface StatItem {
  label: string
  value: JsonPrimitive | (Binding & { agg?: Aggregate })
  unit?: string
  format?: Format
  tone?: Tone
  hint?: string
}

export interface ChartNode {
  kind: 'chart'
  chart: ChartType
  title?: string
  data: DataSource
  /** Category / time path. Row mode: relative to each row. Column mode: an array path. */
  x?: string
  /** Value path(s). Omitted = count rows per x. */
  y?: string | string[]
  /** Group rows into one series per value of this path (row mode), or name each row-series. */
  series?: string
  /** Heatmap cell value path. */
  value?: string
  agg?: Aggregate
  stack?: boolean
  unit?: string
  format?: Format
  xFormat?: Format
  max?: number
  height?: number
}

export interface ViewRoot { v: 1; title?: string; body: ViewNode }

// ---- compiled view (what the client renders) ----

export interface CompiledColumn { key: string; title: string; format?: Format; width?: number }

export interface CompiledSeries { name: string; data: (number | null)[] }

export type CompiledNode =
  | { kind: 'group'; direction: 'row' | 'column'; columns?: number; children: CompiledNode[] }
  | { kind: 'tabs'; tabs: { label: string; body: CompiledNode }[] }
  | { kind: 'card'; title?: string; subtitle?: string; body: CompiledNode }
  | { kind: 'table'; title?: string; columns: CompiledColumn[]; rows: JsonValue[][]; total: number; pageSize: number }
  | { kind: 'kv'; title?: string; items: { label: string; value: JsonValue; format?: Format }[]; columns?: number }
  | { kind: 'stats'; items: { label: string; value: JsonValue; unit?: string; format?: Format; tone?: Tone; hint?: string }[] }
  | CompiledChart
  | { kind: 'echarts'; title?: string; option: JsonObject; height?: number }
  | { kind: 'timeline'; title?: string; items: { time: JsonValue; label: string; description?: string; tone?: string }[]; total: number }
  | { kind: 'tree'; title?: string; nodes: TreeNode[]; total: number }
  | { kind: 'markdown'; text: string }
  | { kind: 'alert'; tone: Tone; title?: string; text: string }
  | { kind: 'json'; title?: string; data: JsonValue }

export interface CompiledChart {
  kind: 'chart'
  chart: ChartType
  title?: string
  /** Category axis for line/area/bar/hbar/heatmap. */
  categories?: JsonValue[]
  series: CompiledSeries[]
  /** pie/donut slices. */
  slices?: { name: string; value: number }[]
  /** scatter points per series. */
  points?: { name: string; data: [number, number][] }[]
  /** heatmap: y categories and [xIndex, yIndex, value] cells. */
  yCategories?: JsonValue[]
  cells?: [number, number, number][]
  gauge?: { value: number; max: number }
  stack?: boolean
  unit?: string
  format?: Format
  xFormat?: Format
  height?: number
  /** Rows dropped by the size limits. */
  truncated?: number
}

export interface TreeNode { label: string; value?: string; children?: TreeNode[] }

export interface CompiledView {
  v: 1
  title?: string
  body: CompiledNode
  /** True when any data source was cut by the size limits. */
  truncated?: boolean
}

export const NODE_KINDS = ['group', 'tabs', 'card', 'table', 'kv', 'stats', 'chart', 'echarts', 'timeline', 'tree', 'markdown', 'alert', 'json'] as const
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
