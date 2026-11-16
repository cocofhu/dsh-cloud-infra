import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ToolArgsError } from '@deepseek-ai/dsh-tools'
import { getPath } from '../core/json-path.js'
import { aggregate, compileView, inferColumns, sanitizeOption } from '../view/compile.js'
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
    { Dimensions: [{ Name: 'InstanceId', Value: 'ins-1' }], Timestamps: [3, 1, 2], Values: [30, 10, 20] },
    { Dimensions: [{ Name: 'InstanceId', Value: 'ins-2' }], Timestamps: [1, 2], Values: [5, 6] },
  ] },
  r3: { Time: ['a', 'b', 'c'], In: [1, 2, 3], Out: ['4', '5', null] },
}

function compile(body: ViewNode, opts: { maxRows?: number; maxBytes?: number } = {}) {
  const root = { v: 1, title: 't', body } as ViewRoot
  assert.deepEqual(validateView(root), [])
  return compileView(root, { resolve: (b) => getPath(DATA[b.ref] ?? null, b.path ?? ''), ...opts })
}

test('validation reports every problem with its location', () => {
  const errors = validateView({ body: { kind: 'group', children: [
    { kind: 'table', data: { ref: 'x1' }, columns: [{ title: 'no key' }] },
    { kind: 'chart', chart: 'radar', data: [] },
    { kind: 'chart', chart: 'heatmap', data: [], x: 'a' },
    { kind: 'stats', items: [{ label: 'n', value: { a: 1 } }] },
    { kind: 'sparkle' },
  ] } })
  assert.deepEqual(errors, [
    'view.body.children[0].data.ref: must be a cloud_call ref such as "r1"',
    'view.body.children[0].columns[0].key: required string',
    'view.body.children[1].chart: must be one of line | area | bar | hbar | pie | donut | scatter | heatmap | gauge',
    'view.body.children[2]: heatmap needs x, y (category paths) and value',
    'view.body.children[3].items[0].value: must be a scalar or a binding { ref, path, agg? }',
    'view.body.children[4].kind: unknown kind "sparkle"; use one of group, tabs, card, table, kv, stats, chart, echarts, timeline, tree, markdown, alert, json',
  ])
  let deep: Record<string, unknown> = { kind: 'markdown', text: 'x' }
  for (let i = 0; i < 8; i++) deep = { kind: 'card', body: deep }
  assert.match(validateView({ body: deep }).join(), /nesting deeper than 6/)
})

test('tables infer columns, one nested level and formats', () => {
  const cols = inferColumns((DATA.r1 as { InstanceSet: JsonValue[] }).InstanceSet)
  assert.deepEqual(cols.map((c) => c.key), ['InstanceId', 'InstanceState', 'CPU', 'Memory', 'CreatedTime', 'Placement.Zone'])
  assert.equal(cols.find((c) => c.key === 'InstanceState')?.format, 'status')
  assert.equal(cols.find((c) => c.key === 'CreatedTime')?.format, 'datetime')
  assert.deepEqual(inferColumns([{ a: 1, empty: null, blank: '', none: [] }, { a: 2, empty: null }]).map((c) => c.key), ['a'])
  const { view, summary } = compile({ kind: 'table', data: { ref: 'r1', path: 'InstanceSet' }, columns: [{ key: 'InstanceId' }, { key: 'Placement.Zone', title: '可用区' }] })
  assert.deepEqual(view.body, {
    kind: 'table', columns: [{ key: 'InstanceId', title: 'InstanceId' }, { key: 'Placement.Zone', title: '可用区' }],
    rows: [['ins-1', 'ap-guangzhou-3'], ['ins-2', 'ap-guangzhou-3'], ['ins-3', 'ap-guangzhou-6']], total: 3, pageSize: 10,
  })
  assert.match(summary[0]!, /3 rows × 2 columns/)
})

test('chart modes: row grouping, series split, columns, row series, pie, scatter, heatmap, gauge', () => {
  const zone = compile({ kind: 'chart', chart: 'bar', data: { ref: 'r1', path: 'InstanceSet' }, x: 'Placement.Zone', y: 'CPU' }).view.body as CompiledChart
  assert.deepEqual(zone.categories, ['ap-guangzhou-3', 'ap-guangzhou-6'])
  assert.deepEqual(zone.series, [{ name: 'CPU', data: [6, 8] }])

  const split = compile({ kind: 'chart', chart: 'bar', stack: true, data: { ref: 'r1', path: 'InstanceSet' }, x: 'Placement.Zone', series: 'InstanceState' }).view.body as CompiledChart
  assert.deepEqual(split.series, [{ name: 'RUNNING', data: [1, 1] }, { name: 'STOPPED', data: [1, null] }])
  assert.equal(split.stack, true)

  const cols = compile({ kind: 'chart', chart: 'line', data: { ref: 'r3' }, x: 'Time', y: ['In', 'Out'] }).view.body as CompiledChart
  assert.deepEqual(cols.series, [{ name: 'In', data: [1, 2, 3] }, { name: 'Out', data: [4, 5, null] }])

  const rs = compile({ kind: 'chart', chart: 'line', data: { ref: 'r2', path: 'DataPoints' }, x: 'Timestamps', y: 'Values', series: 'Dimensions[0].Value' }).view.body as CompiledChart
  assert.deepEqual(rs.categories, [1, 2, 3])
  assert.deepEqual(rs.series, [{ name: 'ins-1', data: [10, 20, 30] }, { name: 'ins-2', data: [5, 6, null] }])

  const pie = compile({ kind: 'chart', chart: 'donut', data: { ref: 'r1', path: 'InstanceSet' }, x: 'InstanceState' }).view.body as CompiledChart
  assert.deepEqual(pie.slices, [{ name: 'RUNNING', value: 2 }, { name: 'STOPPED', value: 1 }])

  const sc = compile({ kind: 'chart', chart: 'scatter', data: { ref: 'r1', path: 'InstanceSet' }, x: 'CPU', y: 'Memory' }).view.body as CompiledChart
  assert.deepEqual(sc.points, [{ name: 'Memory', data: [[2, 4], [4, 8], [8, 16]] }])

  const hm = compile({ kind: 'chart', chart: 'heatmap', data: { ref: 'r1', path: 'InstanceSet' }, x: 'Placement.Zone', y: 'InstanceState' }).view.body as CompiledChart
  assert.deepEqual(hm.cells, [[0, 0, 1], [0, 1, 1], [1, 0, 1]])

  const g = compile({ kind: 'chart', chart: 'gauge', data: { ref: 'r1' }, y: 'TotalCount', max: 10 }).view.body as CompiledChart
  assert.deepEqual(g.gauge, { value: 3, max: 10 })
})

test('maps of objects (multi-region results) become rows with a key', () => {
  const regions = { 'ap-guangzhou': { TotalCount: 18 }, 'ap-tokyo': { error: { code: 'X' } }, 'ap-chengdu': { TotalCount: 97 } }
  const root = { v: 1, body: { kind: 'group', children: [
    { kind: 'chart', chart: 'bar', data: regions, x: 'key', y: 'TotalCount' },
    { kind: 'table', data: regions, columns: [{ key: 'key' }, { key: 'TotalCount' }] },
  ] } } as ViewRoot
  const { view } = compileView(root, { resolve: () => undefined })
  const [chart, table] = (view.body as { children: Record<string, unknown>[] }).children
  assert.deepEqual(chart!.categories, ['ap-guangzhou', 'ap-tokyo', 'ap-chengdu'])
  assert.deepEqual(chart!.series, [{ name: 'TotalCount', data: [18, null, 97] }])
  assert.deepEqual(table!.rows, [['ap-guangzhou', 18], ['ap-tokyo', null], ['ap-chengdu', 97]])
})

test('stats aggregate bindings; kv, timeline and tree compile', () => {
  const { view } = compile({ kind: 'group', children: [
    { kind: 'stats', items: [
      { label: '实例', value: { ref: 'r1', path: 'InstanceSet' } },
      { label: 'CPU', value: { ref: 'r1', path: 'InstanceSet[*].CPU', agg: 'sum' }, unit: '核' },
      { label: '静态', value: 42, tone: 'success' },
    ] },
    { kind: 'kv', data: { ref: 'r1', path: 'InstanceSet[0]' }, items: [{ path: 'InstanceId' }, { label: 'Zone', path: 'Placement.Zone' }] },
    { kind: 'timeline', data: { ref: 'r1', path: 'InstanceSet' }, time: 'CreatedTime', label: 'InstanceId', tone: 'InstanceState' },
    { kind: 'tree', data: [{ name: 'vpc', kids: [{ name: 'subnet-a' }, { name: 'subnet-b' }] }], label: 'name', children: 'kids' },
  ] })
  const [stats, kv, timeline, tree] = (view.body as { children: Record<string, unknown>[] }).children
  assert.deepEqual((stats!.items as { value: unknown }[]).map((i) => i.value), [3, 14, 42])
  assert.deepEqual(kv!.items, [{ label: 'InstanceId', value: 'ins-1' }, { label: 'Zone', value: 'ap-guangzhou-3' }])
  assert.equal((timeline!.items as unknown[]).length, 3)
  assert.equal(tree!.total, 3)
  assert.equal(aggregate([1, '2', 'x', null], 'avg'), 1.5)
})

test('bad bindings produce actionable errors', () => {
  assert.throws(() => compile({ kind: 'table', data: { ref: 'r1', path: 'Instances' } }), (e: unknown) => e instanceof ToolArgsError && /path "Instances" not found in r1/.test(String((e as Error).message)))
  assert.throws(() => compile({ kind: 'table', data: { ref: 'r1' } }), /needs an array .* keys TotalCount, InstanceSet/)
})

test('size limits shrink rows and mark the view truncated', () => {
  const big = Array.from({ length: 5000 }, (_, i) => ({ id: `ins-${i}`, note: 'x'.repeat(100) }))
  const { view } = compileView({ v: 1, body: { kind: 'table', data: big } }, { resolve: () => undefined, maxBytes: 64 * 1024 })
  assert.equal(view.truncated, true)
  const t = view.body as { rows: unknown[]; total: number }
  assert.equal(t.total, 5000)
  assert.ok(t.rows.length < 600 && t.rows.length >= 10)
  assert.ok(JSON.stringify(view).length <= 64 * 1024)
})

test('echarts passthrough drops external resources and binds datasets', () => {
  assert.deepEqual(sanitizeOption({ a: 'image://x', b: 'url(http://x)', c: 'javascript:alert(1)', ['__proto__']: 1, d: ['ok'] } as JsonValue), { a: '', b: '', c: '', d: ['ok'] })
  const { view } = compile({ kind: 'echarts', option: { series: [{ type: 'bar', datasetId: 'vm' }] }, data: { vm: { ref: 'r1', path: 'InstanceSet' } } })
  const opt = (view.body as unknown as { option: { dataset: { id: string; source: unknown[] }[] } }).option
  assert.equal(opt.dataset[0]?.id, 'vm')
  assert.equal(opt.dataset[0]?.source.length, 3)
})
