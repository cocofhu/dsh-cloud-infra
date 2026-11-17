import * as React from 'react'
import { ConfigProvider } from './tea.js'

const { useMemo, useSyncExternalStore } = React

export type Lang = 'zh' | 'en'

export const zh = {
  'render.error': '渲染 {kind} 失败：{message}',
  'view.truncated': '部分数据超过展示上限，已截断。',
  'list.collapse': '收起',
  'list.expand': '展开全部（{count} 行）',
  'table.filter': '输入关键字筛选',
  'table.filterAria': '筛选表格',
  'table.noMatch': '没有匹配的数据',
  'table.empty': '暂无数据',
  'table.partial': '共 {total} 行，展示前 {shown} 行。',
  'chart.loading': '加载图表…',
  'chart.failed': '图表加载失败：{error}',
  'chart.truncated': '数据点过多，只展示最近的部分。',

  'tool.call': '云 API',
  'tool.search': '搜索云 API',
  'tool.describe': '云 API 文档',
  'tool.result': '读取结果',
  'tool.accounts': '云账号',
  'tool.visualize': '可视化',
  'tool.regions': '{count} 个地域',
  'tool.regionsFailed': '{count} 个地域（{failed} 个失败）',
  'tool.callFailed': '调用失败',
  'tool.failed': '失败',
  'tool.done': '完成',
  'tool.generating': '生成中…',
  'tool.shown': '已在对话中展示',
  'tool.truncated': '结果较大，此处只展示节选。',
  'risk.read': '只读',
  'risk.write': '写操作',
  'risk.danger': '高危',
  'meta.account': '账号',
  'meta.region': '地域',
  'meta.version': '版本',
  'meta.failedRegions': '失败地域',

  'settings.title': 'Cloud Infra · 云账号',
  'settings.subtitle': '管理 Agent 可调用的云账号。密钥保存在 DSH 凭据存储中，不进入配置文件和模型上下文。',
  'settings.unavailable': '设置服务不可用：账号只能在 profile 配置里编辑。',
  'settings.loading': '读取中…',
  'settings.empty': '还没有账号。添加一个腾讯云账号后，Agent 就能调用云 API。',
  'col.account': '账号',
  'col.credential': '凭据',
  'col.region': '默认地域',
  'col.mode': '权限',
  'col.test': '连接',
  'col.ops': '操作',
  'cred.store': 'DSH 凭据',
  'region.unset': '未设置',
  'mode.readonly': '只读',
  'mode.writable': '可写（需审批）',
  'test.running': '测试中…',
  'test.none': '未测试',
  'test.ok': '连接成功 · {identity}',
  'test.failed': '失败',
  'op.test': '测试连接',
  'op.edit': '编辑',
  'op.delete': '删除',
  'confirm.delete': '删除账号 {id}？',
  'confirm.deleteSecret': '保存的密钥也会一并删除。',
  'form.id': '账号 ID',
  'form.label': '显示名称',
  'form.labelPlaceholder': '生产环境',
  'form.region': '默认地域',
  'form.source': '凭据来源',
  'form.sourceStore': 'SecretId / SecretKey（DSH 凭据存储）',
  'form.sourceTccli': 'tccli 配置（~/.tccli）',
  'form.keep': '留空则保持不变',
  'form.permission': '权限',
  'form.readonly': '只读账号（拒绝一切写操作，不弹审批）',
  'form.save': '保存',
  'form.cancel': '取消',
  'form.add': '添加账号',
  'form.import': '导入 tccli:{name}',
} satisfies Record<string, string>

export type MessageKey = keyof typeof zh

export const en = {
  'render.error': 'Failed to render {kind}: {message}',
  'view.truncated': 'Some data exceeded the display limit and was cut off.',
  'list.collapse': 'Collapse',
  'list.expand': 'Show all ({count} rows)',
  'table.filter': 'Filter by keyword',
  'table.filterAria': 'Filter table',
  'table.noMatch': 'No matching rows',
  'table.empty': 'No data',
  'table.partial': '{total} rows in total; showing the first {shown}.',
  'chart.loading': 'Loading chart…',
  'chart.failed': 'Failed to load chart: {error}',
  'chart.truncated': 'Too many data points; showing the most recent ones.',

  'tool.call': 'Cloud API',
  'tool.search': 'Search cloud APIs',
  'tool.describe': 'Cloud API docs',
  'tool.result': 'Read result',
  'tool.accounts': 'Cloud accounts',
  'tool.visualize': 'Visualize',
  'tool.regions': '{count} regions',
  'tool.regionsFailed': '{count} regions ({failed} failed)',
  'tool.callFailed': 'Call failed',
  'tool.failed': 'Failed',
  'tool.done': 'Done',
  'tool.generating': 'Generating…',
  'tool.shown': 'Shown in the conversation',
  'tool.truncated': 'The result is large; showing an excerpt.',
  'risk.read': 'Read',
  'risk.write': 'Write',
  'risk.danger': 'High risk',
  'meta.account': 'Account',
  'meta.region': 'Region',
  'meta.version': 'Version',
  'meta.failedRegions': 'Failed regions',

  'settings.title': 'Cloud Infra · Cloud accounts',
  'settings.subtitle': 'Manage the cloud accounts the agent can call. Secrets stay in DSH credential storage, never in config files or the model context.',
  'settings.unavailable': 'The settings service is unavailable; accounts can only be edited in the profile config.',
  'settings.loading': 'Loading…',
  'settings.empty': 'No accounts yet. Add a Tencent Cloud account so the agent can call cloud APIs.',
  'col.account': 'Account',
  'col.credential': 'Credential',
  'col.region': 'Default region',
  'col.mode': 'Permission',
  'col.test': 'Connection',
  'col.ops': 'Actions',
  'cred.store': 'DSH credential',
  'region.unset': 'Not set',
  'mode.readonly': 'Read-only',
  'mode.writable': 'Writable (asks for approval)',
  'test.running': 'Testing…',
  'test.none': 'Not tested',
  'test.ok': 'Connected · {identity}',
  'test.failed': 'Failed',
  'op.test': 'Test',
  'op.edit': 'Edit',
  'op.delete': 'Delete',
  'confirm.delete': 'Delete account {id}?',
  'confirm.deleteSecret': ' Its saved secret is deleted too.',
  'form.id': 'Account ID',
  'form.label': 'Display name',
  'form.labelPlaceholder': 'Production',
  'form.region': 'Default region',
  'form.source': 'Credential source',
  'form.sourceStore': 'SecretId / SecretKey (DSH credential storage)',
  'form.sourceTccli': 'tccli config (~/.tccli)',
  'form.keep': 'Leave empty to keep the current value',
  'form.permission': 'Permission',
  'form.readonly': 'Read-only account (refuse every write without asking)',
  'form.save': 'Save',
  'form.cancel': 'Cancel',
  'form.add': 'Add account',
  'form.import': 'Import tccli:{name}',
} satisfies Record<MessageKey, string>

const MESSAGES: Record<Lang, Record<MessageKey, string>> = { zh, en }

/** The subset of DSH's client LocaleRuntime this plugin reads. */
export interface LocaleRuntime {
  getSnapshot(): { active: string; locales: readonly { id: string; fallback?: string }[] }
  subscribe(fn: () => void): () => void
}

let runtime: LocaleRuntime | undefined
let unsubscribeRuntime: (() => void) | undefined
let defaultLang: Lang = typeof navigator !== 'undefined' && /^zh\b/i.test(navigator.language) ? 'zh' : 'en'
const listeners = new Set<() => void>()

function notify(): void {
  for (const fn of listeners) fn()
}

/** Follow DSH's active locale; without one (tests, the design page) the default language applies. */
export function setLocaleRuntime(next: LocaleRuntime | undefined): void {
  unsubscribeRuntime?.()
  runtime = next
  unsubscribeRuntime = next?.subscribe(notify)
  notify()
}

export function setDefaultLang(lang: Lang): void {
  defaultLang = lang
  notify()
}

/** Walk DSH's fallback chain (e.g. ja -> en) to the first language this plugin ships. */
export function currentLang(): Lang {
  if (!runtime) return defaultLang
  const { active, locales } = runtime.getSnapshot()
  const seen = new Set<string>()
  for (let id: string | undefined = active; id && !seen.has(id); id = locales.find((l) => l.id === id)?.fallback) {
    seen.add(id)
    const base = id.toLowerCase().split(/[-_]/)[0]
    if (base === 'zh' || base === 'en') return base
  }
  return 'en'
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

export type Translate = (key: MessageKey, params?: Record<string, string | number>) => string

function translator(lang: Lang): Translate {
  return (key, params) => MESSAGES[lang][key].replace(/\{(\w+)\}/g, (m, name: string) => (params && name in params ? String(params[name]) : m))
}

function useLang(): Lang {
  return useSyncExternalStore(subscribe, currentLang, currentLang)
}

export function useT(): Translate {
  const lang = useLang()
  return useMemo(() => translator(lang), [lang])
}

/** Tea's own copy (pagination, empty states) follows the same language. */
export function TeaLocale({ children }: { children: React.ReactNode }) {
  return <ConfigProvider locale={useLang()}>{children}</ConfigProvider>
}
