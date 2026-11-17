import type { Context } from '@deepseek-ai/cordis'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import { CloudErrorCode } from '../core/errors.js'
import { CALL_TOOL, readonlyDenial, resolveCall, summarizeParams, type CallArgs, type ResolvedCall, type Runtime } from '../runtime.js'
import { approvalText } from './approval-text.js'

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
    reason: `${risk === 'danger' ? 'HIGH-RISK' : 'write'} cloud API call ${target} on ${request.provider} account ${where}; params ${params}`,
    displayReason: approvalText(rt, call),
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
