import { HarnessError } from '@deepseek-ai/dsh-error'

export const CloudErrorCode = {
  NO_ACCOUNT: 'CLOUD_NO_ACCOUNT',
  CREDENTIAL_MISSING: 'CLOUD_CREDENTIAL_MISSING',
  AUTH_FAILED: 'CLOUD_AUTH_FAILED',
  PERMISSION_DENIED: 'CLOUD_PERMISSION_DENIED',
  INVALID_PARAMETER: 'CLOUD_INVALID_PARAMETER',
  NOT_FOUND: 'CLOUD_NOT_FOUND',
  THROTTLED: 'CLOUD_THROTTLED',
  READONLY_ACCOUNT: 'CLOUD_READONLY_ACCOUNT',
  REF_EXPIRED: 'CLOUD_REF_EXPIRED',
  UNKNOWN_PROVIDER: 'CLOUD_UNKNOWN_PROVIDER',
  UPSTREAM: 'CLOUD_UPSTREAM',
} as const

export type CloudErrorCode = (typeof CloudErrorCode)[keyof typeof CloudErrorCode]

export interface UpstreamDetail {
  code?: string
  requestId?: string
  httpStatus?: number
}

export class CloudError extends HarnessError {
  override readonly name = 'CloudError'
  readonly upstream?: UpstreamDetail

  constructor(code: CloudErrorCode, message: string, options?: { upstream?: UpstreamDetail; cause?: unknown }) {
    super(message, code, options?.cause === undefined ? undefined : { cause: options.cause })
    this.upstream = options?.upstream
  }
}
