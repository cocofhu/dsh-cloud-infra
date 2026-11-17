import type { CloudRequest, RiskLevel, RiskRule } from './types.js'

export interface PrefixRules {
  read: readonly string[]
  danger: readonly string[]
  /** Whole-name patterns checked before prefixes, e.g. `Modify*Password`. */
  dangerPatterns?: readonly string[]
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`)
}

/**
 * Classify one request. User rules win in declaration order; otherwise the
 * provider's naming convention decides, and any name that matches neither a
 * read nor a danger prefix is a write.
 */
export function classify(req: Pick<CloudRequest, 'provider' | 'service' | 'action'>, rules: readonly RiskRule[], prefixes: PrefixRules): RiskLevel {
  for (const rule of rules) {
    if (rule.provider && rule.provider !== req.provider) continue
    if (rule.service && rule.service !== req.service) continue
    if (globToRegExp(rule.action).test(req.action)) return rule.level
  }
  const action = req.action
  if (!/^[A-Z][A-Za-z0-9]*$/.test(action)) return 'write'
  if (prefixes.dangerPatterns?.some((p) => globToRegExp(p).test(action))) return 'danger'
  if (prefixes.danger.some((p) => startsWithWord(action, p))) return 'danger'
  if (prefixes.read.some((p) => startsWithWord(action, p))) return 'read'
  return 'write'
}

/** `Stop` matches `StopInstances` but not `Stopwatch`. */
function startsWithWord(action: string, prefix: string): boolean {
  if (!action.startsWith(prefix)) return false
  const next = action.charAt(prefix.length)
  return next === '' || /[A-Z0-9]/.test(next)
}
