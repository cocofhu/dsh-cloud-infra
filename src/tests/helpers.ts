import type { CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { withDefaults, type Config } from '../config.js'
import { AccountRegistry } from '../core/accounts.js'
import { ProviderRegistry } from '../core/provider.js'
import { ResultStore } from '../core/result-store.js'
import { installApprovalPolicy } from '../policy/approval.js'
import type { TencentTransport } from '../providers/tencent/client.js'
import { TencentCredentials, type CredentialStore } from '../providers/tencent/credentials.js'
import { TencentProvider } from '../providers/tencent/index.js'
import type { Runtime } from '../runtime.js'
import { accountsTool } from '../tools/accounts.js'
import { apiDescribeTool, apiSearchTool } from '../tools/api.js'
import { callTool } from '../tools/call.js'
import { resultTool } from '../tools/result.js'
import { visualizeTool } from '../tools/visualize.js'

export function memoryStore(): CredentialStore & { records: Map<string, CredentialRecord> } {
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

export interface TestRuntime extends Runtime {
  store: ReturnType<typeof memoryStore>
  credentials: TencentCredentials
}

export function testRuntime(transport: TencentTransport, config: Partial<Config> = {}, tccliDir?: string): TestRuntime {
  const cfg = withDefaults({ accounts: [{ id: 'dev', provider: 'tencent', source: 'store', defaultRegion: 'ap-guangzhou' }], ...config })
  const store = memoryStore()
  const credentials = new TencentCredentials(() => store, tccliDir ? () => tccliDir : undefined)
  const accounts = new AccountRegistry()
  accounts.replace(cfg.accounts)
  const providers = new ProviderRegistry()
  providers.register(new TencentProvider({ credentials, rules: () => cfg.riskRules, timeoutMs: () => cfg.timeoutMs, transport }))
  return { config: () => cfg, providers, accounts, results: new ResultStore(cfg.resultStore), store, credentials }
}

export interface ToolResult {
  isError: boolean
  value?: Record<string, unknown>
  content?: { type: string; text?: string }[]
  meta?: Record<string, unknown>
  error?: { message?: string; info?: { name: string; code: string } }
}

/** Mount the plugin's tools on a real DSH tool runtime around `rt`. */
export async function toolHost(rt: Runtime, approval?: () => Promise<string>) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(NativeToolExecutor)
  if (approval) (ctx as unknown as { provide: (n: string, v: unknown) => void }).provide('approval', { request: approval })
  await ctx.plugin({
    name: 'cloud-infra-test',
    inject: ['tools'],
    apply(c: Context) {
      const reg = (c as unknown as { tools: { register: (t: unknown) => void } }).tools
      for (const t of [accountsTool(rt), apiSearchTool(rt), apiDescribeTool(rt), callTool(rt), resultTool(rt), visualizeTool(rt)]) reg.register(t)
      installApprovalPolicy(c, rt)
    },
  })
  const tools = (ctx as unknown as { tools: { execute: (input: unknown) => Promise<{ results: { result: ToolResult }[] }> } }).tools
  let n = 0
  return {
    ctx,
    async run(name: string, args: unknown): Promise<ToolResult> {
      const out = await tools.execute({
        calls: [{ type: 'tool-call', id: `call-${++n}`, name, arguments: JSON.stringify(args) }],
        signal: new AbortController().signal,
        agent: { id: 'session-1' },
      })
      return out.results[0]!.result
    },
    dispose: () => ctx.fiber.dispose(),
  }
}

export function text(result: ToolResult): string {
  return (result.content ?? []).map((b) => b.text ?? '').join('')
}
