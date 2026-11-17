import { ToolArgsError } from '@deepseek-ai/dsh-tools'
import type { Config } from './config.js'
import type { ApiCatalog } from './core/catalog.js'
import { coerceParams } from './core/coerce.js'
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
export const CALL_TOOL = 'cloud_call'

export interface CallArgs {
  provider?: string
  account?: string
  service: string
  version?: string
  action: string
  region?: string
  regions?: string[]
  params?: JsonObject
}

export interface ResolvedCall {
  request: CloudRequest
  account: AccountConfig
  risk: RiskLevel
  /** Fan-out regions for a read action; absent for single-region calls. */
  regions?: string[]
}

export const MAX_REGIONS = 30

/** Shared by the pre-execute policy and the tool body so both see the same decision. */
export function resolveCall(rt: Runtime, args: CallArgs): ResolvedCall {
  const providerId = args.provider || DEFAULT_PROVIDER
  const provider = rt.providers.get(providerId)
  const account = rt.accounts.resolve(providerId, args.account)
  const service = String(args.service).trim().toLowerCase()
  let version = args.version?.trim() || undefined
  if (!version) {
    try {
      version = provider.catalog.latestVersion(service, String(args.action).trim())
    } catch {
      version = undefined
    }
  }
  const action = String(args.action).trim()
  const request: CloudRequest = {
    provider: providerId,
    account: account.id,
    service,
    version,
    action,
    region: args.region?.trim() || undefined,
    params: typedParams(provider.catalog, service, action, version, args.params ?? {}),
  }
  const risk = provider.classify(request)
  const regions = [...new Set((args.regions ?? []).map((r) => String(r).trim()).filter(Boolean))]
  if (!regions.length) return { request, account, risk }
  if (risk !== 'read') {
    throw new ToolArgsError([`"regions" only works with read actions; ${service}.${request.action} is a ${risk} action, call it once per region with "region"`])
  }
  if (request.region) throw new ToolArgsError(['pass either "region" or "regions", not both'])
  if (regions.length > MAX_REGIONS) throw new ToolArgsError([`at most ${MAX_REGIONS} regions per call`])
  return { request, account, risk, regions }
}

/** Writes on read-only accounts are refused by both the approval policy and the tool body. */
export function readonlyDenial(call: ResolvedCall): string | undefined {
  if (call.risk === 'read' || !call.account.readonly) return undefined
  return `account "${call.account.id}" is read-only; ${call.request.service}.${call.request.action} is a ${call.risk} operation and was refused. Do not try to work around this.`
}

function typedParams(catalog: ApiCatalog, service: string, action: string, version: string | undefined, params: JsonObject): JsonObject {
  let nodes
  try {
    nodes = catalog.describe(service, action, version).params
  } catch {
    return params
  }
  return coerceParams(params, nodes).params
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
