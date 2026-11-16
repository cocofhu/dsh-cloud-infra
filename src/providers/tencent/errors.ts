import { CloudError, CloudErrorCode } from '../../core/errors.js'

interface SdkErrorLike {
  name?: string
  message?: string
  code?: string
  requestId?: string
  httpCode?: number
}

const RULES: [RegExp, CloudErrorCode, string][] = [
  [/^AuthFailure\.UnauthorizedOperation|^UnauthorizedOperation/, CloudErrorCode.PERMISSION_DENIED, 'the account lacks the CAM permission for this action; do not retry'],
  [/^AuthFailure/, CloudErrorCode.AUTH_FAILED, 'the SecretId/SecretKey was rejected; check the account credential'],
  [/^RequestLimitExceeded/, CloudErrorCode.THROTTLED, 'rate limited; retry later'],
  [/^(InvalidParameter|InvalidParameterValue|MissingParameter|UnknownParameter)/, CloudErrorCode.INVALID_PARAMETER, 'check the parameters with cloud_api_describe before retrying'],
  [/^(InvalidAction|ResourceNotFound|NoSuchVersion|UnsupportedRegion)/, CloudErrorCode.NOT_FOUND, 'check the service, version, action, region or resource id'],
]

export function isThrottle(err: unknown): boolean {
  return err instanceof CloudError && err.code === CloudErrorCode.THROTTLED
}

/** Convert SDK and transport failures into a CloudError; AbortError passes through. */
export function toCloudError(err: unknown): unknown {
  if (err instanceof CloudError) return err
  const e = (err ?? {}) as SdkErrorLike
  if (e.name === 'AbortError') return err
  const upstream = { code: e.code, requestId: e.requestId || undefined, httpStatus: e.httpCode }
  const message = e.message || String(err)
  if (e.code) {
    for (const [pattern, code, hint] of RULES) {
      if (pattern.test(e.code)) return new CloudError(code, `${e.code}: ${message} (${hint})`, { upstream, cause: err })
    }
    return new CloudError(CloudErrorCode.UPSTREAM, `${e.code}: ${message}`, { upstream, cause: err })
  }
  return new CloudError(CloudErrorCode.UPSTREAM, `request failed: ${message}`, { upstream, cause: err })
}
