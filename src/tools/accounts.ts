import { defineTool } from '@deepseek-ai/dsh-tools'
import type { AccountInfo, JsonValue } from '../core/types.js'
import type { Runtime } from '../runtime.js'

export async function describeAccounts(rt: Runtime, provider?: string): Promise<AccountInfo[]> {
  return Promise.all(rt.accounts.list(provider).map((account) => rt.providers.get(account.provider).describeAccount(account)))
}

export function accountsTool(rt: Runtime) {
  return defineTool({
    name: 'cloud_accounts',
    description: 'List configured cloud accounts: id, provider, label, default region, read-only flag and whether a credential is available. Never returns secrets.',
    parameters: {
      provider: { type: 'string', description: 'Only accounts of this provider, e.g. tencent.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: renderAccounts((value as unknown as { accounts: AccountInfo[] }).accounts) }],
    },
    presentCall: () => ({ card: 'generic', title: '云账号', kind: 'read', content: [] }),
    async execute(args) {
      const accounts = await describeAccounts(rt, args.provider)
      return JSON.parse(JSON.stringify({ accounts })) as Record<string, JsonValue>
    },
  })
}

function renderAccounts(accounts: AccountInfo[]): string {
  if (!accounts.length) return 'No cloud account is configured. Ask the user to add one in Settings → Plugins → Cloud Infra.'
  return accounts.map((a) => {
    const flags = [
      a.provider,
      a.label,
      a.defaultRegion && `region=${a.defaultRegion}`,
      a.readonly ? 'read-only' : 'read-write',
      `source=${a.source}`,
      a.credential.configured ? 'credential ok' : `credential missing (${a.credential.detail ?? 'not set'})`,
    ].filter(Boolean)
    return `- ${a.id}: ${flags.join(' · ')}`
  }).join('\n')
}
