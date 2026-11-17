import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { CredentialKey, CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { CloudError, CloudErrorCode } from '../../core/errors.js'
import type { AccountConfig, AccountInfo, Secret } from '../../core/types.js'

const ENV_SECRET_ID = 'TENCENTCLOUD_SECRET_ID'
const ENV_SECRET_KEY = 'TENCENTCLOUD_SECRET_KEY'
const ENV_SESSION_TOKEN = 'TENCENTCLOUD_SESSION_TOKEN'

const CREDENTIAL_SCOPE = 'cloud-infra'
const PROFILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/

export type CredentialStore = Pick<CredentialProvider, 'readRecord' | 'describeRecord' | 'modifyRecord' | 'deleteRecord'>

export function storeKey(accountId: string): CredentialKey {
  return `${CREDENTIAL_SCOPE}/tencent-${accountId}` as CredentialKey
}

function maskSecretId(secretId: string): string {
  return secretId.length <= 8 ? '****' : `${secretId.slice(0, 4)}****${secretId.slice(-4)}`
}

export interface TccliProfile {
  name: string
  region?: string
  type?: string
}

interface TccliCredentialFile {
  secretId?: string
  secretKey?: string
  token?: string
  type?: string
  expiresAt?: number
  'role-arn'?: string
}

export class TencentCredentials {
  constructor(
    private readonly store: () => CredentialStore | undefined,
    private readonly tccliDir: () => string = () => join(homedir(), '.tccli'),
  ) {}

  /** Re-read on every call so a rotated secret reaches the next request. */
  async resolve(account: AccountConfig): Promise<Secret> {
    return account.source === 'tccli' ? this.resolveTccli(account) : this.resolveStore(account)
  }

  async describe(account: AccountConfig): Promise<AccountInfo['credential']> {
    try {
      const secret = await this.resolve(account)
      return { configured: true, masked: maskSecretId(secret.secretId) }
    } catch (err) {
      return { configured: false, detail: err instanceof Error ? err.message : String(err) }
    }
  }

  async save(accountId: string, secret: Secret): Promise<void> {
    const store = this.requireStore()
    const env: Record<string, string> = { [ENV_SECRET_ID]: secret.secretId, [ENV_SECRET_KEY]: secret.secretKey }
    if (secret.token) env[ENV_SESSION_TOKEN] = secret.token
    await store.modifyRecord(storeKey(accountId), async () => ({ kind: 'api-key', env }))
  }

  async remove(accountId: string): Promise<void> {
    await this.requireStore().deleteRecord(storeKey(accountId))
  }

  async listTccliProfiles(): Promise<TccliProfile[]> {
    let names: string[]
    try {
      names = await readdir(this.tccliDir())
    } catch {
      return []
    }
    const profiles: TccliProfile[] = []
    for (const file of names.filter((n) => n.endsWith('.credential')).sort()) {
      const name = file.slice(0, -'.credential'.length)
      if (!PROFILE_PATTERN.test(name)) continue
      const cred = await readJson<TccliCredentialFile>(join(this.tccliDir(), file))
      profiles.push({ name, region: await this.tccliRegion(name), type: cred?.type || undefined })
    }
    return profiles
  }

  async tccliRegion(profile: string): Promise<string | undefined> {
    if (!PROFILE_PATTERN.test(profile)) return undefined
    const conf = await readJson<{ _sys_param?: { region?: unknown }; region?: unknown }>(join(this.tccliDir(), `${profile}.configure`))
    const region = conf?._sys_param?.region ?? conf?.region
    return typeof region === 'string' && region ? region : undefined
  }

  private async resolveStore(account: AccountConfig): Promise<Secret> {
    const record = await this.requireStore().readRecord(storeKey(account.id))
    const env = record?.kind === 'api-key' ? record.env : undefined
    const secretId = env?.[ENV_SECRET_ID]
    const secretKey = env?.[ENV_SECRET_KEY]
    if (!secretId || !secretKey) {
      throw new CloudError(CloudErrorCode.CREDENTIAL_MISSING, `account "${account.id}" has no stored SecretId/SecretKey; ask the user to set it in Settings → Plugins → Cloud Infra`)
    }
    return { secretId, secretKey, token: env?.[ENV_SESSION_TOKEN] || undefined }
  }

  private async resolveTccli(account: AccountConfig): Promise<Secret> {
    const profile = account.tccliProfile || 'default'
    if (!PROFILE_PATTERN.test(profile)) {
      throw new CloudError(CloudErrorCode.CREDENTIAL_MISSING, `invalid tccli profile name "${profile}"`)
    }
    const path = join(this.tccliDir(), `${profile}.credential`)
    const cred = await readJson<TccliCredentialFile>(path)
    if (!cred) {
      throw new CloudError(CloudErrorCode.CREDENTIAL_MISSING, `tccli profile "${profile}" not found or unreadable (${path})`)
    }
    if (cred.type === 'cvm-role' || cred['role-arn']) {
      throw new CloudError(CloudErrorCode.CREDENTIAL_MISSING, `tccli profile "${profile}" uses a CVM role or role-arn, which is not supported yet; configure secretId/secretKey instead`)
    }
    if (typeof cred.expiresAt === 'number' && cred.expiresAt * 1000 <= Date.now()) {
      throw new CloudError(CloudErrorCode.CREDENTIAL_MISSING, `tccli profile "${profile}" holds an expired ${cred.type || 'temporary'} credential; run any tccli command (e.g. \`tccli cvm DescribeRegions --profile ${profile}\`) to refresh it`)
    }
    if (!cred.secretId || !cred.secretKey) {
      throw new CloudError(CloudErrorCode.CREDENTIAL_MISSING, `tccli profile "${profile}" has no secretId/secretKey`)
    }
    return { secretId: cred.secretId, secretKey: cred.secretKey, token: cred.token || undefined }
  }

  private requireStore(): CredentialStore {
    const store = this.store()
    if (!store) throw new CloudError(CloudErrorCode.CREDENTIAL_MISSING, 'the DSH credentials service is not available')
    return store
  }
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
    return parsed && typeof parsed === 'object' ? (parsed as T) : undefined
  } catch {
    return undefined
  }
}
