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
  chartHeight: (node: object) => number
  formatValue: (v: JsonValue, format?: string) => string
  CallToolView: (props: Record<string, unknown>) => React.ReactNode
  VisualizeToolView: (props: Record<string, unknown>) => React.ReactNode
  apply: (ctx: object) => void
  inject: string[]
}

const client = createRequire(import.meta.url)('./client-under-test.cjs') as ClientUnderTest
const html = (el: React.ReactElement) => renderToStaticMarkup(el)

const rows: JsonValue = [
  { id: 'ins-1', state: 'RUNNING', cpu: 2, zone: 'gz-3', time: '2026-01-01T00:00:00Z' },
  { id: 'ins-2', state: 'STOPPED', cpu: 4, zone: 'gz-6', time: '2026-01-02T00:00:00Z' },
]

function view(body: object): CompiledView {
  return compileView({ v: 1, title: '测试', body } as ViewRoot, { resolve: (b) => getPath(b.ref === 'r1' ? rows : null, b.path ?? '') }).view
}

test('format helpers', () => {
  assert.equal(client.formatValue(1536, 'bytes'), '1.5 KB')
  assert.equal(client.formatValue(25.6, 'percent'), '25.6%')
  assert.equal(client.formatValue(1234567, 'number'), '1,234,567')
  assert.equal(client.formatValue(null), '—')
  assert.equal(client.formatValue(['a', 'b']), 'a, b')
})

test('every component kind renders server-side', () => {
  const v = view({ kind: 'tabs', tabs: [
    { label: '概览', body: { kind: 'group', direction: 'row', children: [
      { kind: 'stats', items: [{ label: '实例', value: 2, tone: 'success' }, { label: 'CPU', value: { ref: 'r1', path: '[*].cpu', agg: 'sum' }, unit: '核' }] },
      { kind: 'kv', data: { ref: 'r1', path: '[0]' } },
    ] } },
    { label: '表格', body: { kind: 'card', title: '实例', body: { kind: 'table', data: { ref: 'r1' } } } },
    { label: '其它', body: { kind: 'group', children: [
      { kind: 'timeline', data: { ref: 'r1' }, time: 'time', label: 'id', tone: 'state' },
      { kind: 'tree', data: [{ label: 'vpc-1', children: [{ label: 'subnet-1' }] }], label: 'label' },
      { kind: 'markdown', text: '# 标题\n- **粗体** `code`\n[link](javascript:alert(1))' },
      { kind: 'alert', tone: 'warning', text: '注意' },
      { kind: 'json', data: { a: 1 } },
    ] } },
  ] })
  const out = html(React.createElement(client.ViewRenderer, { view: v }))
  for (const s of ['测试', '概览', 'ci-stat', '核']) assert.ok(out.includes(s), s)
  assert.doesNotMatch(out, /javascript:/)
})

test('table renders rows, status badges and inferred headers', () => {
  const v = view({ kind: 'table', data: { ref: 'r1' } })
  const out = html(React.createElement(client.ViewRenderer, { view: v }))
  for (const s of ['ins-1', 'ins-2', 'RUNNING', 'state', 'zone']) assert.ok(out.includes(s), s)
})

test('unknown or broken nodes fall back to JSON instead of crashing', () => {
  const out = html(React.createElement(client.ViewRenderer, { view: { v: 1, body: { kind: 'future-widget', x: 1 } } as unknown as CompiledView }))
  assert.match(out, /future-widget/)
})

test('chart options for every chart type', () => {
  const types = ['line', 'area', 'bar', 'hbar', 'pie', 'donut', 'scatter', 'heatmap', 'gauge'] as const
  for (const chart of types) {
    const body = chart === 'scatter'
      ? { kind: 'chart', chart, data: { ref: 'r1' }, x: 'cpu', y: 'cpu' }
      : chart === 'heatmap'
        ? { kind: 'chart', chart, data: { ref: 'r1' }, x: 'zone', y: 'state' }
        : chart === 'gauge'
          ? { kind: 'chart', chart, data: 42, format: 'percent' }
          : { kind: 'chart', chart, data: { ref: 'r1' }, x: chart === 'pie' || chart === 'donut' ? 'state' : 'zone', y: chart === 'pie' || chart === 'donut' ? undefined : 'cpu' }
    const node = view(body).body as CompiledChart
    const opt = client.chartOption(node)
    const series = opt.series as { type: string }[]
    assert.ok(Array.isArray(series) && series.length > 0, chart)
    const expected = { line: 'line', area: 'line', bar: 'bar', hbar: 'bar', pie: 'pie', donut: 'pie', scatter: 'scatter', heatmap: 'heatmap', gauge: 'gauge' }[chart]
    assert.equal(series[0]!.type, expected, chart)
    assert.doesNotThrow(() => JSON.stringify(opt), chart)
    assert.ok(client.chartHeight(node) >= 120)
  }
})

test('tool views render call and view results; apply registers slots', () => {
  const callMeta = { kind: 'cloud-call', ref: 'r1', account: 'dev', service: 'cvm', action: 'DescribeInstances', version: '2017-03-12', region: 'ap-guangzhou', risk: 'read', requestId: 'req-1', durationMs: 12, preview: '{"TotalCount":2}', truncated: false }
  const expanded = () => ({ expanded: true, toggle: () => undefined })
  const result = (meta: unknown, extra: object = {}) => ({ kind: 'tool-result', callId: 'c', name: 'x', call: null, content: [], isError: false, meta, ...extra })
  const call = html(React.createElement(client.CallToolView, { phase: 'result', toolName: 'cloud_call', callId: 'c1', useDisclosure: expanded, block: result(callMeta) }))
  for (const s of ['cvm.DescribeInstances', 'ap-guangzhou', 'req-1', 'TotalCount', '只读']) assert.ok(call.includes(s), s)
  const collapsed = html(React.createElement(client.CallToolView, { phase: 'result', toolName: 'cloud_call', callId: 'c1', block: result(callMeta) }))
  assert.ok(!collapsed.includes('req-1'))
  const vis = html(React.createElement(client.VisualizeToolView, { phase: 'result', toolName: 'cloud_visualize', callId: 'c2', block: result({ kind: 'cloud-view', view: view({ kind: 'markdown', text: 'hello view' }) }) }))
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
