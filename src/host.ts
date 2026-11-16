import type { Context } from '@deepseek-ai/cordis'
import { Config as ConfigSchema, SETTINGS_NS, withDefaults, type Config as PluginConfig } from './config.js'
import { AccountRegistry } from './core/accounts.js'
import { ProviderRegistry } from './core/provider.js'
import { ResultStore } from './core/result-store.js'
import { installApprovalPolicy } from './policy/approval.js'
import { TencentCredentials, type CredentialStore } from './providers/tencent/credentials.js'
import { TencentProvider } from './providers/tencent/index.js'
import type { Runtime } from './runtime.js'
import { accountsTool } from './tools/accounts.js'
import { callTool } from './tools/call.js'
import { resultTool } from './tools/result.js'

export const name = 'cloud-infra'
export const inject = ['tools']
export const Config = ConfigSchema
export type Config = PluginConfig

interface SettingsScope {
  get: () => unknown
  watch: (listener: () => void) => void
}

interface SettingsService {
  register: (ns: string, schema: unknown, options: { base: unknown }) => SettingsScope
}

export const SYSTEM_PROMPT = [
  'Cloud resources: use only the cloud_* tools. Never run tccli or other cloud CLIs through bash; that bypasses user approval.',
  'Call cloud_accounts first when you do not know which account to use. When several accounts exist, pass "account" explicitly.',
  'cloud_call needs the exact lowercase service id, API version (YYYY-MM-DD) and PascalCase action.',
  'Read actions run directly; other actions ask the user for approval. If the user rejects one, do not retry it another way.',
  'Large results are cached under a ref; page them with cloud_result instead of calling the API again.',
].join(' ')

export function apply(ctx: Context, config: Partial<Config>): void {
  let cfg = withDefaults(config)
  let credentialStore: CredentialStore | undefined

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
  ctx.tools.register(callTool(rt))
  ctx.tools.register(resultTool(rt))
  installApprovalPolicy(ctx, rt)

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

  ctx.inject(['settings'], (c) => {
    const settings = (c as unknown as { settings: SettingsService }).settings
    const scope = settings.register(SETTINGS_NS, ConfigSchema, { base: config })
    const sync = () => {
      cfg = withDefaults(scope.get() as Partial<Config>)
      accounts.replace(cfg.accounts)
    }
    sync()
    scope.watch(sync)
  })
}
