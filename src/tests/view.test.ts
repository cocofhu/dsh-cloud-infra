import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ToolArgsError } from '@deepseek-ai/dsh-tools'
import { getPath } from '../core/json-path.js'
import { aggregate, compileView, inferColumns } from '../view/compile.js'
import type { CompiledChart, JsonValue, ViewNode, ViewRoot } from '../view/spec.js'
import { validateView } from '../view/validate.js'

const DATA: Record<string, JsonValue> = {
  r1: {
    TotalCount: 3,
    InstanceSet: [
      { InstanceId: 'ins-1', InstanceState: 'RUNNING', CPU: 2, Memory: 4, Placement: { Zone: 'ap-guangzhou-3' }, CreatedTime: '2026-01-01T00:00:00Z' },
      { InstanceId: 'ins-2', InstanceState: 'STOPPED', CPU: 4, Memory: 8, Placement: { Zone: 'ap-guangzhou-3' }, CreatedTime: '2026-02-01T00:00:00Z' },
      { InstanceId: 'ins-3', InstanceState: 'RUNNING', CPU: 8, Memory: 16, Placement: { Zone: 'ap-guangzhou-6' }, CreatedTime: '2026-03-01T00:00:00Z' },
    ],
  },
  r2: { DataPoints: [
    { Dimensions: [{ Name: 'InstanceId', Value: 'ins-1' }], Timestamps: [1700000600, 1700000000, 1700000300], Values: [30, 10, 20] },
    { Dimensions: [{ Name: 'InstanceId', Value: 'ins-2' }], Timestamps: [1700000000, 1700000300], Values: [5, 6] },
  ] },
  r3: { Time: ['a', 'b', 'c'], In: [1, 2, 3], Out: ['4', '5', null] },
}

function compile(node: ViewNode, opts: { maxRows?: number; maxBytes?: number } = {}) {
  const root: ViewRoot = { v: 1, title: 't', items: [node] }
  assert.deepEqual(validateView(root), [])
  const result = compileView(root, { resolve: (b) => getPath(DATA[b.ref] ?? null, b.path ?? ''), ...opts })
  return { ...result, node: (result.view.body as { children: unknown[] }).children[0] }
}

test('validation reports every problem with its location', () => {
  const errors = validateView({ items: [
    { kind: 'table', data: { ref: 'x1' }, columns: [{ title: 'no key' }] },
    { kind: 'chart', chart: 'radar', data: [] },
    { kind: 'stats', items: [{ label: 'n', value: { a: 1 } }] },
    { kind: 'sparkle' },
    { kind: 'tabs', tabs: [{ label: 'a', items: [{ kind: 'tabs', tabs: [] }] }, { label: 'b', items: [] }] },
    { kind: 'stats', items: [{ label: 'avg', value: { ref: 'r1', path: 'A[*].B', agg: 'avg' } }] },
  ] })
  assert.deepEqual(errors, [
    'view.items[0].data.ref: must be a cloud_call ref such as "r1"',
    'view.items[0].columns[0].key: required string',
    'view.items[1].chart: must be one of line | bar | pie',
    'view.items[2].items[0].value: must be a scalar or a binding { ref, path, agg? }',
    'view.items[3].kind: unknown kind "sparkle"; use one of stats, table, chart, kv, tabs',
    'view.items[4].tabs[0].items[0].kind: unknown kind "tabs"; tabs cannot be nested; use one of stats, table, chart, kv',
    'view.items[4].tabs[1].items: required non-empty array of components (stats, table, chart, kv), shown top to bottom',
    'view.items[5].items[0].value.agg: must be one of count | sum',
  ])
  assert.deepEqual(validateView({ body: { kind: 'table', data: [] } }), ['view.items: required non-empty array of components (stats, table, chart, kv, tabs), shown top to bottom'])
})

test('tables infer columns, one nested level and formats', () => {
  const cols = inferColumns((DATA.r1 as { InstanceSet: JsonValue[] }).InstanceSet)
  assert.deepEqual(cols.map((c) => c.key), ['InstanceId', 'InstanceState', 'CPU', 'Memory', 'CreatedTime', 'Placement.Zone'])
  assert.equal(cols.find((c) => c.key === 'InstanceState')?.format, 'status')
  assert.equal(cols.find((c) => c.key === 'CreatedTime')?.format, 'datetime')
  assert.deepEqual(inferColumns([{ a: 1, empty: null, blank: '', none: [] }, { a: 2, empty: null }]).map((c) => c.key), ['a'])
  const { node, summary } = compile({ kind: 'table', data: { ref: 'r1', path: 'InstanceSet' }, columns: [{ key: 'InstanceId' }, { key: 'Placement.Zone', title: '可用区' }] })
  assert.deepEqual(node, {
    kind: 'table', columns: [{ key: 'InstanceId', title: 'InstanceId' }, { key: 'Placement.Zone', title: '可用区' }],
    rows: [['ins-1', 'ap-guangzhou-3'], ['ins-2', 'ap-guangzhou-3'], ['ins-3', 'ap-guangzhou-6']], total: 3, pageSize: 10,
  })
  assert.match(summary[0]!, /3 rows × 2 columns/)
})

test('chart modes: row grouping, series split, columns, row series, pie', () => {
  const chart = (n: ViewNode) => compile(n).node as CompiledChart
  const zone = chart({ kind: 'chart', chart: 'bar', data: { ref: 'r1', path: 'InstanceSet' }, x: 'Placement.Zone', y: 'CPU' })
  assert.deepEqual(zone.categories, ['ap-guangzhou-3', 'ap-guangzhou-6'])
  assert.deepEqual(zone.series, [{ name: 'CPU', data: [6, 8] }])

  const split = chart({ kind: 'chart', chart: 'bar', data: { ref: 'r1', path: 'InstanceSet' }, x: 'Placement.Zone', series: 'InstanceState' })
  assert.deepEqual(split.series, [{ name: 'RUNNING', data: [1, 1] }, { name: 'STOPPED', data: [1, null] }])

  const cols = chart({ kind: 'chart', chart: 'line', data: { ref: 'r3' }, x: 'Time', y: ['In', 'Out'] })
  assert.deepEqual(cols.series, [{ name: 'In', data: [1, 2, 3] }, { name: 'Out', data: [4, 5, null] }])
  assert.equal(cols.xFormat, undefined)

  const rs = chart({ kind: 'chart', chart: 'line', data: { ref: 'r2', path: 'DataPoints' }, x: 'Timestamps', y: 'Values', series: 'Dimensions[0].Value' })
  assert.deepEqual(rs.categories, [1700000000, 1700000300, 1700000600])
  assert.deepEqual(rs.series, [{ name: 'ins-1', data: [10, 20, 30] }, { name: 'ins-2', data: [5, 6, null] }])
  assert.equal(rs.xFormat, 'datetime')

  const pie = chart({ kind: 'chart', chart: 'pie', data: { ref: 'r1', path: 'InstanceSet' }, x: 'InstanceState' })
  assert.deepEqual(pie.slices, [{ name: 'RUNNING', value: 2 }, { name: 'STOPPED', value: 1 }])
  const mem = chart({ kind: 'chart', chart: 'pie', data: { ref: 'r1', path: 'InstanceSet' }, x: 'InstanceState', y: 'Memory' })
  assert.deepEqual(mem.slices, [{ name: 'RUNNING', value: 20 }, { name: 'STOPPED', value: 8 }])
})

test('maps of objects (multi-region results) become rows with a key', () => {
  const regions = { 'ap-guangzhou': { TotalCount: 18 }, 'ap-tokyo': { error: { code: 'X' } }, 'ap-chengdu': { TotalCount: 97 } }
  const root: ViewRoot = { v: 1, items: [
    { kind: 'chart', chart: 'bar', data: regions, x: 'key', y: 'TotalCount' },
    { kind: 'table', data: regions, columns: [{ key: 'key' }, { key: 'TotalCount' }] },
  ] }
  const { view } = compileView(root, { resolve: () => undefined })
  const [chart, table] = (view.body as { children: Record<string, unknown>[] }).children
  assert.deepEqual(chart!.categories, ['ap-guangzhou', 'ap-tokyo', 'ap-chengdu'])
  assert.deepEqual(chart!.series, [{ name: 'TotalCount', data: [18, null, 97] }])
  assert.deepEqual(table!.rows, [['ap-guangzhou', 18], ['ap-tokyo', null], ['ap-chengdu', 97]])
})

test('stats aggregate bindings; kv and tabs compile into vertical stacks', () => {
  const root: ViewRoot = { v: 1, items: [
    { kind: 'stats', items: [
      { label: '实例', value: { ref: 'r1', path: 'InstanceSet' } },
      { label: 'CPU', value: { ref: 'r1', path: 'InstanceSet[*].CPU', agg: 'sum' }, unit: '核' },
      { label: '静态', value: 42, tone: 'success' },
    ] },
    { kind: 'tabs', tabs: [{ label: '详情', items: [
      { kind: 'kv', data: { ref: 'r1', path: 'InstanceSet[0]' }, items: [{ path: 'InstanceId' }, { label: 'Zone', path: 'Placement.Zone' }] },
    ] }] },
  ] }
  assert.deepEqual(validateView(root), [])
  const { view } = compileView(root, { resolve: (b) => getPath(DATA[b.ref] ?? null, b.path ?? '') })
  const [stats, tabs] = (view.body as { kind: string; children: Record<string, unknown>[] }).children
  assert.equal(view.body.kind, 'group')
  assert.deepEqual((stats!.items as { value: unknown }[]).map((i) => i.value), [3, 14, 42])
  const tab = (tabs!.tabs as { label: string; body: { kind: string; children: Record<string, unknown>[] } }[])[0]!
  assert.equal(tab.body.kind, 'group')
  assert.deepEqual(tab.body.children[0]!.items, [{ label: 'InstanceId', value: 'ins-1' }, { label: 'Zone', value: 'ap-guangzhou-3' }])
  assert.equal(aggregate([1, '2', 'x', null], 'sum'), 3)
  assert.equal(aggregate([1, 2], 'count'), 2)
})

test('bad bindings produce actionable errors', () => {
  assert.throws(() => compile({ kind: 'table', data: { ref: 'r1', path: 'Instances' } }), (e: unknown) => e instanceof ToolArgsError && /path "Instances" not found in r1/.test(String((e as Error).message)))
  assert.throws(() => compile({ kind: 'table', data: { ref: 'r1' } }), /needs an array .* keys TotalCount, InstanceSet/)
})

test('size limits shrink rows and mark the view truncated', () => {
  const big = Array.from({ length: 5000 }, (_, i) => ({ id: `ins-${i}`, note: 'x'.repeat(100) }))
  const { view } = compileView({ v: 1, items: [{ kind: 'table', data: big }] }, { resolve: () => undefined, maxBytes: 64 * 1024 })
  assert.equal(view.truncated, true)
  const t = (view.body as { children: unknown[] }).children[0] as { rows: unknown[]; total: number }
  assert.equal(t.total, 5000)
  assert.ok(t.rows.length < 600 && t.rows.length >= 10)
  assert.ok(JSON.stringify(view).length <= 64 * 1024)
})
