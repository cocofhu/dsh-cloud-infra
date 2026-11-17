import { defineTool } from '@deepseek-ai/dsh-tools'
import { CloudError, CloudErrorCode } from '../core/errors.js'
import { truncateJson } from '../core/truncate.js'
import type { CloudResponse, JsonObject, JsonValue, RiskLevel } from '../core/types.js'
import { CALL_TOOL, MAX_REGIONS, readonlyDenial, resolveCall, type ResolvedCall, type Runtime } from '../runtime.js'

const PREVIEW_CHARS = 4000
const REGION_CONCURRENCY = 6

export interface CallValue {
  ref: string
  provider: string
  account: string
  service: string
  version?: string
  action: string
  region?: string
  /** Set for a multi-region call; `data` is then `{ [region]: data | { error } }`. */
  regions?: string[]
  failedRegions?: string[]
  risk: RiskLevel
  requestId?: string
  durationMs: number
  data: JsonValue
}

export function callTool(rt: Runtime) {
  return defineTool({
    name: CALL_TOOL,
    description:
      'Call any cloud OpenAPI action (Tencent Cloud first). Read actions (Describe*/List*/Get*/Query*…) run directly; '
      + 'every other action asks the user for approval. Use the lowercase product id and PascalCase action, e.g. '
      + 'service "cvm", action "DescribeInstances"; version defaults to the newest one. If unsure about the action or its '
      + 'parameters, use cloud_api_search / cloud_api_describe first. For read actions, "regions" queries several regions '
      + 'at once. The full result is cached under the returned "ref" for cloud_result and cloud_visualize; the text you see may be truncated.',
    parameters: {
      provider: { type: 'string', description: 'Cloud provider id. Default "tencent".' },
      account: { type: 'string', description: 'Account id from cloud_accounts. Required when more than one account exists.' },
      service: { type: 'string', required: true, description: 'Lowercase product id, e.g. cvm, vpc, clb, cdb, monitor, billing.' },
      version: { type: 'string', description: 'API version YYYY-MM-DD. Omit to use the newest version in the API index.' },
      action: { type: 'string', required: true, description: 'PascalCase action, e.g. DescribeInstances.' },
      region: { type: 'string', description: 'Region such as ap-guangzhou. Defaults to the account region; omit for global products.' },
      regions: {
        type: 'array',
        items: { type: 'string' },
        description: `Read actions only: run the same call in these regions concurrently (max ${MAX_REGIONS}). The result is { "<region>": data | { "error": … } }.`,
      },
      params: { type: 'object', additionalProperties: true, description: 'Action parameters exactly as in the API docs (PascalCase keys).' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: renderCall(value as unknown as CallValue, rt.config().maxOutputChars) }],
      presentationMeta: (_args, value) => callMeta(value as unknown as CallValue),
    },
    presentCall: (args) => ({
      card: 'generic',
      title: `Cloud API · ${String(args.service ?? '')}.${String(args.action ?? '')}`,
      kind: 'fetch',
      content: [],
    }),
    presentResult: (args, { isError }) => ({
      card: 'generic',
      title: `${isError ? 'Cloud API failed' : 'Cloud API'} · ${String(args.service ?? '')}.${String(args.action ?? '')}`,
      content: [],
    }),
    async execute(args, exec) {
      const call = resolveCall(rt, args)
      const denial = readonlyDenial(call)
      if (denial) throw new CloudError(CloudErrorCode.READONLY_ACCOUNT, denial)
      const res = call.regions ? await fanOut(rt, call, exec.signal) : await single(rt, call, exec.signal)
      const stored = rt.results.put(exec.agent?.id ?? 'default', call.request, res.data, res.requestId)
      const value: CallValue = {
        ref: stored.ref,
        provider: call.request.provider,
        account: call.account.id,
        service: call.request.service,
        version: call.request.version,
        action: call.request.action,
        region: call.regions ? undefined : call.request.region ?? call.account.defaultRegion,
        ...(call.regions ? { regions: call.regions, failedRegions: res.failedRegions } : {}),
        risk: call.risk,
        requestId: res.requestId,
        durationMs: res.durationMs,
        data: res.data,
      }
      return JSON.parse(JSON.stringify(value)) as Record<string, JsonValue>
    },
  })
}

type CallOutcome = CloudResponse & { failedRegions?: string[] }

function single(rt: Runtime, call: ResolvedCall, signal: AbortSignal): Promise<CallOutcome> {
  return rt.providers.get(call.request.provider).call(call.request, call.account, signal)
}

/**
 * Run a read action in every region with bounded concurrency. Per-region
 * failures stay in the merged result; the call fails only when every region
 * fails.
 */
async function fanOut(rt: Runtime, call: ResolvedCall, signal: AbortSignal): Promise<CallOutcome> {
  const provider = rt.providers.get(call.request.provider)
  const regions = call.regions!
  const started = Date.now()
  const data: JsonObject = {}
  const failed: string[] = []
  const errors: unknown[] = []
  let next = 0
  const worker = async () => {
    while (next < regions.length) {
      const region = regions[next++]!
      try {
        const res = await provider.call({ ...call.request, region }, call.account, signal)
        data[region] = res.data
      } catch (err) {
        if (signal.aborted) throw err
        failed.push(region)
        errors.push(err)
        const e = err as { code?: string; message?: string; upstream?: { code?: string } }
        data[region] = { error: { code: e.upstream?.code ?? e.code ?? 'ERROR', message: e.message ?? String(err) } }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(REGION_CONCURRENCY, regions.length) }, worker))
  if (failed.length === regions.length) throw errors[0]
  const ordered: JsonObject = {}
  for (const region of regions) ordered[region] = data[region]!
  return { data: ordered, durationMs: Date.now() - started, failedRegions: failed }
}

function renderCall(value: CallValue, maxChars: number): string {
  const { text, truncated } = truncateJson(value.data, maxChars)
  const where = value.regions
    ? ` · regions=${value.regions.length}${value.failedRegions?.length ? ` (failed: ${value.failedRegions.join(', ')})` : ''}`
    : value.region ? ` · region=${value.region}` : ''
  const head = `${value.service}.${value.action} ok · ref=${value.ref} · account=${value.account} · version=${value.version ?? '-'}${where} · RequestId=${value.requestId ?? '-'} · ${value.durationMs}ms`
  const tail = truncated
    ? `\n(truncated; page the full result with cloud_result ref="${value.ref}" path=… offset/limit, or render it with cloud_visualize)`
    : ''
  return `${head}\n${text}${tail}`
}

export function callMeta(value: CallValue): JsonValue {
  const { text, truncated } = truncateJson(value.data, PREVIEW_CHARS)
  return {
    kind: 'cloud-call',
    ref: value.ref,
    provider: value.provider,
    account: value.account,
    service: value.service,
    version: value.version ?? null,
    action: value.action,
    region: value.region ?? null,
    regions: value.regions ?? null,
    failedRegions: value.failedRegions ?? null,
    risk: value.risk,
    requestId: value.requestId ?? null,
    durationMs: value.durationMs,
    preview: text,
    truncated,
  }
}
