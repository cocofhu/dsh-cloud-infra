import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { CloudError } from '../core/errors.js'
import type { AccountConfig } from '../core/types.js'
import type { TencentInvocation, TencentTransport } from '../providers/tencent/client.js'
import { TencentCredentials, storeKey, type CredentialStore } from '../providers/tencent/credentials.js'
import { TencentProvider } from '../providers/tencent/index.js'

function memoryStore(): CredentialStore & { records: Map<string, CredentialRecord> } {
  const records = new Map<string, CredentialRecord>()
  return {
    records,
    readRecord: async (key) => records.get(key),
    describeRecord: async (key) => ({ configured: records.has(key), writable: true }),
    modifyRecord: async (key, mutate) => {
      const next = await mutate(records.get(key))
      if (next) records.set(key, next)
      return records.get(key)
    },
    deleteRecord: async (key) => { records.delete(key) },
  }
}

async function tccliDir(files: Record<string, unknown>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tccli-'))
  for (const [name, body] of Object.entries(files)) await writeFile(join(dir, name), JSON.stringify(body))
  return dir
}

const storeAccount: AccountConfig = { id: 'prod', provider: 'tencent', source: 'store', defaultRegion: 'ap-guangzhou' }

function provider(transport: TencentTransport, store = memoryStore()) {
  const credentials = new TencentCredentials(() => store)
  return new TencentProvider({ credentials, rules: () => [], timeoutMs: () => 5000, transport })
}

test('store credentials round trip with masking', async () => {
  const store = memoryStore()
  const creds = new TencentCredentials(() => store)
  await creds.save('prod', { secretId: 'AKIDabcdefghijkl1234', secretKey: 'sk' })
  assert.equal(store.records.get(storeKey('prod'))?.kind, 'api-key')
  assert.deepEqual(await creds.resolve(storeAccount), { secretId: 'AKIDabcdefghijkl1234', secretKey: 'sk', token: undefined })
  assert.deepEqual(await creds.describe(storeAccount), { configured: true, masked: 'AKID****1234' })
  await creds.remove('prod')
  const missing = await creds.describe(storeAccount)
  assert.equal(missing.configured, false)
  assert.match(missing.detail ?? '', /no stored SecretId/)
})

test('tccli profiles: credential, region, temporary and unsupported types', async () => {
  const dir = await tccliDir({
    'default.credential': { secretId: 'AKIDdefault000001', secretKey: 'k1' },
    'default.configure': { _sys_param: { region: 'ap-shanghai', output: 'json' } },
    'sso.credential': { secretId: 'AKIDtmp', secretKey: 'k2', token: 't', type: 'sso', expiresAt: Date.now() / 1000 - 10 },
    'role.credential': { type: 'cvm-role' },
  })
  const creds = new TencentCredentials(() => undefined, () => dir)
  const account = (tccliProfile: string): AccountConfig => ({ id: 'x', provider: 'tencent', source: 'tccli', tccliProfile })

  assert.equal((await creds.resolve(account('default'))).secretKey, 'k1')
  assert.equal(await creds.tccliRegion('default'), 'ap-shanghai')
  await assert.rejects(creds.resolve(account('sso')), /expired sso credential/)
  await assert.rejects(creds.resolve(account('role')), /CVM role/)
  await assert.rejects(creds.resolve(account('missing')), /not found/)
  await assert.rejects(creds.resolve(account('../etc/passwd')), /invalid tccli profile/)
  assert.deepEqual((await creds.listTccliProfiles()).map((p) => p.name), ['default', 'role', 'sso'])
})

test('call strips the envelope and passes region, version and endpoint', async () => {
  const store = memoryStore()
  await new TencentCredentials(() => store).save('prod', { secretId: 'AKIDx', secretKey: 'k' })
  let seen: TencentInvocation | undefined
  const p = provider(async (inv) => { seen = inv; return { RequestId: 'req-1', TotalCount: 1, InstanceSet: [] } }, store)
  const res = await p.call(
    { provider: 'tencent', account: 'prod', service: 'cvm', version: '2017-03-12', action: 'DescribeInstances', params: { Limit: 1 } },
    storeAccount,
    new AbortController().signal,
  )
  assert.equal(res.requestId, 'req-1')
  assert.deepEqual(res.data, { TotalCount: 1, InstanceSet: [] })
  assert.equal(seen?.endpoint, 'cvm.tencentcloudapi.com')
  assert.equal(seen?.region, 'ap-guangzhou')
  assert.equal(seen?.secret.secretId, 'AKIDx')
})

test('version defaults to the newest in the API index; unknown services still need one', async () => {
  const store = memoryStore()
  await new TencentCredentials(() => store).save('prod', { secretId: 'AKIDx', secretKey: 'k' })
  let seen: TencentInvocation | undefined
  const p = provider(async (inv) => { seen = inv; return {} }, store)
  await p.call({ provider: 'tencent', account: 'prod', service: 'cvm', action: 'DescribeInstances', params: {} }, storeAccount, new AbortController().signal)
  assert.equal(seen?.version, '2017-03-12')
  await assert.rejects(
    p.call({ provider: 'tencent', account: 'prod', service: 'nosuchproduct', action: 'DescribeX', params: {} }, storeAccount, new AbortController().signal),
    (err: unknown) => err instanceof CloudError && err.code === 'CLOUD_INVALID_PARAMETER',
  )
})

function sdkError(code: string, message = 'boom') {
  return Object.assign(new Error(message), { name: 'TencentCloudSDKHttpException', code, requestId: 'req-e' })
}

test('throttled reads retry, writes do not', async () => {
  const store = memoryStore()
  await new TencentCredentials(() => store).save('prod', { secretId: 'AKIDx', secretKey: 'k' })
  let calls = 0
  const p = provider(async () => {
    calls++
    if (calls < 2) throw sdkError('RequestLimitExceeded')
    return { RequestId: 'ok' }
  }, store)
  const base = { provider: 'tencent', account: 'prod', service: 'cvm', version: '2017-03-12', params: {} }
  await p.call({ ...base, action: 'DescribeInstances' }, storeAccount, new AbortController().signal)
  assert.equal(calls, 2)

  calls = 0
  await assert.rejects(
    p.call({ ...base, action: 'RunInstances' }, storeAccount, new AbortController().signal),
    (err: unknown) => err instanceof CloudError && err.code === 'CLOUD_THROTTLED',
  )
  assert.equal(calls, 1)
})

test('sdk error codes map to cloud error codes', async () => {
  const store = memoryStore()
  await new TencentCredentials(() => store).save('prod', { secretId: 'AKIDx', secretKey: 'k' })
  const cases: [string, string][] = [
    ['AuthFailure.SignatureFailure', 'CLOUD_AUTH_FAILED'],
    ['AuthFailure.UnauthorizedOperation', 'CLOUD_PERMISSION_DENIED'],
    ['UnauthorizedOperation', 'CLOUD_PERMISSION_DENIED'],
    ['InvalidParameterValue.Limit', 'CLOUD_INVALID_PARAMETER'],
    ['InvalidAction', 'CLOUD_NOT_FOUND'],
    ['InternalError', 'CLOUD_UPSTREAM'],
  ]
  for (const [sdkCode, code] of cases) {
    const p = provider(async () => { throw sdkError(sdkCode) }, store)
    await assert.rejects(
      p.call({ provider: 'tencent', account: 'prod', service: 'cvm', version: '2017-03-12', action: 'DescribeX', params: {} }, storeAccount, new AbortController().signal),
      (err: unknown) => err instanceof CloudError && err.code === code && err.upstream?.requestId === 'req-e',
      sdkCode,
    )
  }
})

test('abort propagates as AbortError', async () => {
  const store = memoryStore()
  await new TencentCredentials(() => store).save('prod', { secretId: 'AKIDx', secretKey: 'k' })
  const ac = new AbortController()
  const p = provider(async (inv) => {
    ac.abort()
    inv.signal.throwIfAborted()
    return {}
  }, store)
  await assert.rejects(
    p.call({ provider: 'tencent', account: 'prod', service: 'cvm', version: '2017-03-12', action: 'DescribeInstances', params: {} }, storeAccount, ac.signal),
    { name: 'AbortError' },
  )
})
