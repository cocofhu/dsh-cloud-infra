import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { IndexedCatalog, type ApiCatalog } from '../../core/catalog.js'
import { CloudError, CloudErrorCode } from '../../core/errors.js'
import type { CloudProvider, TestResult } from '../../core/provider.js'
import { classify } from '../../core/risk.js'
import type { AccountConfig, AccountInfo, CloudRequest, CloudResponse, JsonValue, RiskLevel, RiskRule } from '../../core/types.js'
import { sdkTransport, type TencentTransport } from './client.js'
import type { TencentCredentials } from './credentials.js'
import { isThrottle, toCloudError } from './errors.js'
import { TENCENT_PREFIXES } from './risk.js'

const SERVICE_PATTERN = /^[a-z][a-z0-9]*$/
const VERSION_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const READ_RETRY_DELAYS_MS = [500, 1500]

export const TENCENT_INDEX_DIR = fileURLToPath(new URL('../../api-index/tencent/', import.meta.url))

export interface TencentProviderOptions {
  credentials: TencentCredentials
  rules: () => readonly RiskRule[]
  timeoutMs: () => number
  /** Per-service endpoint overrides, e.g. `{ cvm: 'cvm.ap-shanghai.tencentcloudapi.com' }`. */
  endpoints?: () => Readonly<Record<string, string>>
  catalog?: ApiCatalog
  transport?: TencentTransport
}

export class TencentProvider implements CloudProvider {
  readonly id = 'tencent'
  readonly displayName = '腾讯云'
  readonly catalog: ApiCatalog
  private readonly transport: TencentTransport

  constructor(private readonly options: TencentProviderOptions) {
    this.transport = options.transport ?? sdkTransport
    this.catalog = options.catalog ?? new IndexedCatalog(TENCENT_INDEX_DIR)
  }

  classify(req: CloudRequest): RiskLevel {
    return classify(req, this.options.rules(), TENCENT_PREFIXES)
  }

  async describeAccount(account: AccountConfig): Promise<AccountInfo> {
    const defaultRegion = account.defaultRegion
      ?? (account.source === 'tccli' ? await this.options.credentials.tccliRegion(account.tccliProfile || 'default') : undefined)
    return {
      id: account.id,
      provider: this.id,
      label: account.label,
      source: account.source,
      defaultRegion,
      readonly: account.readonly === true,
      credential: await this.options.credentials.describe(account),
    }
  }

  async call(req: CloudRequest, account: AccountConfig, signal: AbortSignal): Promise<CloudResponse> {
    if (!SERVICE_PATTERN.test(req.service)) {
      throw new CloudError(CloudErrorCode.INVALID_PARAMETER, `invalid service "${req.service}"; use the lowercase product id such as "cvm"`)
    }
    const version = this.resolveVersion(req)
    if (!version || !VERSION_PATTERN.test(version)) {
      throw new CloudError(CloudErrorCode.INVALID_PARAMETER, `missing or invalid version for "${req.service}"; "${req.service}" is not in the API index, so pass the API version such as "2017-03-12" or find the product with cloud_api_search`)
    }
    const region = req.region || account.defaultRegion
      || (account.source === 'tccli' ? await this.options.credentials.tccliRegion(account.tccliProfile || 'default') : undefined)
    const endpoint = this.options.endpoints?.()[req.service] || `${req.service}.tencentcloudapi.com`
    const retryable = this.classify(req) === 'read'

    for (let attempt = 0; ; attempt++) {
      signal.throwIfAborted()
      const secret = await this.options.credentials.resolve(account)
      const started = Date.now()
      try {
        const raw = await this.transport({
          endpoint, version, action: req.action, region, params: req.params, secret,
          timeoutMs: this.options.timeoutMs(), signal,
        })
        const { RequestId, ...data } = raw
        return { requestId: RequestId, data: data as JsonValue, durationMs: Date.now() - started }
      } catch (err) {
        const mapped = toCloudError(err)
        const delay = READ_RETRY_DELAYS_MS[attempt]
        if (!retryable || delay === undefined || !isThrottle(mapped)) throw mapped
        await sleep(delay, undefined, { signal })
      }
    }
  }

  /** Explicit version first, then the newest one in the API index. */
  resolveVersion(req: Pick<CloudRequest, 'service' | 'version' | 'action'>): string | undefined {
    if (req.version) return req.version
    try {
      return this.catalog.latestVersion(req.service, req.action)
    } catch {
      return undefined
    }
  }

  async testAccount(account: AccountConfig, signal: AbortSignal): Promise<TestResult> {
    try {
      const res = await this.call(
        { provider: this.id, account: account.id, service: 'sts', version: '2018-08-13', action: 'GetCallerIdentity', region: 'ap-guangzhou', params: {} },
        account,
        signal,
      )
      const data = res.data as { Arn?: string; AccountId?: string }
      return { ok: true, identity: data.Arn || data.AccountId }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
}
