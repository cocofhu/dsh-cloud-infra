import type { Context } from '@deepseek-ai/cordis'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import { CloudErrorCode } from '../core/errors.js'
import type { ApiCatalog } from '../core/catalog.js'
import type { JsonValue } from '../core/types.js'
import { redact, resolveCall, summarizeParams, type CallArgs, type ResolvedCall, type Runtime } from '../runtime.js'

export const CALL_TOOL = 'cloud_call'

type Lang = 'zh' | 'en'

const LEVEL_TEXT = {
  write: { model: 'write', zh: '写操作', en: 'Write' },
  danger: { model: 'HIGH-RISK', zh: '⚠ 高危操作', en: '⚠ HIGH-RISK' },
} as const

const MAX_PARAM_LINES = 10
const MAX_VALUE_CHARS = 60
const MAX_LIST_ITEMS = 5

const TEXT = {
  zh: { colon: '：', list: '、', more: (shown: string, total: number) => `${shown} 等 ${total} 个`, empty: '（空）', moreParams: (n: number) => `另有 ${n} 个参数`, noParams: '无参数', account: '账号', region: '地域', sep: '，', paren: (s: string) => `（${s}）` },
  en: { colon: ': ', list: ', ', more: (shown: string, total: number) => `${shown} and ${total - MAX_LIST_ITEMS} more`, empty: '(empty)', moreParams: (n: number) => `${n} more parameters`, noParams: 'no parameters', account: 'account', region: 'region', sep: ', ', paren: (s: string) => ` (${s})` },
} as const

interface ActionDocs { summary?: string; params: Map<string, string> }

function clip(text: string): string {
  return text.length > MAX_VALUE_CHARS ? `${text.slice(0, MAX_VALUE_CHARS)}…` : text
}

/** Meaning of an enum value from its doc, e.g. "DNS_AUTO: Automatically add …" or "83 = TrustAsia C1 DV Free。". */
function enumMeaning(doc: string | undefined, value: string): string | undefined {
  if (!doc || !value) return undefined
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`(?:^|[\\s，,。；;、(（])${escaped}\\s*[:：=]\\s*([^，,。；;.\\n]{1,40})`).exec(doc)
  return match?.[1]?.trim() || undefined
}

function displayValue(value: unknown, doc: string | undefined, lang: Lang): string {
  const text = TEXT[lang]
  if (Array.isArray(value) && value.every((v) => v === null || typeof v !== 'object')) {
    const shown = value.slice(0, MAX_LIST_ITEMS).map(String).join(text.list)
    return clip(value.length > MAX_LIST_ITEMS ? text.more(shown, value.length) : shown || text.empty)
  }
  if (typeof value === 'object' && value !== null) return clip(JSON.stringify(value))
  const shown = clip(String(value))
  const meaning = enumMeaning(doc, String(value))
  return meaning ? `${shown}${text.paren(meaning)}` : shown
}

/** First clause of a parameter doc: "证书绑定的域名。" -> "证书绑定的域名", "The domain bound to …." -> "Domain bound to …". */
function docLabel(doc: string | undefined, lang: Lang): string | undefined {
  if (!doc) return undefined
  if (lang === 'zh') {
    const head = doc.trim().split(/[，,。：:；;（(\s]/)[0] ?? ''
    return head.length >= 2 && head.length <= 16 && /[\u4e00-\u9fff]/.test(head) ? head : undefined
  }
  const head = (doc.trim().split(/[.:;,]\s|[.:;]$|\s\(/)[0] ?? '').replace(/^(?:The|A|An)\s+/, '')
  return head.length >= 2 && head.length <= 48 && /^[A-Za-z]/.test(head) ? head.charAt(0).toUpperCase() + head.slice(1) : undefined
}

/** "DvAuthMethod" -> "Dv auth method"; acronyms such as "TTL" stay as they are. */
function humanize(name: string): string {
  const words = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(' ')
  return words.map((w, i) => (i === 0 || /^[A-Z0-9]+$/.test(w) ? w : w.toLowerCase())).join(' ')
}

function actionDocs(catalog: ApiCatalog | undefined, call: ResolvedCall, lang: Lang): ActionDocs {
  const { service, action, version } = call.request
  if (!catalog) return { params: new Map() }
  if (lang === 'en') {
    const en = catalog.english?.(service, action)
    return { summary: en?.summary || undefined, params: new Map(Object.entries(en?.params ?? {})) }
  }
  let summary: string | undefined
  let params = new Map<string, string>()
  try {
    const hit = catalog.search(action, { service, limit: 5 }).hits.find((h) => h.action === action)
    summary = hit?.summary.trim().split(/[\s。]/)[0] || undefined
    params = new Map(catalog.describe(service, action, version).params.flatMap((p) => (p.doc ? [[p.name, p.doc] as const] : [])))
  } catch {
    // Unknown actions still get their raw parameter names.
  }
  return { summary, params }
}

function paramLines(docs: ActionDocs, call: ResolvedCall, lang: Lang): string[] {
  const text = TEXT[lang]
  const entries = Object.entries(redact(call.request.params) as Record<string, JsonValue>)
  const out = entries.slice(0, MAX_PARAM_LINES).map(([name, value]) => {
    const doc = docs.params.get(name)
    const label = docLabel(doc, lang) ?? (lang === 'zh' ? name : humanize(name))
    return `${label}${text.colon}${displayValue(value, doc, lang)}`
  })
  const more = entries.length - MAX_PARAM_LINES
  if (more > 0) out.push(text.moreParams(more))
  if (!entries.length) out.push(text.noParams)
  return out
}

/**
 * The approval card shows this as plain text and may collapse line breaks, so every
 * line after the first starts with "· " and still reads as a list when joined.
 */
function displayText(rt: Runtime, call: ResolvedCall, lang: Lang): string {
  const { request, account } = call
  const text = TEXT[lang]
  let catalog: ApiCatalog | undefined
  try {
    catalog = rt.providers.get(request.provider).catalog
  } catch {
    catalog = undefined
  }
  const docs = actionDocs(catalog, call, lang)
  const target = `${request.service}.${request.action}`
  const where = [target, `${text.account} ${account.id}`, request.region ? `${text.region} ${request.region}` : ''].filter(Boolean).join(text.sep)
  const level = LEVEL_TEXT[call.risk as keyof typeof LEVEL_TEXT][lang]
  const title = docs.summary ? `${level} · ${docs.summary}${text.paren(where)}` : `${level} · ${where}`
  return [title, ...paramLines(docs, call, lang).map((l) => `· ${l}`)].join('\n')
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
    reason: `${LEVEL_TEXT[risk as keyof typeof LEVEL_TEXT].model} cloud API call ${target} on ${request.provider} account ${where}; params ${params}`,
    displayReason: { en: displayText(rt, call, 'en'), zh: displayText(rt, call, 'zh') },
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
