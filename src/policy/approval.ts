import type { Context } from '@deepseek-ai/cordis'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import { CloudErrorCode } from '../core/errors.js'
import { resolveCall, summarizeParams, type CallArgs, type ResolvedCall, type Runtime } from '../runtime.js'

export const CALL_TOOL = 'cloud_call'

const LEVEL_TEXT = {
  write: { en: 'write', zh: '写操作' },
  danger: { en: 'HIGH-RISK', zh: '高危操作' },
} as const

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
    displayReason: {
      en: `${risk === 'danger' ? '⚠ HIGH-RISK ' : ''}Cloud ${LEVEL_TEXT[risk].en}: ${target} · ${where}\n${params}`,
      'zh-CN': `${risk === 'danger' ? '⚠ ' : ''}云 API ${LEVEL_TEXT[risk].zh}：${target} · ${where}\n${params}`,
    },
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
