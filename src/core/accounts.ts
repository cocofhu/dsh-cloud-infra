import { CloudError, CloudErrorCode } from './errors.js'
import type { AccountConfig } from './types.js'

export const ACCOUNT_ID_PATTERN = /^[a-z][a-z0-9-]*$/

/** Holds the live account list; settings changes replace it in place. */
export class AccountRegistry {
  private accounts: AccountConfig[] = []

  replace(accounts: readonly AccountConfig[]): void {
    const seen = new Set<string>()
    const next: AccountConfig[] = []
    for (const account of accounts) {
      if (!ACCOUNT_ID_PATTERN.test(account.id)) continue
      const key = `${account.provider}/${account.id}`
      if (seen.has(key)) continue
      seen.add(key)
      next.push({ ...account })
    }
    this.accounts = next
  }

  list(provider?: string): AccountConfig[] {
    return this.accounts.filter((a) => !provider || a.provider === provider)
  }

  /**
   * Pick the account for a call. An omitted id is accepted only when the
   * provider has exactly one account, so the model never guesses between
   * production and test.
   */
  resolve(provider: string, id?: string): AccountConfig {
    const candidates = this.list(provider)
    if (id) {
      const found = candidates.find((a) => a.id === id)
      if (found) return found
      throw new CloudError(CloudErrorCode.NO_ACCOUNT, `no ${provider} account "${id}"; configured: ${candidates.map((a) => a.id).join(', ') || 'none'}`)
    }
    if (candidates.length === 1) return candidates[0]!
    if (candidates.length === 0) {
      throw new CloudError(CloudErrorCode.NO_ACCOUNT, `no ${provider} account is configured; ask the user to add one in Settings → Plugins → Cloud Infra`)
    }
    throw new CloudError(CloudErrorCode.NO_ACCOUNT, `several ${provider} accounts are configured (${candidates.map((a) => a.id).join(', ')}); pass "account"`)
  }
}
