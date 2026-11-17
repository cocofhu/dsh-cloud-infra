import * as React from 'react'
import type { CompiledChart, CompiledNode, CompiledView, Format, JsonValue, Tone } from '../../view/spec.js'
import { statusTone } from '../../view/spec.js'
import { formatValue } from '../format.js'
import type { EchartsChunk, ModuleRequire } from '../types.js'
import { CHART_HEIGHT, chartOption } from './chart-option.js'
import { Card, Form, Icon, MetricsBoard, Pagination, SearchBox, Table, TabPanel, Tabs, Tag, TeaBadge, Text } from '../tea.js'
import { TeaLocale, useT } from '../i18n.js'

const { useEffect, useMemo, useRef, useState } = React

declare const __dshRequire: ModuleRequire | undefined

export type Render = (node: CompiledNode, key?: React.Key) => React.ReactNode
export type ViewComponent<K extends CompiledNode['kind']> = (props: { node: Extract<CompiledNode, { kind: K }>; render: Render }) => React.ReactNode

const registry = new Map<string, ViewComponent<never>>()

/** Extension point: register or replace the renderer of one node kind. */
export function registerViewComponent<K extends CompiledNode['kind']>(kind: K, component: ViewComponent<K>): () => void {
  const previous = registry.get(kind)
  registry.set(kind, component as unknown as ViewComponent<never>)
  return () => {
    if (previous) registry.set(kind, previous)
    else registry.delete(kind)
  }
}

class Boundary extends React.Component<{ node: CompiledNode; children: React.ReactNode }, { error?: Error }> {
  override state: { error?: Error } = {}
  static getDerivedStateFromError(error: Error) { return { error } }
  override render() {
    if (!this.state.error) return this.props.children
    return (
      <div>
        <RenderError kind={this.props.node.kind} message={this.state.error.message} />
        <JsonBlock value={this.props.node as unknown as JsonValue} />
      </div>
    )
  }
}

function RenderError({ kind, message }: { kind: string; message: string }) {
  return <div className="ci-err">{useT()('render.error', { kind, message })}</div>
}

const render: Render = (node, key) => {
  const Component = registry.get(node?.kind) as unknown as React.ComponentType<{ node: CompiledNode; render: Render }> | undefined
  if (!Component) return <JsonBlock key={key} value={node as unknown as JsonValue} />
  return <Boundary key={key} node={node}><Component node={node} render={render} /></Boundary>
}

export function ViewRenderer({ view }: { view: CompiledView }) {
  const t = useT()
  if (!view || view.v !== 1 || !view.body) return <JsonBlock value={view as unknown as JsonValue} />
  return (
    <TeaLocale>
      <div className="ci-view">
        {view.title ? <div className="ci-view-title">{view.title}</div> : null}
        {render(view.body)}
        {view.truncated ? <div className="ci-note">{t('view.truncated')}</div> : null}
      </div>
    </TeaLocale>
  )
}

export function JsonBlock({ value }: { value: JsonValue }) {
  const text = useMemo(() => {
    const s = JSON.stringify(value, null, 2) ?? 'null'
    return s.length > 200_000 ? `${s.slice(0, 200_000)}\n…` : s
  }, [value])
  return <PreBlock text={text} />
}

/** Long text folds to its first lines instead of scrolling, so the chat keeps a single scrollbar. */
export function PreBlock({ text, lines = 16 }: { text: string; lines?: number }) {
  const t = useT()
  const [expanded, setExpanded] = useState(false)
  const all = useMemo(() => text.split('\n'), [text])
  const folded = !expanded && all.length > lines + 4
  return (
    <div>
      <pre className="ci-pre">{folded ? all.slice(0, lines).join('\n') : text}</pre>
      {all.length > lines + 4 ? (
        <button type="button" className="ci-more" onClick={() => setExpanded(!expanded)}>
          {expanded ? t('list.collapse') : t('list.expand', { count: all.length })}
        </button>
      ) : null}
    </div>
  )
}

/** A titled Tea card; the unit every content component sits in. */
export function Section({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <Card className="ci-card">
      <Card.Body title={title}>{children}</Card.Body>
    </Card>
  )
}

const TAG_THEME = { neutral: 'default', info: 'primary', success: 'success', warning: 'warning', danger: 'error' } as const
const DOT_THEME = { info: 'default', success: 'success', warning: 'warning', danger: 'danger' } as const

/** Tone label as a Tea Tag, or with `dot` a status dot plus text (Tea Badge). */
export function Badge({ tone, children, dot }: { tone: Tone; children: React.ReactNode; dot?: boolean }) {
  if (dot) {
    return (
      <span className="ci-status">
        {tone === 'neutral' ? <span className="ci-dot" /> : <TeaBadge dot theme={DOT_THEME[tone]} />}
        {children}
      </span>
    )
  }
  return <Tag theme={TAG_THEME[tone]} className="ci-tag">{children}</Tag>
}

export function Spinner() {
  return <Icon type="loading" />
}

export function Value({ value, format }: { value: JsonValue | undefined; format?: Format }) {
  if (value === null || value === undefined || value === '') return <Text theme="weak">-</Text>
  switch (format) {
    case 'status':
      return <Badge tone={statusTone(value)} dot>{String(value)}</Badge>
    default:
      if (typeof value === 'boolean') return <Badge tone={value ? 'success' : 'neutral'}>{String(value)}</Badge>
      return <>{formatValue(value, format)}</>
  }
}

// ---- layout ----

registerViewComponent('group', ({ node, render: r }) => <div className="ci-col">{node.children.map((c, i) => r(c, i))}</div>)

registerViewComponent('tabs', ({ node, render: r }) => (
  <Tabs tabs={node.tabs.map((t, i) => ({ id: String(i), label: t.label }))} animated={false} destroyInactiveTabPanel>
    {node.tabs.map((t, i) => <TabPanel key={i} id={String(i)}>{r(t.body)}</TabPanel>)}
  </Tabs>
))

// ---- data ----

function compare(a: JsonValue, b: JsonValue): number {
  if (a === b) return 0
  if (a === null || a === undefined) return 1
  if (b === null || b === undefined) return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b), undefined, { numeric: true })
}

interface SortBy { by: string; order: 'asc' | 'desc' | undefined }

/** Rough rendered width of 12px text: CJK glyphs are square, capitals wider than lowercase. */
function textWidth(text: string): number {
  let width = 0
  for (const ch of text) width += /[\u2e80-\uffff]/.test(ch) ? 12 : /[A-Z_]/.test(ch) ? 8.5 : 7
  return Math.ceil(width)
}

function cellText(value: JsonValue | undefined, format?: Format): string {
  if (value === null || value === undefined || value === '') return '-'
  return typeof value === 'object' && !Array.isArray(value) ? JSON.stringify(value) : formatValue(value, format)
}

/**
 * Column widths from the header (plus the sort button) and the 90th percentile of the
 * first rows, so narrow chats scroll the table sideways instead of squeezing headers.
 */
function columnWidths(columns: { title: string; format?: Format }[], rows: JsonValue[][]): number[] {
  const sample = rows.slice(0, 50)
  return columns.map((c, i) => {
    const values = sample.map((r) => textWidth(cellText(r[i], c.format))).sort((a, b) => a - b)
    const content = (values[Math.floor(values.length * 0.9)] ?? 0) + (c.format === 'status' ? 14 : 0)
    return Math.min(320, Math.max(72, textWidth(c.title) + 44, content + 28))
  })
}

registerViewComponent('table', ({ node }) => {
  const t = useT()
  const [pageIndex, setPageIndex] = useState(1)
  const [query, setQuery] = useState('')
  const [sorts, setSorts] = useState<SortBy[]>([])
  const pageSize = node.pageSize || 10
  const paged = node.rows.length > pageSize
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    let out = q ? node.rows.filter((r) => r.some((c) => c !== null && String(typeof c === 'object' ? JSON.stringify(c) : c).toLowerCase().includes(q))) : node.rows
    const sort = sorts[0]
    if (sort?.order) {
      const col = Number(sort.by.slice(1))
      const dir = sort.order === 'asc' ? 1 : -1
      out = [...out].sort((a, b) => compare(a[col] ?? null, b[col] ?? null) * dir)
    }
    return out
  }, [node.rows, query, sorts])
  const pages = Math.max(1, Math.ceil(rows.length / pageSize))
  const current = Math.min(pageIndex, pages)
  const visible = paged ? rows.slice((current - 1) * pageSize, current * pageSize) : rows
  const widths = useMemo(() => columnWidths(node.columns, node.rows), [node.columns, node.rows])
  const columns = node.columns.map((c, i) => ({
    key: `c${i}`,
    header: c.title,
    width: widths[i],
    render: (row: JsonValue[]) => <Value value={row[i]} format={c.format} />,
  }))
  const addons = [Table.addons.sortable({ columns: columns.map((c) => c.key), value: sorts, onChange: (v: SortBy[]) => setSorts(v) })]
  return (
    <Section title={node.title}>
      {paged ? (
        <div className="ci-tbar">
          <SearchBox size="m" placeholder={t('table.filter')} value={query} aria-label={t('table.filterAria')}
            onChange={(v: string) => { setQuery(v); setPageIndex(1) }} onClear={() => { setQuery(''); setPageIndex(1) }} />
        </div>
      ) : null}
      <div className="ci-table-scroll">
        <div style={{ minWidth: widths.reduce((a, b) => a + b, 0) }}>
          <Table
            columns={columns}
            records={visible}
            recordKey={(_: JsonValue[], i: number) => String((current - 1) * pageSize + i)}
            addons={addons}
            topTip={visible.length ? undefined : <div className="ci-empty">{t(query ? 'table.noMatch' : 'table.empty')}</div>}
          />
        </div>
      </div>
      {paged ? (
        <Pagination recordCount={rows.length} pageIndex={current} pageSize={pageSize} pageSizeVisible={false}
          onPagingChange={(q: { pageIndex?: number }) => setPageIndex(q.pageIndex ?? 1)} />
      ) : null}
      {node.total > node.rows.length ? <div className="ci-note">{t('table.partial', { total: node.total, shown: node.rows.length })}</div> : null}
    </Section>
  )
})

registerViewComponent('kv', ({ node }) => (
  <Section title={node.title}>
    <Form readonly layout="fixed" fixedLabelWidth={88} className="ci-kv">
      {node.items.map((it, i) => (
        <Form.Item key={i} label={it.label}>
          <Form.Text><Value value={it.value} format={it.format} /></Form.Text>
        </Form.Item>
      ))}
    </Form>
  </Section>
))

const TONE_TEXT = { neutral: undefined, info: 'primary', success: 'success', warning: 'warning', danger: 'danger' } as const

registerViewComponent('stats', ({ node }) => (
  <Card className="ci-card">
    <Card.Body>
      <div className="ci-stats">
        {node.items.map((it, i) => (
          <MetricsBoard key={i} title={it.label} unit={it.unit}
            value={<Text theme={TONE_TEXT[it.tone ?? 'neutral']}>{formatValue(it.value, it.format)}</Text>} />
        ))}
      </div>
    </Card.Body>
  </Card>
))

// ---- charts ----

let chunk: Promise<EchartsChunk> | undefined

export function loadEcharts(): Promise<EchartsChunk> {
  if (!chunk) {
    const req = typeof __dshRequire !== 'undefined' ? __dshRequire : undefined
    chunk = req?.async ? (req.async('./client.echarts.js') as Promise<EchartsChunk>) : Promise.reject(new Error('chart runtime unavailable'))
    chunk.catch(() => { chunk = undefined })
  }
  return chunk
}

function useDarkTheme(): boolean {
  const read = () => typeof document !== 'undefined' && document.body?.hasAttribute('data-ds-dark-theme')
  const [dark, setDark] = useState(read)
  useEffect(() => {
    if (typeof MutationObserver === 'undefined' || !document.body) return
    const observer = new MutationObserver(() => setDark(read()))
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
    return () => observer.disconnect()
  }, [])
  return dark
}

export function EChart({ option, height, title }: { option: Record<string, unknown>; height: number; title?: string }) {
  const el = useRef<HTMLDivElement>(null)
  const instance = useRef<ReturnType<EchartsChunk['mount']> | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const dark = useDarkTheme()
  const t = useT()
  useEffect(() => {
    let live = true
    loadEcharts().then((ec) => {
      if (!live || !el.current) return
      if (instance.current) instance.current.update(option, dark)
      else instance.current = ec.mount(el.current, option, dark)
      setState('ready')
    }, (e: Error) => { if (live) { setState('error'); setError(e.message) } })
    return () => { live = false }
  }, [option, dark])
  useEffect(() => () => { instance.current?.dispose(); instance.current = null }, [])
  return (
    <Section title={title}>
      <div className="ci-chart" style={{ height }}>
        <div ref={el} style={{ width: '100%', height: '100%' }} />
        {state !== 'ready' ? (
          <div className="ci-chart-ph">{state === 'loading' ? <><Spinner />{t('chart.loading')}</> : <span className="ci-err">{t('chart.failed', { error })}</span>}</div>
        ) : null}
      </div>
    </Section>
  )
}

registerViewComponent('chart', ({ node }) => {
  const t = useT()
  const option = useMemo(() => chartOption(node as CompiledChart), [node])
  return (
    <>
      <EChart option={option} height={CHART_HEIGHT} title={node.title} />
      {node.truncated ? <div className="ci-note">{t('chart.truncated')}</div> : null}
    </>
  )
})

