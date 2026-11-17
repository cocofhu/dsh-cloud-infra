import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { getPath } from '../core/json-path.js'
import { compileView } from '../view/compile.js'
import type { CompiledChart, CompiledView, JsonValue, ViewRoot } from '../view/spec.js'

interface ClientUnderTest {
  ViewRenderer: (props: { view: CompiledView }) => React.ReactNode
  chartOption: (node: CompiledChart) => Record<string, unknown>
  formatValue: (v: JsonValue, format?: string) => string
  CallToolView: (props: Record<string, unknown>) => React.ReactNode
  VisualizeToolView: (props: Record<string, unknown>) => React.ReactNode
  apply: (ctx: object) => void
  cardDefinition: { match: Record<string, (e: object) => unknown>; start: (c: object, m: object) => unknown; buildViewNode: (c: object) => Record<string, unknown> | null }
  CloudViewCard: (props: Record<string, unknown>) => React.ReactNode
  inject: string[]
}

const client = createRequire(import.meta.url)('./client-under-test.cjs') as ClientUnderTest
const html = (el: React.ReactElement) => renderToStaticMarkup(el)

const rows: JsonValue = [
  { id: 'ins-1', state: 'RUNNING', cpu: 2, zone: 'gz-3', time: '2026-01-01T00:00:00Z' },
  { id: 'ins-2', state: 'STOPPED', cpu: 4, zone: 'gz-6', time: '2026-01-02T00:00:00Z' },
]

function view(node: object): CompiledView {
  return compileView({ v: 1, title: '测试', items: [node] } as ViewRoot, { resolve: (b) => getPath(b.ref === 'r1' ? rows : null, b.path ?? '') }).view
}

const first = (v: CompiledView) => (v.body as { children: unknown[] }).children[0]

test('format helpers', () => {
  assert.equal(client.formatValue(1536, 'bytes'), '1.5 KB')
  assert.equal(client.formatValue(25.6, 'percent'), '25.6%')
  assert.equal(client.formatValue(1234567, 'number'), '1,234,567')
  assert.equal(client.formatValue(null), '—')
  assert.equal(client.formatValue(['a', 'b']), 'a, b')
})

test('every component kind renders server-side', () => {
  const v = view({ kind: 'tabs', tabs: [
    { label: '概览', items: [
      { kind: 'stats', items: [{ label: '实例', value: 2, tone: 'success' }, { label: 'CPU', value: { ref: 'r1', path: '[*].cpu', agg: 'sum' }, unit: '核' }] },
      { kind: 'kv', data: { ref: 'r1', path: '[0]' } },
      { kind: 'chart', chart: 'pie', data: { ref: 'r1' }, x: 'state' },
    ] },
    { label: '表格', items: [{ kind: 'table', data: { ref: 'r1' } }] },
  ] })
  const out = html(React.createElement(client.ViewRenderer, { view: v }))
  for (const s of ['测试', '概览', '表格', 'tea-metrics-board', '核', 'tea-form__item', 'ci-chart', 'tea-tabs', 'tea-card']) assert.ok(out.includes(s), s)
})

test('table renders rows, status badges and inferred headers', () => {
  const v = view({ kind: 'table', data: { ref: 'r1' } })
  const out = html(React.createElement(client.ViewRenderer, { view: v }))
  for (const s of ['ins-1', 'ins-2', 'RUNNING', 'state', 'zone']) assert.ok(out.includes(s), s)
})

test('table pages without inner scrolling and shows status as dot + text', () => {
  const many = Array.from({ length: 23 }, (_, i) => ({ id: `ins-${i}`, state: i % 2 ? 'RUNNING' : 'STOPPED' }))
  const v = compileView({ v: 1, items: [{ kind: 'table', data: many, columns: [{ key: 'id' }, { key: 'state', format: 'status' }] }] }, { resolve: () => null }).view
  const out = html(React.createElement(client.ViewRenderer, { view: v }))
  assert.equal((out.match(/<tr>/g) ?? []).length, 1 + 10)
  assert.match(out, /class="tea-pagination__text">共 <strong>23<\/strong>/)
  assert.match(out, /tea-pagination__inputpagenum" value="1"/)
  assert.ok(out.includes('tea-table'))
  assert.match(out, /<span class="ci-status"><span class="tea-badge tea-badge--dot is-success-dark"><\/span>RUNNING/)
  assert.match(out, /<span class="ci-status"><span class="ci-dot"><\/span>STOPPED/)
})

test('unknown nodes from older views fall back to folded JSON', () => {
  const legacy = { v: 1, body: { kind: 'group', children: [{ kind: 'timeline', list: Array.from({ length: 40 }, (_, i) => i) }] } } as unknown as CompiledView
  const out = html(React.createElement(client.ViewRenderer, { view: legacy }))
  assert.match(out, /timeline/)
  assert.match(out, /展开全部（\d+ 行）/)
  assert.ok(!out.includes(' 39\n'), 'folded lines are not rendered')
})

test('unknown or broken nodes fall back to JSON instead of crashing', () => {
  const out = html(React.createElement(client.ViewRenderer, { view: { v: 1, body: { kind: 'future-widget', x: 1 } } as unknown as CompiledView }))
  assert.match(out, /future-widget/)
})

test('chart options for every chart type', () => {
  for (const chart of ['line', 'bar', 'pie'] as const) {
    const node = first(view({ kind: 'chart', chart, data: { ref: 'r1' }, x: chart === 'pie' ? 'state' : 'zone', ...(chart === 'pie' ? {} : { y: 'cpu' }) })) as CompiledChart
    const opt = client.chartOption(node)
    const series = opt.series as { type: string }[]
    assert.equal(series[0]!.type, chart)
    assert.doesNotThrow(() => JSON.stringify(opt), chart)
  }
  const time = first(view({ kind: 'chart', chart: 'line', data: { ref: 'r1' }, x: 'time', y: 'cpu' })) as CompiledChart
  assert.equal(time.xFormat, 'datetime')
  assert.match(String((client.chartOption(time).xAxis as { data: string[] }).data[0]), /^2026-01-0[12] /)
})

test('tool views render call and view results; apply registers slots', () => {
  const callMeta = { kind: 'cloud-call', ref: 'r1', account: 'dev', service: 'cvm', action: 'DescribeInstances', version: '2017-03-12', region: 'ap-guangzhou', risk: 'read', requestId: 'req-1', durationMs: 12, preview: '{"TotalCount":2}', truncated: false }
  const expanded = () => ({ expanded: true, toggle: () => undefined })
  const result = (meta: unknown, extra: object = {}) => ({ kind: 'tool-result', callId: 'c', name: 'x', call: null, content: [], isError: false, meta, ...extra })
  const call = html(React.createElement(client.CallToolView, { phase: 'result', toolName: 'cloud_call', callId: 'c1', useDisclosure: expanded, block: result(callMeta) }))
  for (const s of ['cvm.DescribeInstances', 'ap-guangzhou', 'req-1', 'TotalCount', '只读']) assert.ok(call.includes(s), s)
  assert.doesNotMatch(call, />r1</, 'the result ref is for the model, not shown to users')
  const collapsed = html(React.createElement(client.CallToolView, { phase: 'result', toolName: 'cloud_call', callId: 'c1', block: result(callMeta) }))
  assert.ok(!collapsed.includes('req-1'))
  const vis = html(React.createElement(client.VisualizeToolView, { phase: 'result', toolName: 'cloud_visualize', callId: 'c2', block: result({ kind: 'cloud-view', view: view({ kind: 'kv', data: { note: 'hello view' } }) }) }))
  assert.match(vis, /hello view/)
  const err = html(React.createElement(client.VisualizeToolView, { phase: 'result', toolName: 'cloud_visualize', callId: 'c3', block: result(undefined, { isError: true, content: [{ type: 'text', text: 'boom' }] }) }))
  assert.match(err, /失败/)
  const pending = html(React.createElement(client.CallToolView, { phase: 'start', toolName: 'cloud_call', callId: 'c4', block: { argsRaw: '{"service":"cvm","action":"DescribeZones","regions":["a","b"]}' } }))
  assert.match(pending, /cvm.DescribeZones/)
  assert.match(pending, /2 个地域/)

  const registered: Record<string, unknown>[] = []
  const slots = {
    inject: (_name: string, factory: () => unknown) => { factory() },
    register: (options: Record<string, unknown>) => { registered.push(options); return () => undefined },
  }
  client.apply({ get: (name: string) => (name === 'slots' ? slots : undefined), effect: () => undefined })
  assert.deepEqual(client.inject, ['slots'])
  assert.deepEqual(registered.map((r) => `${String(r.name)}:${String(r.key)}`), [
    'tool.call.toolview:cloud_call', 'tool.call.toolview:cloud_visualize', 'plugins.bundle.config:@cocofhu/dsh-cloud-infra',
  ])
})

test('visualization results become Turn-level chat cards outside the tool group', () => {
  const v = view({ kind: 'kv', data: { note: 'card body' } })
  const event = (meta: unknown, extra: object = {}) => ({ type: 'tool/result', seq: 42, surfaceOp: 'append', data: { message: { source: { callId: 'call-9' } }, meta, ...extra } })
  const match = client.cardDefinition.match['tool/result']
  assert.deepEqual(match(event({ kind: 'cloud-view', view: v })), { id: 'call-9', role: 'start' })
  assert.equal(match(event({ kind: 'cloud-call' })), null)
  assert.equal(match(event({ kind: 'cloud-view', view: v }, { isError: true })), null)
  assert.equal(match({ ...event({ kind: 'cloud-view', view: v }), surfaceOp: 'replace' }), null)

  const location = { kind: 'step' }
  const m = { event: event({ kind: 'cloud-view', view: v }), location, role: 'start' }
  const state = client.cardDefinition.start({}, m)
  const node = client.cardDefinition.buildViewNode({ key: 'k', id: 'call-9', start: m, matches: [m], state, current: new Map() })
  assert.equal(node?.groupTree, 'turn')
  assert.equal(node?.kind, 'cloud-infra-view')
  assert.equal(node?.anchorSeq, 42)
  assert.equal(node?.location, location)
  assert.match(html(React.createElement(client.CloudViewCard, { node })), /card body/)

  const plugins: { inject: string[]; apply: (ctx: object) => void }[] = []
  const registered: string[] = []
  const definitions: unknown[] = []
  const slots = { inject: (_n: string, f: () => unknown) => { f() }, register: (o: Record<string, unknown>) => { registered.push(`${String(o.name)}:${String(o.key)}`); return () => undefined } }
  client.apply({ get: () => slots, effect: () => undefined, plugin: (p: { inject: string[]; apply: (ctx: object) => void }) => plugins.push(p) })
  assert.deepEqual(plugins[0]?.inject, ['slots', 'uiConversation'])
  const services: Record<string, unknown> = { slots, uiConversation: { events: { register: (d: unknown) => { definitions.push(d); return () => undefined } } } }
  plugins[0]?.apply({ get: (n: string) => services[n], effect: (f: () => () => void) => { f() } })
  assert.equal(definitions[0], client.cardDefinition)
  assert.ok(registered.includes('conversation.chat.node:cloud-infra-view'))
  const row = html(React.createElement(client.VisualizeToolView, { phase: 'result', toolName: 'cloud_visualize', callId: 'c', block: { kind: 'tool-result', callId: 'c', name: 'cloud_visualize', call: null, content: [], isError: false, meta: { kind: 'cloud-view', view: v } } }))
  assert.match(row, /已在对话中展示/)
  assert.doesNotMatch(row, /card body/)
})
