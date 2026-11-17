import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { withDefaults } from '../config.js'
import { AccountRegistry } from '../core/accounts.js'
import { ProviderRegistry } from '../core/provider.js'
import { ResultStore } from '../core/result-store.js'
import { decide } from '../policy/approval.js'
import { TencentCredentials } from '../providers/tencent/credentials.js'
import { TencentProvider } from '../providers/tencent/index.js'
import type { Runtime } from '../runtime.js'

function runtime(): Runtime {
  const cfg = withDefaults({
    accounts: [
      { id: 'prod', provider: 'tencent', source: 'store', readonly: true, defaultRegion: 'ap-guangzhou' },
      { id: 'dev', provider: 'tencent', source: 'store' },
    ],
  })
  const accounts = new AccountRegistry()
  accounts.replace(cfg.accounts)
  const providers = new ProviderRegistry()
  providers.register(new TencentProvider({
    credentials: new TencentCredentials(() => undefined),
    rules: () => cfg.riskRules,
    timeoutMs: () => cfg.timeoutMs,
  }))
  return { config: () => cfg, providers, accounts, results: new ResultStore(cfg.resultStore) }
}

const exec = (args: unknown, name = 'cloud_call') => ({ name, arguments: args }) as unknown as ToolExecution

test('reads pass through to the next policy', () => {
  assert.equal(decide(runtime(), exec({ account: 'dev', service: 'cvm', action: 'DescribeInstances' })), undefined)
})

test('writes ask with a redacted summary', () => {
  const decision = decide(runtime(), exec({
    account: 'dev', service: 'cvm', action: 'ResetInstancesPassword', region: 'ap-shanghai',
    params: { InstanceIds: ['ins-1'], Password: 'hunter2' },
  }))
  assert.equal(decision?.kind, 'ask')
  if (decision?.kind !== 'ask') return
  assert.match(decision.reason ?? '', /HIGH-RISK cloud API call cvm.ResetInstancesPassword on tencent account dev \/ ap-shanghai/)
  assert.doesNotMatch(decision.reason ?? '', /hunter2/)
  const zh = decision.displayReason?.['zh-CN'] ?? ''
  assert.equal(zh, '⚠ 高危操作 · 将实例操作系统的密码重置为用户指定的密码（cvm.ResetInstancesPassword，账号 dev，地域 ap-shanghai）\n'
    + '· 一个或多个待操作的实例ID：ins-1\n· 重置后的实例登录密码：******')
  assert.match(decision.displayReason?.en ?? '', /\n· Instance ids: ins-1\n· Password: \*{6}$/)
})

test('writes on read-only accounts are denied before approval', () => {
  const decision = decide(runtime(), exec({ account: 'prod', service: 'cvm', action: 'RunInstances' }))
  assert.equal(decision?.kind, 'deny')
})

test('other tools and unresolved accounts are left to the tool body', () => {
  assert.equal(decide(runtime(), exec({ service: 'cvm', action: 'RunInstances' }, 'bash')), undefined)
  assert.equal(decide(runtime(), exec({ service: 'cvm', action: 'RunInstances' })), undefined)
  assert.equal(decide(runtime(), exec({ account: 'nope', service: 'cvm', action: 'RunInstances' })), undefined)
})

test('approval text explains enum values from the API docs', () => {
  const decision = decide(runtime(), exec({
    account: 'dev', service: 'ssl', action: 'ApplyCertificate',
    params: { DvAuthMethod: 'DNS_AUTO', DomainName: 'example.com', PackageType: '83' },
  }))
  assert.equal(decision?.kind, 'ask')
  if (decision?.kind !== 'ask') return
  assert.equal(decision.displayReason?.['zh-CN'], '写操作 · 免费证书申请（ssl.ApplyCertificate，账号 dev）\n'
    + '· 证书域名验证方式：DNS_AUTO（自动添加域名DNS验证）\n· 证书绑定的域名：example.com\n· 证书类型：83（TrustAsia C1 DV Free）')
})
