import type { IncomingMessage, ServerResponse } from 'node:http'
import { ACCOUNT_ID_PATTERN } from '../core/accounts.js'
import type { AccountConfig, AccountInfo, Secret } from '../core/types.js'
import type { TencentCredentials, TccliProfile } from '../providers/tencent/credentials.js'
import type { Runtime } from '../runtime.js'
import { describeAccounts } from '../tools/accounts.js'

export const API_PATH = '/cloud-infra/api'
const MAX_BODY = 64 * 1024

export interface ApiDeps {
  rt: Runtime
  tencentCredentials: TencentCredentials
  /** Persist the account list into the plugin's profile entry; undefined when Settings is unavailable. */
  saveAccounts: (() => ((accounts: AccountConfig[]) => Promise<void>) | undefined)
}

export interface ApiState {
  accounts: (AccountInfo & { tccliProfile?: string })[]
  providers: { id: string; displayName: string }[]
  tccliProfiles: TccliProfile[]
  writable: boolean
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

/** JSON-RPC-ish endpoint behind DSH authentication; JSON content type and same-origin are required to block cross-site posts. */
export function createApiHandler(deps: ApiDeps) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      if (req.method !== 'POST') throw new HttpError(405, 'POST only')
      if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) throw new HttpError(415, 'content-type must be application/json')
      const origin = req.headers.origin
      if (origin && req.headers.host && new URL(origin).host !== req.headers.host) throw new HttpError(403, 'cross-origin request refused')
      const body = await readJson(req)
      const result = await dispatch(deps, String(body.method ?? ''), body)
      send(res, 200, { ok: true, ...result })
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500
      send(res, status, { ok: false, error: err instanceof Error ? err.message : String(err) })
    }
  }
}

export async function dispatch(deps: ApiDeps, method: string, body: Record<string, unknown>): Promise<object> {
  const { rt, tencentCredentials } = deps
  switch (method) {
    case 'state':
      return state(deps)
    case 'accounts.save': {
      const save = writer(deps)
      const account = parseAccount(body.account)
      const originalId = typeof body.originalId === 'string' ? body.originalId : undefined
      const list = rt.accounts.list()
      if (list.some((a) => a.provider === account.provider && a.id === account.id && a.id !== originalId)) {
        throw new HttpError(409, `account "${account.id}" already exists`)
      }
      const secret = parseSecret(body.secret)
      if (account.source === 'store') {
        if (secret) await tencentCredentials.save(account.id, secret)
        else if (originalId && originalId !== account.id) {
          throw new HttpError(400, 'renaming a stored account needs the SecretId/SecretKey again')
        }
      }
      const next = originalId
        ? list.map((a) => (a.provider === account.provider && a.id === originalId ? account : a))
        : [...list, account]
      if (originalId && !list.some((a) => a.id === originalId)) next.push(account)
      await save(next)
      rt.accounts.replace(next)
      if (originalId && originalId !== account.id) await tencentCredentials.remove(originalId).catch(() => undefined)
      return state(deps)
    }
    case 'accounts.remove': {
      const save = writer(deps)
      const id = String(body.id ?? '')
      const provider = String(body.provider ?? 'tencent')
      const list = rt.accounts.list()
      const target = list.find((a) => a.provider === provider && a.id === id)
      if (!target) throw new HttpError(404, `no account "${id}"`)
      const next = list.filter((a) => a !== target)
      await save(next)
      rt.accounts.replace(next)
      if (target.source === 'store') await tencentCredentials.remove(id).catch(() => undefined)
      return state(deps)
    }
    case 'accounts.test': {
      const id = String(body.id ?? '')
      const provider = rt.providers.get(String(body.provider ?? 'tencent'))
      const account = rt.accounts.resolve(provider.id, id)
      if (!provider.testAccount) throw new HttpError(400, `${provider.id} cannot test accounts`)
      const result = await provider.testAccount(account, AbortSignal.timeout(20_000))
      return { test: result }
    }
    default:
      throw new HttpError(400, `unknown method "${method}"`)
  }
}

async function state(deps: ApiDeps): Promise<ApiState> {
  const { rt, tencentCredentials } = deps
  const infos = await describeAccounts(rt)
  const configs = rt.accounts.list()
  return {
    accounts: infos.map((info) => {
      const cfg = configs.find((c) => c.provider === info.provider && c.id === info.id)
      return { ...info, ...(cfg?.tccliProfile ? { tccliProfile: cfg.tccliProfile } : {}) }
    }),
    providers: rt.providers.ids().map((id) => ({ id, displayName: rt.providers.get(id).displayName })),
    tccliProfiles: await tencentCredentials.listTccliProfiles(),
    writable: deps.saveAccounts() !== undefined,
  }
}

function writer(deps: ApiDeps): (accounts: AccountConfig[]) => Promise<void> {
  const save = deps.saveAccounts()
  if (!save) throw new HttpError(503, 'the DSH settings service is not available; edit the plugin config in the profile instead')
  return save
}

export function parseAccount(raw: unknown): AccountConfig {
  if (!raw || typeof raw !== 'object') throw new HttpError(400, 'account is required')
  const a = raw as Record<string, unknown>
  const id = String(a.id ?? '').trim()
  if (!ACCOUNT_ID_PATTERN.test(id) || id.length > 40) throw new HttpError(400, 'account id must match [a-z][a-z0-9-]* (max 40 chars)')
  const provider = String(a.provider ?? 'tencent')
  if (provider !== 'tencent') throw new HttpError(400, `unsupported provider "${provider}"`)
  const source = a.source === 'tccli' ? 'tccli' : 'store'
  const region = typeof a.defaultRegion === 'string' ? a.defaultRegion.trim() : ''
  if (region && !/^[a-z]{2,}-[a-z0-9-]+$/.test(region)) throw new HttpError(400, `invalid region "${region}"`)
  const label = typeof a.label === 'string' ? a.label.trim().slice(0, 60) : ''
  const profile = typeof a.tccliProfile === 'string' ? a.tccliProfile.trim() : ''
  if (profile && !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(profile)) throw new HttpError(400, `invalid tccli profile "${profile}"`)
  return {
    id,
    provider,
    source,
    ...(label ? { label } : {}),
    ...(region ? { defaultRegion: region } : {}),
    readonly: a.readonly === true,
    ...(source === 'tccli' ? { tccliProfile: profile || 'default' } : {}),
  }
}

function parseSecret(raw: unknown): Secret | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'object') throw new HttpError(400, 'secret must be an object')
  const s = raw as Record<string, unknown>
  const secretId = String(s.secretId ?? '').trim()
  const secretKey = String(s.secretKey ?? '').trim()
  if (!secretId && !secretKey) return undefined
  if (!/^[A-Za-z0-9]{8,128}$/.test(secretId) || !/^[A-Za-z0-9+/=_-]{8,128}$/.test(secretKey)) {
    throw new HttpError(400, 'SecretId/SecretKey look malformed')
  }
  const token = typeof s.token === 'string' && s.token.trim() ? s.token.trim() : undefined
  return { secretId, secretKey, ...(token ? { token } : {}) }
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > MAX_BODY) throw new HttpError(413, 'request body too large')
    chunks.push(chunk as Buffer)
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error()
    return parsed as Record<string, unknown>
  } catch {
    throw new HttpError(400, 'body must be a JSON object')
  }
}

function send(res: ServerResponse, status: number, body: object): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}
