import { CommonClient } from 'tencentcloud-sdk-nodejs-common'
import type { JsonObject, JsonValue, Secret } from '../../core/types.js'

export interface TencentInvocation {
  endpoint: string
  version: string
  action: string
  region?: string
  params: JsonObject
  secret: Secret
  timeoutMs: number
  signal: AbortSignal
}

export interface TencentRawResponse {
  RequestId?: string
  [key: string]: JsonValue | undefined
}

/** Seam for tests: production uses the SDK CommonClient. */
export type TencentTransport = (invocation: TencentInvocation) => Promise<TencentRawResponse>

export const sdkTransport: TencentTransport = async (inv) => {
  const client = new CommonClient(inv.endpoint, inv.version, {
    credential: { secretId: inv.secret.secretId, secretKey: inv.secret.secretKey, token: inv.secret.token },
    region: inv.region ?? '',
    profile: {
      language: 'zh-CN',
      httpProfile: { reqTimeout: Math.max(1, Math.ceil(inv.timeoutMs / 1000)) },
    },
  })
  return (await client.request(inv.action, inv.params, { signal: inv.signal })) as TencentRawResponse
}
