import type { Config } from './config.js'
import { AccountRegistry } from './core/accounts.js'
import { ProviderRegistry } from './core/provider.js'
import type { ResultStore } from './core/result-store.js'
import type { AccountConfig, CloudRequest, JsonObject, RiskLevel } from './core/types.js'

export interface Runtime {
  config: () => Config
  providers: ProviderRegistry
  accounts: AccountRegistry
  results: ResultStore
}

export const DEFAULT_PROVIDER = 'tencent'

export interface CallArgs {
  provider?: string
  account?: string
  service: string
  version?: string
  action: string
  region?: string
  params?: JsonObject
}

export interface ResolvedCall {
  request: CloudRequest
  account: AccountConfig
  risk: RiskLevel
}

/** Shared by the pre-execute policy and the tool body so both see the same decision. */
export function resolveCall(rt: Runtime, args: CallArgs): ResolvedCall {
  const providerId = args.provider || DEFAULT_PROVIDER
  const provider = rt.providers.get(providerId)
  const account = rt.accounts.resolve(providerId, args.account)
  const request: CloudRequest = {
    provider: providerId,
    account: account.id,
    service: String(args.service).trim().toLowerCase(),
    version: args.version?.trim() || undefined,
    action: String(args.action).trim(),
    region: args.region?.trim() || undefined,
    params: args.params ?? {},
  }
  return { request, account, risk: provider.classify(request) }
}

const SENSITIVE_KEY = /password|passwd|secret|token|privatekey|credential/i

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = SENSITIVE_KEY.test(k) ? '******' : redact(v)
    return out
  }
  return value
}

export function summarizeParams(params: JsonObject, maxChars = 600): string {
  const text = JSON.stringify(redact(params))
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text
}
