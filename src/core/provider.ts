import type { ApiCatalog } from './catalog.js'
import { CloudError, CloudErrorCode } from './errors.js'
import type { AccountConfig, AccountInfo, CloudRequest, CloudResponse, RiskLevel } from './types.js'

export interface TestResult {
  ok: boolean
  identity?: string
  error?: string
}

export interface CloudProvider {
  readonly id: string
  readonly displayName: string
  readonly catalog: ApiCatalog
  /** Describe configured accounts of this provider without secret material. */
  describeAccount(account: AccountConfig): Promise<AccountInfo>
  /** Pure and synchronous: runs inside the pre-execute policy. */
  classify(req: CloudRequest): RiskLevel
  call(req: CloudRequest, account: AccountConfig, signal: AbortSignal): Promise<CloudResponse>
  testAccount?(account: AccountConfig, signal: AbortSignal): Promise<TestResult>
}

export class ProviderRegistry {
  private readonly providers = new Map<string, CloudProvider>()

  register(provider: CloudProvider): () => void {
    if (this.providers.has(provider.id)) throw new TypeError(`cloud provider "${provider.id}" is already registered`)
    this.providers.set(provider.id, provider)
    return () => {
      if (this.providers.get(provider.id) === provider) this.providers.delete(provider.id)
    }
  }

  get(id: string): CloudProvider {
    const provider = this.providers.get(id)
    if (!provider) {
      throw new CloudError(CloudErrorCode.UNKNOWN_PROVIDER, `unknown cloud provider "${id}"; available: ${this.ids().join(', ') || 'none'}`)
    }
    return provider
  }

  ids(): string[] {
    return [...this.providers.keys()]
  }
}
