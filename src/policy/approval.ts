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

interface ParamLine { name: string; label?: string; value: string }

function clip(text: string): string {
  return text.length > MAX_VALUE_CHARS ? `${text.slice(0, MAX_VALUE_CHARS)}…` : text
}

function displayValue(value: unknown, zh: boolean): string {
  if (Array.isArray(value) && value.every((v) => v === null || typeof v !== 'object')) {
    const shown = value.slice(0, MAX_LIST_ITEMS).map(String).join(zh ? '、' : ', ')
    const more = value.length - MAX_LIST_ITEMS
    return clip(more > 0 ? (zh ? `${shown} 等 ${value.length} 个` : `${shown} and ${more} more`) : shown || (zh ? '（空）' : '(empty)'))
  }
  return clip(typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value))
}

/** First clause of a Chinese parameter doc, e.g. "证书绑定的域名。" -> "证书绑定的域名". */
function docLabel(doc: string | undefined): string | undefined {
  const head = doc?.trim().split(/[，,。：:；;（(\s]/)[0] ?? ''
  return head.length >= 2 && head.length <= 16 && /[\u4e00-\u9fff]/.test(head) ? head : undefined
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

function paramLines(catalog: ApiCatalog, call: ResolvedCall, zh: boolean): string[] {
  const { service, action, version, params } = call.request
  let docs = new Map<string, string | undefined>()
  try {
    docs = new Map(catalog.describe(service, action, version).params.map((p) => [p.name, p.doc]))
  } catch {
    // Unknown actions still get their raw parameter names.
  }
  const entries = Object.entries(redact(params) as Record<string, JsonValue>)
  const lines: ParamLine[] = entries.slice(0, MAX_PARAM_LINES).map(([name, value]) => ({
    name, label: docLabel(docs.get(name)), value: displayValue(value, zh),
  }))
  const out = lines.map((l) => zh && l.label ? `${l.label}：${l.value}` : `${l.name}: ${l.value}`)
  const more = entries.length - MAX_PARAM_LINES
  if (more > 0) out.push(zh ? `…另有 ${more} 个参数` : `…and ${more} more parameters`)
  if (!entries.length) out.push(zh ? '（无参数）' : '(no parameters)')
  return out
}

/** The approval card shows plain text, so one line per parameter, labelled from the API docs. */
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
  const title = `${zh ? LEVEL_TEXT[risk].zh : LEVEL_TEXT[risk].title} · ${summary ?? target}`
  const where = zh
    ? [target, `账号 ${account.id}`, request.region ? `地域 ${request.region}` : ''].filter(Boolean).join(' · ')
    : [target, `account ${account.id}`, request.region ? `region ${request.region}` : ''].filter(Boolean).join(' · ')
  const lines = catalog ? paramLines(catalog, call, zh) : [summarizeParams(request.params)]
  return [title, where, ...lines].join('\n')
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
