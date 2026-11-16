import type { PrefixRules } from '../../core/risk.js'

export const TENCENT_PREFIXES: PrefixRules = {
  read: ['Describe', 'List', 'Get', 'Query', 'Inquiry', 'Inquire', 'Check', 'Search', 'Preview'],
  danger: [
    'Delete', 'Terminate', 'Destroy', 'Release', 'Remove', 'Reset', 'Isolate',
    'Stop', 'Reboot', 'Shutdown', 'Offline', 'Unbind', 'Disassociate', 'Detach',
  ],
  dangerPatterns: ['Modify*Password'],
}
