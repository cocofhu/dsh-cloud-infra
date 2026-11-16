import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { withDefaults } from '../config.js'
import type { AccountConfig } from '../core/types.js'
import { storeKey } from '../providers/tencent/credentials.js'
import { createApiHandler, dispatch, parseAccount, type ApiDeps } from '../web/api.js'
import { testRuntime } from './helpers.js'

async function deps(opts: { writable?: boolean } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'tccli-'))
  await writeFile(join(dir, 'default.credential'), JSON.stringify({ secretId: 'AKIDtccli01', secretKey: 'k' }))
  await writeFile(join(dir, 'default.configure'), JSON.stringify({ _sys_param: { region: 'ap-shanghai' } }))
  const rt = testRuntime(async () => ({ RequestId: 'req-t', Arn: 'qcs::cam::uin/100:uin/100', UserId: '100', AccountId: '100' }), { accounts: [] }, dir)
  const saved: AccountConfig[][] = []
  const d: ApiDeps = {
    rt,
    tencentCredentials: rt.credentials,
    saveAccounts: () => (opts.writable === false ? undefined : async (next) => { saved.push(next) }),
  }
  return { d, rt, saved }
}

test('volatile config values are unwrapped and copied', () => {
  const accounts = [{ id: 'a', provider: 'tencent' as const, source: 'store' as const }]
  const cfg = withDefaults({ accounts: { get: () => accounts } as never, timeoutMs: { get: () => 5000 } as never })
  assert.deepEqual(cfg.accounts, accounts)
  assert.notEqual(cfg.accounts[0], accounts[0])
  assert.equal(cfg.timeoutMs, 5000)
  assert.equal(withDefaults({ maxOutputChars: -1 }).maxOutputChars, 16000)
})

test('parseAccount normalizes and rejects bad input', () => {
  assert.deepEqual(parseAccount({ id: 'prod', source: 'tccli', defaultRegion: ' ap-guangzhou ', readonly: true }), {
    id: 'prod', provider: 'tencent', source: 'tccli', defaultRegion: 'ap-guangzhou', readonly: true, tccliProfile: 'default',
  })
  assert.throws(() => parseAccount({ id: 'Prod' }), /account id/)
  assert.throws(() => parseAccount({ id: 'p', provider: 'aws' }), /unsupported provider/)
  assert.throws(() => parseAccount({ id: 'p', defaultRegion: 'guangzhou!' }), /invalid region/)
  assert.throws(() => parseAccount({ id: 'p', source: 'tccli', tccliProfile: '../x' }), /invalid tccli profile/)
})

test('accounts save, rename, test and remove through dispatch', async () => {
  const { d, rt, saved } = await deps()
  const empty = await dispatch(d, 'state', {}) as { accounts: unknown[]; tccliProfiles: { name: string }[]; writable: boolean }
  assert.deepEqual(empty.accounts, [])
  assert.deepEqual(empty.tccliProfiles.map((p) => p.name), ['default'])
  assert.equal(empty.writable, true)

  await dispatch(d, 'accounts.save', { account: { id: 'prod', defaultRegion: 'ap-guangzhou' }, secret: { secretId: 'AKIDabcdefgh1234', secretKey: 'secretkey1234' } })
  assert.ok(rt.store.records.has(storeKey('prod')))
  assert.deepEqual(saved.at(-1)?.map((a) => a.id), ['prod'])
  const state = await dispatch(d, 'state', {}) as { accounts: { id: string; credential: { configured: boolean; masked?: string } }[] }
  assert.equal(state.accounts[0]?.credential.configured, true)
  assert.equal(state.accounts[0]?.credential.masked, 'AKID****1234')
  assert.doesNotMatch(JSON.stringify(state), /secretkey1234/)

  await assert.rejects(dispatch(d, 'accounts.save', { account: { id: 'prod' } }), /already exists/)
  await assert.rejects(dispatch(d, 'accounts.save', { account: { id: 'x' }, secret: { secretId: 'bad id', secretKey: 'k' } }), /malformed/)
  await assert.rejects(dispatch(d, 'accounts.save', { account: { id: 'prod2' }, originalId: 'prod' }), /needs the SecretId/)

  await dispatch(d, 'accounts.save', { account: { id: 'local', source: 'tccli' } })
  const test = await dispatch(d, 'accounts.test', { id: 'local' }) as { test: { ok: boolean; identity?: string } }
  assert.equal(test.test.ok, true, JSON.stringify(test))

  await dispatch(d, 'accounts.remove', { id: 'prod' })
  assert.ok(!rt.store.records.has(storeKey('prod')))
  assert.deepEqual(rt.accounts.list().map((a) => a.id), ['local'])
  await assert.rejects(dispatch(d, 'nope', {}), /unknown method/)
})

test('writes fail clearly without the settings service', async () => {
  const { d } = await deps({ writable: false })
  await assert.rejects(dispatch(d, 'accounts.save', { account: { id: 'p', source: 'tccli' } }), /settings service is not available/)
})

test('http handler requires POST, JSON and same origin', async () => {
  const { d } = await deps()
  const server = createServer(createApiHandler(d))
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const post = (body: string, headers: Record<string, string> = {}) =>
    fetch(base, { method: 'POST', body, headers: { 'content-type': 'application/json', ...headers } })
  try {
    assert.equal((await fetch(base)).status, 405)
    assert.equal((await fetch(base, { method: 'POST', body: '{}', headers: { 'content-type': 'text/plain' } })).status, 415)
    assert.equal((await post('{"method":"state"}', { origin: 'https://evil.example' })).status, 403)
    assert.equal((await post('[1]')).status, 400)
    assert.equal((await post('x'.repeat(70_000))).status, 413)
    const ok = await post('{"method":"state"}', { origin: base })
    assert.equal(ok.status, 200)
    assert.equal(((await ok.json()) as { ok: boolean }).ok, true)
  } finally {
    server.close()
  }
})
