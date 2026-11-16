export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }
export type JsonObject = { [key: string]: JsonValue }

export type RiskLevel = 'read' | 'write' | 'danger'

export interface CloudRequest {
  provider: string
  account: string
  service: string
  /** Resolved by the provider when absent. */
  version?: string
  action: string
  /** Account default region when absent; empty for global products. */
  region?: string
  params: JsonObject
}

export interface CloudResponse {
  requestId?: string
  /** Business payload with the vendor envelope removed. */
  data: JsonValue
  durationMs: number
}

export type CredentialSource = 'store' | 'tccli'

export interface AccountConfig {
  id: string
  provider: string
  label?: string
  source: CredentialSource
  defaultRegion?: string
  readonly?: boolean
  /** Profile name under ~/.tccli when `source` is `tccli`. */
  tccliProfile?: string
}

/** Model- and UI-safe account view; never carries secret material. */
export interface AccountInfo {
  id: string
  provider: string
  label?: string
  source: CredentialSource
  defaultRegion?: string
  readonly: boolean
  credential: { configured: boolean; masked?: string; detail?: string }
}

export interface RiskRule {
  provider?: string
  service?: string
  /** Action name; `*` matches any run of characters. */
  action: string
  level: RiskLevel
}

export interface Secret {
  secretId: string
  secretKey: string
  token?: string
}
