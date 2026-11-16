import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getPath, parsePath } from '../core/json-path.js'
import { ResultStore } from '../core/result-store.js'
import { classify } from '../core/risk.js'
import { truncateJson } from '../core/truncate.js'
import type { JsonValue } from '../core/types.js'
import { TENCENT_PREFIXES } from '../providers/tencent/risk.js'
import { sliceResult } from '../tools/result.js'
import { redact } from '../runtime.js'

const req = (action: string, service = 'cvm') => ({ provider: 'tencent', service, action })

test('tencent risk prefixes', () => {
  assert.equal(classify(req('DescribeInstances'), [], TENCENT_PREFIXES), 'read')
  assert.equal(classify(req('GetMonitorData', 'monitor'), [], TENCENT_PREFIXES), 'read')
  assert.equal(classify(req('InquiryPriceRunInstances'), [], TENCENT_PREFIXES), 'read')
  assert.equal(classify(req('RunInstances'), [], TENCENT_PREFIXES), 'write')
  assert.equal(classify(req('ModifyInstancesAttribute'), [], TENCENT_PREFIXES), 'write')
  assert.equal(classify(req('TerminateInstances'), [], TENCENT_PREFIXES), 'danger')
  assert.equal(classify(req('StopInstances'), [], TENCENT_PREFIXES), 'danger')
  assert.equal(classify(req('ResetInstancesPassword'), [], TENCENT_PREFIXES), 'danger')
  assert.equal(classify(req('ModifyDBInstancePassword', 'cdb'), [], TENCENT_PREFIXES), 'danger')
})

test('risk prefixes match whole words and reject odd names', () => {
  assert.equal(classify(req('Getaway'), [], TENCENT_PREFIXES), 'write')
  assert.equal(classify(req('Listener'), [], TENCENT_PREFIXES), 'write')
  assert.equal(classify(req('describeInstances'), [], TENCENT_PREFIXES), 'write')
  assert.equal(classify(req('Describe Instances'), [], TENCENT_PREFIXES), 'write')
})

test('user risk rules win in order', () => {
  const rules = [
    { provider: 'tencent', service: 'cvm', action: 'RunInstances', level: 'danger' as const },
    { action: 'Describe*', service: 'billing', level: 'write' as const },
  ]
  assert.equal(classify(req('RunInstances'), rules, TENCENT_PREFIXES), 'danger')
  assert.equal(classify(req('DescribeBillDetail', 'billing'), rules, TENCENT_PREFIXES), 'write')
  assert.equal(classify(req('DescribeInstances'), rules, TENCENT_PREFIXES), 'read')
})

test('json path', () => {
  const data: JsonValue = { InstanceSet: [{ InstanceId: 'ins-1', Placement: { Zone: 'ap-guangzhou-3' }, Ips: ['1.1.1.1'] }, { InstanceId: 'ins-2' }] }
  assert.equal(getPath(data, 'InstanceSet[0].Placement.Zone'), 'ap-guangzhou-3')
  assert.deepEqual(getPath(data, 'InstanceSet[*].InstanceId'), ['ins-1', 'ins-2'])
  assert.deepEqual(getPath(data, 'InstanceSet[*].Placement.Zone'), ['ap-guangzhou-3', null])
  assert.equal(getPath(data, 'InstanceSet[0].Ips[0]'), '1.1.1.1')
  assert.equal(getPath(data, 'Missing.Key'), undefined)
  assert.deepEqual(getPath(data, ''), data)
  assert.throws(() => parsePath('a..b['))
})

test('truncate keeps shape and marks elisions', () => {
  const data = { TotalCount: 300, Items: Array.from({ length: 300 }, (_, i) => ({ Id: `id-${i}`, Desc: 'x'.repeat(100) })) }
  const { text, truncated } = truncateJson(data, 4000)
  assert.ok(truncated)
  assert.ok(text.length <= 4000)
  assert.match(text, /TotalCount/)
  assert.match(text, /more, 300 total/)
  const small = truncateJson({ a: 1 }, 100)
  assert.equal(small.truncated, false)
})

test('result store is per session and evicts oldest', () => {
  const store = new ResultStore({ maxEntries: 2, maxBytes: 1e9 })
  const r = { provider: 'tencent', account: 'a', service: 'cvm', action: 'X', params: {} }
  const a = store.put('s1', r, { n: 1 })
  store.put('s1', r, { n: 2 })
  store.put('s1', r, { n: 3 })
  assert.equal(a.ref, 'r1')
  assert.throws(() => store.get('s1', 'r1'), /not available/)
  assert.deepEqual(store.get('s1', 'r3').data, { n: 3 })
  assert.throws(() => store.get('s2', 'r3'), /not available/)
})

test('result slice pages arrays and picks fields', () => {
  const data = { Set: Array.from({ length: 30 }, (_, i) => ({ Id: i, P: { Z: `z${i}` } })) }
  const page = sliceResult(data, { path: 'Set', offset: 25, limit: 10, fields: ['Id', 'P.Z'] })
  assert.equal(page.total, 30)
  assert.deepEqual(page.items, [25, 26, 27, 28, 29].map((i) => ({ Id: i, 'P.Z': `z${i}` })))
  assert.deepEqual(sliceResult(data, { path: 'Set[1].P' }).value, { Z: 'z1' })
})

test('redact masks secret-looking keys', () => {
  assert.deepEqual(redact({ Password: 'p', LoginSettings: { KeyIds: ['k'], Password: 'x' }, Name: 'n' }), {
    Password: '******', LoginSettings: { KeyIds: ['k'], Password: '******' }, Name: 'n',
  })
})
