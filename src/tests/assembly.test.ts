import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { withDefaults } from '../config.js'
import * as plugin from '../host.js'

interface BatchResult {
  results: { result: { isError: boolean; value?: unknown; content?: { type: string; text?: string }[]; error?: { info?: { name: string; code: string } } } }[]
}

type ApprovalRequest = { toolName: string; reason?: string; displayReason?: Record<string, string> }

async function setup(approval?: (req: ApprovalRequest) => Promise<string>) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(NativeToolExecutor)
  if (approval) {
    ;(ctx as unknown as { provide: (name: string, value: unknown) => void }).provide('approval', { request: approval })
  }
  await ctx.plugin(plugin, withDefaults({
    accounts: [
      { id: 'prod', provider: 'tencent', source: 'store', readonly: true },
      { id: 'dev', provider: 'tencent', source: 'store' },
    ],
  }))
  return ctx
}

async function run(ctx: Context, name: string, args: unknown): Promise<BatchResult['results'][number]['result']> {
  const tools = (ctx as unknown as { tools: { execute: (input: unknown) => Promise<BatchResult> } }).tools
  const out = await tools.execute({
    calls: [{ type: 'tool-call', id: `call-${name}`, name, arguments: JSON.stringify(args) }],
    signal: new AbortController().signal,
    agent: { id: 'session-1' },
  })
  return out.results[0]!.result
}

function text(result: BatchResult['results'][number]['result']): string {
  return (result.content ?? []).map((b) => b.text ?? '').join('')
}

test('plugin registers its tools in a real tool runtime', async () => {
  const ctx = await setup()
  try {
    const names = (ctx as unknown as { tools: { schemas: () => { name: string }[] } }).tools.schemas().map((s) => s.name)
    for (const name of ['cloud_accounts', 'cloud_api_search', 'cloud_api_describe', 'cloud_call', 'cloud_result', 'cloud_visualize']) assert.ok(names.includes(name), name)
    const prompt = await (ctx as unknown as { systemPrompt: { render?: () => Promise<string> | string } }).systemPrompt.render?.()
    if (typeof prompt === 'string') assert.match(prompt, /cloud_visualize/)
    const accounts = await run(ctx, 'cloud_accounts', {})
    assert.equal(accounts.isError, false)
    assert.match(text(accounts), /prod: tencent · read-only/)
    assert.match(text(accounts), /credential missing/)
  } finally {
    await ctx.fiber.dispose()
  }
})

test('writes route through the approval seam and fail closed without one', async () => {
  const ctx = await setup()
  try {
    const result = await run(ctx, 'cloud_call', { account: 'dev', service: 'cvm', version: '2017-03-12', action: 'RunInstances', params: {} })
    assert.equal(result.isError, true)
    assert.deepEqual(result.error?.info, { name: 'ApprovalError', code: 'APPROVAL_UNAVAILABLE' })
  } finally {
    await ctx.fiber.dispose()
  }
})

test('read-only accounts refuse writes without asking', async () => {
  let asked = 0
  const ctx = await setup(async () => { asked++; return 'allowed-once' })
  try {
    const result = await run(ctx, 'cloud_call', { account: 'prod', service: 'cvm', version: '2017-03-12', action: 'TerminateInstances', params: {} })
    assert.equal(result.isError, true)
    assert.match(text(result), /read-only/)
    assert.equal(asked, 0)
  } finally {
    await ctx.fiber.dispose()
  }
})

test('reads skip approval and surface credential errors', async () => {
  let asked = 0
  const ctx = await setup(async () => { asked++; return 'allowed-once' })
  try {
    const result = await run(ctx, 'cloud_call', { account: 'dev', service: 'cvm', version: '2017-03-12', action: 'DescribeInstances' })
    assert.equal(result.isError, true)
    assert.equal(asked, 0)
    assert.match(text(result), /SecretId\/SecretKey|credentials service/)
  } finally {
    await ctx.fiber.dispose()
  }
})

test('approved writes reach the provider; rejected writes do not', async () => {
  const asked: ApprovalRequest[] = []
  let answer = 'allowed-once'
  const ctx = await setup(async (req) => { asked.push(req); return answer })
  try {
    const args = { account: 'dev', service: 'cvm', version: '2017-03-12', action: 'TerminateInstances', params: { InstanceIds: ['ins-1'] } }
    const approved = await run(ctx, 'cloud_call', args)
    assert.equal(asked.length, 1)
    assert.equal(asked[0]!.toolName, 'cloud_call')
    assert.match(asked[0]!.displayReason?.['zh-CN'] ?? '', /^⚠ 高危操作 · 主动退还实例\ncvm.TerminateInstances · 账号 dev\n/)
    assert.equal(approved.isError, true)
    assert.match(text(approved), /SecretId\/SecretKey|credentials service/)

    answer = 'rejected'
    const rejected = await run(ctx, 'cloud_call', args)
    assert.equal(asked.length, 2)
    assert.deepEqual(rejected.error?.info, { name: 'ApprovalError', code: 'APPROVAL_REJECTED' })
  } finally {
    await ctx.fiber.dispose()
  }
})
