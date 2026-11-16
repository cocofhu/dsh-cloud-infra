import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CloudError, CloudErrorCode } from '../core/errors.js'
import type { TencentInvocation } from '../providers/tencent/client.js'
import { text, testRuntime, toolHost } from './helpers.js'

const INSTANCES = {
  RequestId: 'req-1',
  TotalCount: 2,
  InstanceSet: [
    { InstanceId: 'ins-1', InstanceState: 'RUNNING', Placement: { Zone: 'ap-guangzhou-3' } },
    { InstanceId: 'ins-2', InstanceState: 'STOPPED', Placement: { Zone: 'ap-guangzhou-6' } },
  ],
}

test('search, describe, call and visualize work end to end on the tool runtime', async () => {
  const seen: TencentInvocation[] = []
  const rt = testRuntime(async (inv) => { seen.push(inv); return structuredClone(INSTANCES) })
  await rt.credentials.save('dev', { secretId: 'AKIDtest0001', secretKey: 'secretkey01' })
  const host = await toolHost(rt)
  try {
    const search = await host.run('cloud_api_search', { query: '查询实例列表', service: 'cvm', limit: 5 })
    assert.equal(search.isError, false, text(search))
    assert.match(text(search), /^- cvm 2017-03-12 DescribeInstances \[read\]/m)

    const describe = await host.run('cloud_api_describe', { service: 'cvm', action: 'DescribeInstances' })
    assert.match(text(describe), /- Filters: Filter\[\]/)

    const call = await host.run('cloud_call', { service: 'cvm', action: 'DescribeInstances', params: { Limit: '10', InstanceIds: 'ins-1' } })
    assert.equal(call.isError, false, text(call))
    assert.deepEqual(seen[0]?.params, { Limit: 10, InstanceIds: ['ins-1'] })
    assert.equal(seen[0]?.version, '2017-03-12')
    assert.equal(seen[0]?.region, 'ap-guangzhou')
    assert.match(text(call), /cvm.DescribeInstances ok · ref=r1 · account=dev · version=2017-03-12/)
    assert.equal(call.meta?.kind, 'cloud-call')
    assert.equal(call.meta?.requestId, 'req-1')

    const view = await host.run('cloud_visualize', { view: {
      title: '实例',
      items: [
        { kind: 'stats', items: [{ label: '总数', value: { ref: 'r1', path: 'TotalCount' } }] },
        { kind: 'table', data: { ref: 'r1', path: 'InstanceSet' } },
        { kind: 'chart', chart: 'pie', data: { ref: 'r1', path: 'InstanceSet' }, x: 'InstanceState' },
      ],
    } })
    assert.equal(view.isError, false, text(view))
    assert.match(text(view), /Rendered "实例" for the user:\n- table: 2 rows × 3 columns \(InstanceId, InstanceState, Placement.Zone\)/)
    const meta = view.meta as { kind: string; view: { v: number; body: { children: { kind: string }[] } } }
    assert.equal(meta.kind, 'cloud-view')
    assert.deepEqual(meta.view.body.children.map((c) => c.kind), ['stats', 'table', 'chart'])

    const aliased = await host.run('cloud_visualize', { view: { items: [{ type: 'tabs', tabs: [{ label: 'a', items: [{ type: 'kv', data: { type: 'kept' } }] }] }] } })
    assert.equal(aliased.isError, false, text(aliased))
    assert.deepEqual((aliased.meta as { view: { body: unknown } }).view.body, { kind: 'group', children: [
      { kind: 'tabs', tabs: [{ label: 'a', body: { kind: 'group', children: [{ kind: 'kv', items: [{ label: 'type', value: 'kept' }] }] } }] },
    ] })

    const bad = await host.run('cloud_visualize', { view: { items: [{ kind: 'table', data: { ref: 'r9' } }] } })
    assert.equal(bad.isError, true)
    assert.match(text(bad), /r9/)
  } finally {
    await host.dispose()
  }
})

test('regions fan out reads, keep partial failures and refuse writes', async () => {
  const rt = testRuntime(async (inv) => {
    if (inv.region === 'ap-tokyo') throw new CloudError(CloudErrorCode.UPSTREAM, 'region unavailable', { upstream: { code: 'UnsupportedRegion' } })
    return { RequestId: `req-${inv.region}`, TotalCount: inv.region === 'ap-guangzhou' ? 2 : 0, InstanceSet: [] }
  })
  await rt.credentials.save('dev', { secretId: 'AKIDtest0001', secretKey: 'secretkey01' })
  let asked = 0
  const host = await toolHost(rt, async () => { asked++; return 'allowed-once' })
  try {
    const res = await host.run('cloud_call', { service: 'cvm', action: 'DescribeInstances', regions: ['ap-guangzhou', 'ap-shanghai', 'ap-tokyo', 'ap-guangzhou'] })
    assert.equal(res.isError, false, text(res))
    const value = res.value as { regions: string[]; failedRegions: string[]; data: Record<string, { TotalCount?: number; error?: { code: string } }> }
    assert.deepEqual(value.regions, ['ap-guangzhou', 'ap-shanghai', 'ap-tokyo'])
    assert.deepEqual(value.failedRegions, ['ap-tokyo'])
    assert.equal(value.data['ap-guangzhou']?.TotalCount, 2)
    assert.equal(value.data['ap-tokyo']?.error?.code, 'UnsupportedRegion')
    assert.match(text(res), /regions=3 \(failed: ap-tokyo\)/)

    const chart = await host.run('cloud_visualize', { view: { items: [{ kind: 'chart', chart: 'bar', data: { ref: 'r1' }, x: 'key', y: 'TotalCount' }] } })
    assert.equal(chart.isError, false, text(chart))
    assert.match(text(chart), /1 series × 3 points/)

    const write = await host.run('cloud_call', { service: 'cvm', action: 'StopInstances', regions: ['ap-guangzhou'] })
    assert.equal(write.isError, true)
    assert.match(text(write), /"regions" only works with read actions/)
    assert.equal(asked, 0)

    const allFail = await host.run('cloud_call', { service: 'cvm', action: 'DescribeInstances', regions: ['ap-tokyo'] })
    assert.equal(allFail.isError, true)
    assert.match(text(allFail), /region unavailable/)
  } finally {
    await host.dispose()
  }
})

test('cloud_result pages a cached call', async () => {
  const rt = testRuntime(async () => ({ RequestId: 'r', InstanceSet: Array.from({ length: 30 }, (_, i) => ({ InstanceId: `ins-${i}`, CPU: i })) }))
  await rt.credentials.save('dev', { secretId: 'AKIDtest0001', secretKey: 'secretkey01' })
  const host = await toolHost(rt)
  try {
    await host.run('cloud_call', { service: 'cvm', action: 'DescribeInstances' })
    const page = await host.run('cloud_result', { ref: 'r1', path: 'InstanceSet', offset: 10, limit: 2, fields: ['InstanceId'] })
    assert.equal(page.isError, false, text(page))
    assert.match(text(page), /ins-10/)
    assert.doesNotMatch(text(page), /"CPU"/)
  } finally {
    await host.dispose()
  }
})
