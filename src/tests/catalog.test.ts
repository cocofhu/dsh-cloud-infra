import assert from 'node:assert/strict'
import { test } from 'node:test'
import { IndexedCatalog, renderDescription, tokenize } from '../core/catalog.js'
import { coerceParams } from '../core/coerce.js'
import { CloudError } from '../core/errors.js'
import { TENCENT_INDEX_DIR } from '../providers/tencent/index.js'

const catalog = new IndexedCatalog(TENCENT_INDEX_DIR)

test('tokenize splits camel case and CJK bigrams', () => {
  assert.deepEqual(tokenize('DescribeInstances'), ['describe', 'instances'])
  assert.deepEqual(tokenize('云服务器'), ['云服', '服务', '务器'])
  assert.deepEqual(tokenize('cvm 实例'), ['cvm', '实例'])
})

test('index covers the main products with a latest version', () => {
  for (const [svc, ver] of [['cvm', '2017-03-12'], ['vpc', '2017-03-12'], ['monitor', '2023-06-16'], ['sts', '2018-08-13'], ['cdb', '2017-03-20']] as const) {
    assert.ok(catalog.hasService(svc), svc)
    assert.equal(catalog.latestVersion(svc), ver)
  }
  assert.equal(catalog.latestVersion('monitor', 'GetMonitorData'), '2018-07-24')
  assert.equal(catalog.latestVersion('cvm', 'DescribeInstances'), '2017-03-12')
  assert.equal(catalog.latestVersion('nope'), undefined)
})

test('search ranks exact and keyword matches', () => {
  const exact = catalog.search('DescribeInstances', { service: 'cvm' })
  assert.equal(exact.hits[0]?.action, 'DescribeInstances')
  const zh = catalog.search('cvm 实例 列表')
  assert.ok(zh.hits.slice(0, 5).some((h) => h.service === 'cvm' && h.action === 'DescribeInstances'), JSON.stringify(zh.hits.slice(0, 5)))
  const monitor = catalog.search('monitor GetMonitorData')
  assert.equal(monitor.hits[0]?.action, 'GetMonitorData')
  assert.equal(monitor.hits[0]?.version, '2018-07-24')
  assert.equal(catalog.describe('monitor', 'GetMonitorData').version, '2018-07-24')
  for (const [q, svc, action] of [['查询云服务器实例', 'cvm', 'DescribeInstances'], ['私有网络列表', 'vpc', 'DescribeVpcs'], ['查询安全组规则', 'vpc', 'DescribeSecurityGroupPolicies'], ['轻量服务器实例', 'lighthouse', 'DescribeInstances'], ['负载均衡 监听器', 'clb', 'DescribeListeners']]) {
    assert.ok(catalog.search(q, { limit: 8 }).hits.some((h) => h.service === svc && h.action === action), `${q} -> ${JSON.stringify(catalog.search(q, { limit: 8 }).hits.map((h) => `${h.service}.${h.action}`))}`)
  }
  const paged = catalog.search('describe', { service: 'cvm', limit: 5, offset: 5 })
  assert.equal(paged.hits.length, 5)
  assert.ok(paged.total > 10)
  assert.throws(() => catalog.search('x', { service: 'cvmm' }), (e: unknown) => e instanceof CloudError && /unknown service/.test(e.message))
})

test('params are coerced to the declared field types', () => {
  const vpc = coerceParams({ Limit: 100, Offset: 0, Filters: [{ Name: 'vpc-name', Values: 'prod' }] }, catalog.describe('vpc', 'DescribeVpcs').params)
  assert.deepEqual(vpc.params, { Limit: '100', Offset: '0', Filters: [{ Name: 'vpc-name', Values: ['prod'] }] })
  assert.deepEqual([...vpc.changed].sort(), ['Filters[0].Values: wrapped in a list', 'Limit: number → string', 'Offset: number → string'])
  const cvm = coerceParams({ Limit: '10', InstanceIds: 'ins-1', Unknown: 1 }, catalog.describe('cvm', 'DescribeInstances').params)
  assert.deepEqual(cvm.params, { Limit: 10, InstanceIds: ['ins-1'], Unknown: 1 })
  const run = coerceParams({ DryRun: 'true', Placement: { Zone: 'ap-guangzhou-3', ProjectId: '0' } }, catalog.describe('cvm', 'RunInstances').params)
  assert.deepEqual(run.params, { DryRun: true, Placement: { Zone: 'ap-guangzhou-3', ProjectId: 0 } })
  assert.deepEqual(coerceParams({ Limit: 'abc' }, catalog.describe('cvm', 'DescribeInstances').params).params, { Limit: 'abc' })
})

test('describe expands nested structures and marks repeats', () => {
  const d = catalog.describe('cvm', 'DescribeInstances')
  assert.equal(d.version, '2017-03-12')
  const filters = d.params.find((p) => p.name === 'Filters')
  assert.equal(filters?.type, 'Filter[]')
  assert.deepEqual(filters?.children?.map((c) => c.name), ['Name', 'Values'])
  assert.ok(d.response.some((r) => r.name === 'InstanceSet'))
  const run = catalog.describe('cvm', 'RunInstances')
  assert.ok(run.params.find((p) => p.name === 'Placement')?.children?.some((c) => c.name === 'Zone' && c.required))
  const text = renderDescription(run, 'write')
  assert.match(text, /^cvm.RunInstances \(version 2017-03-12, write\)/)
  assert.match(text, /- Placement: Placement/)
  assert.match(text, /  - Zone\*: string/)
  assert.throws(() => catalog.describe('cvm', 'DescribeInstance'), /similar: .*DescribeInstances/)
  assert.throws(() => catalog.describe('cvm', 'DescribeInstances', '2000-01-01'), /no version/)
})
