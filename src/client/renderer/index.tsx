import * as React from 'react'
import type { CompiledChart, CompiledNode, CompiledView, Format, JsonValue, Tone } from '../../view/spec.js'
import { statusTone } from '../../view/spec.js'
import { formatValue } from '../format.js'
import type { EchartsChunk, ModuleRequire } from '../types.js'
import { CHART_HEIGHT, chartOption } from './chart-option.js'

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
        <div className="ci-err">渲染 {this.props.node.kind} 失败：{this.state.error.message}</div>
        <JsonBlock value={this.props.node as unknown as JsonValue} />
      </div>
    )
  }
}

const render: Render = (node, key) => {
  const Component = registry.get(node?.kind) as unknown as React.ComponentType<{ node: CompiledNode; render: Render }> | undefined
  if (!Component) return <JsonBlock key={key} value={node as unknown as JsonValue} />
  return <Boundary key={key} node={node}><Component node={node} render={render} /></Boundary>
}

export function ViewRenderer({ view }: { view: CompiledView }) {
  if (!view || view.v !== 1 || !view.body) return <JsonBlock value={view as unknown as JsonValue} />
  return (
    <div className="ci-view">
      {view.title ? <div className="ci-view-title">{view.title}</div> : null}
      {render(view.body)}
      {view.truncated ? <div className="ci-note">部分数据超过展示上限，已截断。</div> : null}
    </div>
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
  const [expanded, setExpanded] = useState(false)
  const all = useMemo(() => text.split('\n'), [text])
  const folded = !expanded && all.length > lines + 4
  return (
    <div>
      <pre className="ci-pre">{folded ? all.slice(0, lines).join('\n') : text}</pre>
      {all.length > lines + 4 ? (
        <button type="button" className="ci-more" onClick={() => setExpanded(!expanded)}>
          {expanded ? '收起' : `展开全部（${all.length} 行）`}
        </button>
      ) : null}
    </div>
  )
}

function SectionTitle({ title }: { title?: string }) {
  return title ? <div className="ci-sec-t">{title}</div> : null
}

export function Badge({ tone, children, dot }: { tone: Tone; children: React.ReactNode; dot?: boolean }) {
  return <span className={`ci-badge ${tone}${dot ? ' st' : ''}`}>{dot ? <span className="ci-dot" /> : null}{children}</span>
}

export function Value({ value, format }: { value: JsonValue | undefined; format?: Format }) {
  if (value === null || value === undefined || value === '') return <span style={{ color: 'var(--ci-weak)' }}>-</span>
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

registerViewComponent('tabs', ({ node, render: r }) => {
  const [active, setActive] = useState(0)
  const current = node.tabs[Math.min(active, node.tabs.length - 1)]
  return (
    <div>
      <div className="ci-tabs" role="tablist">
        {node.tabs.map((t, i) => (
          <button key={i} type="button" role="tab" aria-selected={i === active} className={`ci-tab${i === active ? ' on' : ''}`} onClick={() => setActive(i)}>{t.label}</button>
        ))}
      </div>
      {current ? r(current.body) : null}
    </div>
  )
})

// ---- data ----

function compare(a: JsonValue, b: JsonValue): number {
  if (a === b) return 0
  if (a === null || a === undefined) return 1
  if (b === null || b === undefined) return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b), undefined, { numeric: true })
}

registerViewComponent('table', ({ node }) => {
  const [page, setPage] = useState(0)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<{ col: number; dir: 1 | -1 } | null>(null)
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    let out = q ? node.rows.filter((r) => r.some((c) => c !== null && String(typeof c === 'object' ? JSON.stringify(c) : c).toLowerCase().includes(q))) : node.rows
    if (sort) out = [...out].sort((a, b) => compare(a[sort.col] ?? null, b[sort.col] ?? null) * sort.dir)
    return out
  }, [node.rows, query, sort])
  const pageSize = node.pageSize || 10
  const pages = Math.max(1, Math.ceil(rows.length / pageSize))
  const current = Math.min(page, pages - 1)
  const visible = rows.slice(current * pageSize, current * pageSize + pageSize)
  const toggleSort = (col: number) => setSort((s) => (s?.col === col ? (s.dir === 1 ? { col, dir: -1 } : null) : { col, dir: 1 }))
  return (
    <div>
      <SectionTitle title={node.title} />
      {node.rows.length > pageSize ? (
        <div className="ci-tbar">
          <span className="ci-grow" />
          <input placeholder="输入关键字筛选" value={query} onChange={(e) => { setQuery(e.target.value); setPage(0) }} aria-label="筛选表格" />
        </div>
      ) : null}
      <div className="ci-table-wrap">
        <table className="ci-table">
          <thead>
            <tr>
              {node.columns.map((c, i) => (
                <th key={i} onClick={() => toggleSort(i)} aria-sort={sort?.col === i ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
                  {c.title}{sort?.col === i ? <span className="ci-sort">{sort.dir === 1 ? '↑' : '↓'}</span> : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.length ? visible.map((r, ri) => (
              <tr key={ri}>
                {node.columns.map((c, ci) => {
                  const v = r[ci]
                  const title = v !== null && v !== undefined && typeof v !== 'object' ? String(v) : undefined
                  return <td key={ci} title={title}><Value value={v} format={c.format} /></td>
                })}
              </tr>
            )) : (
              <tr><td colSpan={node.columns.length} className="empty">{query ? '没有匹配的数据' : '暂无数据'}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {node.rows.length > pageSize ? (
        <div className="ci-pager">
          <span>共 {rows.length} 项{rows.length !== node.rows.length ? `（筛选自 ${node.rows.length} 项）` : ''}</span>
          <span className="ci-grow" />
          <span>{current + 1} / {pages} 页</span>
          <button type="button" className="ci-turn" aria-label="上一页" disabled={current === 0} onClick={() => setPage(current - 1)}>‹</button>
          <button type="button" className="ci-turn" aria-label="下一页" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>›</button>
        </div>
      ) : null}
      {node.total > node.rows.length ? <div className="ci-note">共 {node.total} 行，展示前 {node.rows.length} 行。</div> : null}
    </div>
  )
})

registerViewComponent('kv', ({ node }) => (
  <div>
    <SectionTitle title={node.title} />
    <div className="ci-kv">
      {node.items.map((it, i) => (
        <div key={i} className="ci-kv-i">
          <span className="ci-kv-l">{it.label}</span>
          <span className="ci-kv-v"><Value value={it.value} format={it.format} /></span>
        </div>
      ))}
    </div>
  </div>
))

registerViewComponent('stats', ({ node }) => (
  <div className="ci-stats">
    {node.items.map((it, i) => (
      <div key={i} className={`ci-stat ${it.tone ?? ''}`}>
        <div className="ci-stat-l">{it.label}</div>
        <div className="ci-stat-v">{formatValue(it.value, it.format)}{it.unit ? <small>{it.unit}</small> : null}</div>
      </div>
    ))}
  </div>
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
    <div>
      <SectionTitle title={title} />
      <div className="ci-chart" style={{ height }}>
        <div ref={el} style={{ width: '100%', height: '100%' }} />
        {state !== 'ready' ? (
          <div className="ci-chart-ph">{state === 'loading' ? <><span className="ci-spin" />加载图表…</> : <span className="ci-err">图表加载失败：{error}</span>}</div>
        ) : null}
      </div>
    </div>
  )
}

registerViewComponent('chart', ({ node }) => {
  const option = useMemo(() => chartOption(node as CompiledChart), [node])
  return (
    <div>
      <EChart option={option} height={CHART_HEIGHT} title={node.title} />
      {node.truncated ? <div className="ci-note">数据点过多，只展示最近的部分。</div> : null}
    </div>
  )
})

