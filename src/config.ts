import Schema from '@deepseek-ai/schemastery'
import type { AccountConfig, RiskRule } from './core/types.js'

export const SETTINGS_NS = 'cloud-infra'

export interface Config {
  accounts: AccountConfig[]
  riskRules: RiskRule[]
  timeoutMs: number
  maxOutputChars: number
  resultStore: { maxEntries: number; maxBytes: number }
  tencent: { endpoints: Record<string, string>; tccliDir?: string }
}

const Account: Schema<AccountConfig> = Schema.object({
  id: Schema.string().pattern(/^[a-z][a-z0-9-]*$/).required().description('账号 id，小写字母开头，如 prod'),
  provider: Schema.union(['tencent'] as const).default('tencent').description('云厂商'),
  label: Schema.string().description('显示名称'),
  source: Schema.union(['store', 'tccli'] as const).default('store').description('凭据来源：DSH 凭据存储或 ~/.tccli'),
  defaultRegion: Schema.string().description('默认地域，如 ap-guangzhou'),
  readonly: Schema.boolean().default(false).description('只读账号：拒绝一切写操作'),
  tccliProfile: Schema.string().description('source 为 tccli 时使用的 profile，默认 default'),
}) as unknown as Schema<AccountConfig>

const Rule: Schema<RiskRule> = Schema.object({
  provider: Schema.string(),
  service: Schema.string(),
  action: Schema.string().required().description('Action 名，支持 * 通配'),
  level: Schema.union(['read', 'write', 'danger'] as const).required(),
}) as unknown as Schema<RiskRule>

export const Config: Schema<Config> = Schema.object({
  accounts: Schema.array(Account).default([]).description('云账号（不含密钥）'),
  riskRules: Schema.array(Rule).default([]).description('覆盖默认的风险分级规则，按顺序匹配'),
  timeoutMs: Schema.number().default(30000).description('单次云 API 请求超时（毫秒）'),
  maxOutputChars: Schema.number().default(16000).description('返回给模型的结果字符上限'),
  resultStore: Schema.object({
    maxEntries: Schema.number().default(50),
    maxBytes: Schema.number().default(64 * 1024 * 1024),
  }).default({ maxEntries: 50, maxBytes: 64 * 1024 * 1024 }).description('会话内结果缓存上限'),
  tencent: Schema.object({
    endpoints: Schema.dict(Schema.string()).default({}).description('按产品覆盖 endpoint'),
    tccliDir: Schema.string().description('tccli 配置目录，默认 ~/.tccli'),
  }).default({ endpoints: {} }),
}) as unknown as Schema<Config>

export function withDefaults(raw: Partial<Config> | undefined): Config {
  return {
    accounts: Array.isArray(raw?.accounts) ? raw.accounts : [],
    riskRules: Array.isArray(raw?.riskRules) ? raw.riskRules : [],
    timeoutMs: positive(raw?.timeoutMs, 30000),
    maxOutputChars: positive(raw?.maxOutputChars, 16000),
    resultStore: {
      maxEntries: positive(raw?.resultStore?.maxEntries, 50),
      maxBytes: positive(raw?.resultStore?.maxBytes, 64 * 1024 * 1024),
    },
    tencent: {
      endpoints: raw?.tencent?.endpoints && typeof raw.tencent.endpoints === 'object' ? raw.tencent.endpoints : {},
      tccliDir: raw?.tencent?.tccliDir || undefined,
    },
  }
}

function positive(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}
