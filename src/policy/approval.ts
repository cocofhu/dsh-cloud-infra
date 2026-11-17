import type { Context } from '@deepseek-ai/cordis'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import { CloudErrorCode } from '../core/errors.js'
import type { ApiCatalog } from '../core/catalog.js'
import type { JsonValue } from '../core/types.js'
import { redact, resolveCall, summarizeParams, type CallArgs, type ResolvedCall, type Runtime } from '../runtime.js'

export const CALL_TOOL = 'cloud_call'

const LEVEL_TEXT = {
  write: { en: 'write', title: 'Write', zh: '写操作' },
  danger: { en: 'HIGH-RISK', title: '⚠ HIGH-RISK', zh: '⚠ 高危操作' },
} as const

const MAX_PARAM_LINES = 10
const MAX_VALUE_CHARS = 60
const MAX_LIST_ITEMS = 5

function clip(text: string): string {
  return text.length > MAX_VALUE_CHARS ? `${text.slice(0, MAX_VALUE_CHARS)}…` : text
}

/** Meaning of an enum value from its doc, e.g. "DNS_AUTO： 自动添加域名DNS验证，…" or "83 = TrustAsia C1 DV Free。". */
function enumMeaning(doc: string | undefined, value: string): string | undefined {
  if (!doc || !value) return undefined
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`(?:^|[\\s，,。；;、(（])${escaped}\\s*[:：=]\\s*([^，,。；;\\n]{1,24})`).exec(doc)
  return match?.[1]?.trim() || undefined
}

function displayValue(value: unknown, doc: string | undefined, zh: boolean): string {
  if (Array.isArray(value) && value.every((v) => v === null || typeof v !== 'object')) {
    const shown = value.slice(0, MAX_LIST_ITEMS).map(String).join(zh ? '、' : ', ')
    const more = value.length - MAX_LIST_ITEMS
    return clip(more > 0 ? (zh ? `${shown} 等 ${value.length} 个` : `${shown} and ${more} more`) : shown || (zh ? '（空）' : '(empty)'))
  }
  if (typeof value === 'object' && value !== null) return clip(JSON.stringify(value))
  const text = clip(String(value))
  const meaning = zh ? enumMeaning(doc, String(value)) : undefined
  return meaning ? `${text}（${meaning}）` : text
}

/** First clause of a Chinese parameter doc, e.g. "证书绑定的域名。" -> "证书绑定的域名". */
function docLabel(doc: string | undefined): string | undefined {
  const head = doc?.trim().split(/[，,。：:；;（(\s]/)[0] ?? ''
  return head.length >= 2 && head.length <= 16 && /[\u4e00-\u9fff]/.test(head) ? head : undefined
}

/** "DvAuthMethod" -> "Dv auth method"; acronyms such as "TTL" stay as they are. */
function humanize(name: string): string {
  const words = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(' ')
  return words.map((w, i) => (i === 0 || /^[A-Z0-9]+$/.test(w) ? w : w.toLowerCase())).join(' ')
}

function actionSummary(catalog: ApiCatalog, service: string, action: string): string | undefined {
  try {
    const hit = catalog.search(action, { service, limit: 5 }).hits.find((h) => h.action === action)
    const summary = hit?.summary.trim().split(/[\s。]/)[0]
    return summary || undefined
  } catch {
    return undefined
  }
}

function paramLines(catalog: ApiCatalog | undefined, call: ResolvedCall, zh: boolean): string[] {
  const { service, action, version, params } = call.request
  let docs = new Map<string, string | undefined>()
  try {
    if (catalog) docs = new Map(catalog.describe(service, action, version).params.map((p) => [p.name, p.doc]))
  } catch {
    // Unknown actions still get their raw parameter names.
  }
  const entries = Object.entries(redact(params) as Record<string, JsonValue>)
  const out = entries.slice(0, MAX_PARAM_LINES).map(([name, value]) => {
    const doc = docs.get(name)
    const label = zh ? docLabel(doc) ?? name : humanize(name)
    return `${label}${zh ? '：' : ': '}${displayValue(value, doc, zh)}`
  })
  const more = entries.length - MAX_PARAM_LINES
  if (more > 0) out.push(zh ? `另有 ${more} 个参数` : `${more} more parameters`)
  if (!entries.length) out.push(zh ? '无参数' : 'no parameters')
  return out
}

/**
 * The approval card shows this as plain text and may collapse line breaks, so every
 * line after the first starts with "· " and still reads as a list when joined.
 */
function displayText(rt: Runtime, call: ResolvedCall, zh: boolean): string {
  const { request, account } = call
  const risk = call.risk as keyof typeof LEVEL_TEXT
  let catalog: ApiCatalog | undefined
  try {
    catalog = rt.providers.get(request.provider).catalog
  } catch {
    catalog = undefined
  }
  const target = `${request.service}.${request.action}`
  const summary = catalog && actionSummary(catalog, request.service, request.action)
  const where = zh
    ? [target, `账号 ${account.id}`, request.region ? `地域 ${request.region}` : ''].filter(Boolean).join('，')
    : [target, `account ${account.id}`, request.region ? `region ${request.region}` : ''].filter(Boolean).join(', ')
  const title = summary
    ? `${zh ? LEVEL_TEXT[risk].zh : LEVEL_TEXT[risk].title} · ${summary}${zh ? `（${where}）` : ` (${where})`}`
    : `${zh ? LEVEL_TEXT[risk].zh : LEVEL_TEXT[risk].title} · ${where}`
  return [title, ...paramLines(catalog, call, zh).map((l) => `· ${l}`)].join('\n')
}

function tryResolve(rt: Runtime, exec: Readonly<ToolExecution>): ResolvedCall | undefined {
  if (exec.name !== CALL_TOOL) return undefined
  const args = exec.arguments as CallArgs | undefined
  if (!args || typeof args.service !== 'string' || typeof args.action !== 'string') return undefined
  try {
    return resolveCall(rt, args)
  } catch {
    // The tool body reports unresolved accounts and providers with a precise error.
    return undefined
  }
}

export function readonlyDenial(call: ResolvedCall): string | undefined {
  if (call.risk === 'read' || !call.account.readonly) return undefined
  return `account "${call.account.id}" is read-only; ${call.request.service}.${call.request.action} is a ${call.risk} operation and was refused. Do not try to work around this.`
}

export function decide(rt: Runtime, exec: Readonly<ToolExecution>): PreToolDecision | undefined {
  const call = tryResolve(rt, exec)
  if (!call || call.risk === 'read') return undefined
  const denial = readonlyDenial(call)
  if (denial) return { kind: 'deny', reason: denial, info: { name: 'CloudError', code: CloudErrorCode.READONLY_ACCOUNT } }
  const { request, account, risk } = call
  const where = `${account.id}${request.region ? ` / ${request.region}` : ''}`
  const target = `${request.service}.${request.action}`
  const params = summarizeParams(request.params)
  return {
    kind: 'ask',
    reason: `${LEVEL_TEXT[risk].en} cloud API call ${target} on ${request.provider} account ${where}; params ${params}`,
    displayReason: { en: displayText(rt, call, false), 'zh-CN': displayText(rt, call, true) },
  }
}

/**
 * Route writes through DSH approval, and refuse writes on read-only accounts
 * both before approval (so the user is never asked) and in a monotone guard
 * (so no later policy can re-allow them).
 */
export function installApprovalPolicy(ctx: Context, rt: Runtime): void {
  const on = ctx.on.bind(ctx) as unknown as (
    name: 'tools/pre-execute',
    listener: (exec: ToolExecution, next: () => Promise<PreToolDecision>) => Promise<PreToolDecision>,
  ) => void
  on('tools/pre-execute', async (exec, next) => {
    const ours = decide(rt, exec)
    if (!ours || ours.kind === 'deny') return ours ?? next()
    const downstream = await next()
    return downstream.kind === 'allow' || downstream.kind === 'ask' ? ours : downstream
  })

  ctx.tools.guard((exec) => {
    const call = tryResolve(rt, exec)
    const denial = call && readonlyDenial(call)
    return denial ? { reason: denial, info: { name: 'CloudError', code: CloudErrorCode.READONLY_ACCOUNT } } : undefined
  })
}
