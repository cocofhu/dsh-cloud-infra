import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { Config as ConfigSchema, withDefaults, type Config as PluginConfig } from './config.js'
import { AccountRegistry } from './core/accounts.js'
import { ProviderRegistry } from './core/provider.js'
import { ResultStore } from './core/result-store.js'
import type { AccountConfig } from './core/types.js'
import { installApprovalPolicy } from './policy/approval.js'
import { TencentCredentials, type CredentialStore } from './providers/tencent/credentials.js'
import { TencentProvider } from './providers/tencent/index.js'
import type { Runtime } from './runtime.js'
import { accountsTool } from './tools/accounts.js'
import { apiDescribeTool, apiSearchTool } from './tools/api.js'
import { callTool } from './tools/call.js'
import { resultTool } from './tools/result.js'
import { visualizeTool } from './tools/visualize.js'
import { API_PATH, createApiHandler } from './web/api.js'
import { createStaticHandler, DESIGN_DIR, DESIGN_PATH } from './web/static.js'

export const name = 'cloud-infra'
export const inject = ['tools']
export const Config = ConfigSchema
export type Config = PluginConfig

interface SettingsService {
  update: (ns: string, patch: object) => Promise<void>
  configure?: (presentation: { auto?: boolean }, owner?: unknown) => () => void
}

interface WebServerService {
  register: (route: { kind: 'exact' | 'prefix'; path: string; handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void> }) => () => void
}

export const SYSTEM_PROMPT = [
  'Cloud resources: use only the cloud_* tools. Never run tccli or other cloud CLIs through bash; that bypasses user approval.',
  'Call cloud_accounts first when you do not know which account to use. When several accounts exist, pass "account" explicitly.',
  'When unsure of the product id, action or parameters, look them up with cloud_api_search and cloud_api_describe instead of guessing.',
  'cloud_call takes the lowercase service id and PascalCase action; version defaults to the newest. For the same read action across regions use "regions".',
  'Read actions run directly; other actions ask the user for approval. If the user rejects one, do not retry it another way.',
  'Large results are cached under a ref; page them with cloud_result instead of calling the API again.',
  'When a table, chart or summary would help the user (resource lists, comparisons, distributions, trends), call cloud_visualize and bind the raw result by ref — its charts and stats group, count and sum by themselves, so do not copy cloud data into bash or files to aggregate it. For simple answers reply in text.',
].join(' ')

export function apply(ctx: Context, config: Partial<Config>): void {
  let cfg = withDefaults(config)
  let credentialStore: CredentialStore | undefined
  let settings: SettingsService | undefined

  const accounts = new AccountRegistry()
  accounts.replace(cfg.accounts)
  const providers = new ProviderRegistry()
  const rt: Runtime = {
    config: () => cfg,
    providers,
    accounts,
    results: new ResultStore(cfg.resultStore),
  }

  const tencentCredentials = new TencentCredentials(
    () => credentialStore,
    cfg.tencent.tccliDir ? () => cfg.tencent.tccliDir! : undefined,
  )
  providers.register(new TencentProvider({
    credentials: tencentCredentials,
    rules: () => cfg.riskRules,
    timeoutMs: () => cfg.timeoutMs,
    endpoints: () => cfg.tencent.endpoints,
  }))

  ctx.tools.register(accountsTool(rt))
  ctx.tools.register(apiSearchTool(rt))
  ctx.tools.register(apiDescribeTool(rt))
  ctx.tools.register(callTool(rt))
  ctx.tools.register(resultTool(rt))
  ctx.tools.register(visualizeTool(rt))
  installApprovalPolicy(ctx, rt)

  const on = ctx.on.bind(ctx) as unknown as (name: string, listener: () => void) => void
  on('loader/volatile-update', () => {
    cfg = withDefaults(config)
    accounts.replace(cfg.accounts)
  })

  ctx.inject(['credentials'], (c) => {
    const store = (c as unknown as { credentials: CredentialStore }).credentials
    credentialStore = store
    c.effect(() => () => {
      if (credentialStore === store) credentialStore = undefined
    })
  })

  ctx.inject(['systemPrompt'], (c) => {
    const prompt = (c as unknown as { systemPrompt: { section: (s: { name: string; order: number; text: string }) => void } }).systemPrompt
    prompt.section({ name: 'tool:cloud-infra', order: 120, text: SYSTEM_PROMPT })
  })

  const entryId = (ctx as unknown as { fiber?: { entry?: { options?: { id?: string } } } }).fiber?.entry?.options?.id
  ctx.inject(['settings'], (c) => {
    const service = (c as unknown as { settings: SettingsService }).settings
    settings = service
    if (typeof service.configure === 'function') c.effect(() => service.configure!({ auto: false }, ctx.fiber))
    c.effect(() => () => {
      if (settings === service) settings = undefined
    })
  })

  ctx.inject(['webServer'], (c) => {
    const server = (c as unknown as { webServer: WebServerService }).webServer
    const handler = createApiHandler({
      rt,
      tencentCredentials,
      saveAccounts: () => {
        const service = settings
        if (!service || !entryId) return undefined
        return async (next: AccountConfig[]) => { await service.update(entryId, { accounts: next }) }
      },
    })
    c.effect(() => server.register({ kind: 'exact', path: API_PATH, handler }))
    c.effect(() => server.register({ kind: 'prefix', path: DESIGN_PATH, handler: createStaticHandler(DESIGN_PATH, DESIGN_DIR) }))
  })
}
