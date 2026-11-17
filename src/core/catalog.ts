import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CloudError, CloudErrorCode } from './errors.js'

/** [name, type, required (1|0), doc] — the layout written by scripts/build-api-index.ts. */
export type IndexField = [string, string, number, string]
export interface IndexType { doc?: string; fields: IndexField[] }
export interface IndexAction { doc: string; input: string | null; output: string | null }
export interface IndexVersion { actions: Record<string, IndexAction>; types: Record<string, IndexType> }
interface ServiceFile { service: string; versions: Record<string, IndexVersion> }
interface CatalogFile {
  sdkVersion?: string
  services: Record<string, { latest: string; versions: string[] }>
  /** [service, action, summary, version?] — version only when older than the service's latest. */
  actions: ([string, string, string] | [string, string, string, string])[]
}

export interface SearchHit {
  service: string
  version: string
  action: string
  summary: string
}

export interface ParamNode {
  name: string
  type: string
  required: boolean
  doc?: string
  /** Expanded struct members; absent for scalars, cycles and the depth limit. */
  children?: ParamNode[]
  /** Set when the struct was already expanded elsewhere or the depth limit was hit. */
  collapsed?: 'repeat' | 'depth'
}

export interface ActionDescription {
  service: string
  version: string
  action: string
  doc: string
  params: ParamNode[]
  response: { name: string; type: string; doc?: string }[]
}

/** English action summary and top-level parameter docs, when the international SDK has the action. */
export interface EnglishDocs { summary: string; params: Record<string, string> }

export interface ApiCatalog {
  hasService(service: string): boolean
  /** Newest version of the service, or with `action` the newest version that has that action. */
  latestVersion(service: string, action?: string): string | undefined
  versions(service: string): string[]
  search(query: string, options?: { service?: string; limit?: number; offset?: number }): { total: number; hits: SearchHit[] }
  describe(service: string, action: string, version?: string): ActionDescription
  english?(service: string, action: string): EnglishDocs | undefined
}

const MAX_DEPTH = 4
const SERVICE_CACHE = 16

/**
 * Reads the build-time index from `<dir>/catalog.json` and `<dir>/<service>.json`.
 * The catalog loads on first use; service files load on demand into a small LRU.
 */
export class IndexedCatalog implements ApiCatalog {
  private catalog?: CatalogFile
  private olderActions?: Map<string, string>
  private readonly serviceFiles = new Map<string, ServiceFile>()
  private readonly englishFiles = new Map<string, Record<string, EnglishDocs>>()

  constructor(private readonly dir: string) {}

  hasService(service: string): boolean {
    return Object.hasOwn(this.load().services, service)
  }

  latestVersion(service: string, action?: string): string | undefined {
    if (!this.hasService(service)) return undefined
    return (action && this.olderVersions().get(`${service}.${action}`)) || this.load().services[service]!.latest
  }

  versions(service: string): string[] {
    return this.hasService(service) ? [...this.load().services[service]!.versions] : []
  }

  search(query: string, options: { service?: string; limit?: number; offset?: number } = {}): { total: number; hits: SearchHit[] } {
    const catalog = this.load()
    const service = options.service?.trim().toLowerCase()
    if (service && !this.hasService(service)) {
      throw new CloudError(CloudErrorCode.NOT_FOUND, `unknown service "${service}"; ${suggestServices(Object.keys(catalog.services), service)}`)
    }
    const limit = Math.min(100, Math.max(1, options.limit ?? 20))
    const offset = Math.max(0, options.offset ?? 0)
    const q = parseQuery(query)
    const empty = !q.groups.length && !q.services.length
    const scored: { score: number; row: CatalogFile['actions'][number] }[] = []
    for (const row of catalog.actions) {
      if (service && row[0] !== service) continue
      const score = empty ? 1 : scoreRow(row, q)
      if (score > 0) scored.push({ score, row })
    }
    scored.sort((a, b) => b.score - a.score || a.row[1].length - b.row[1].length)
    const hits = scored.slice(offset, offset + limit).map(({ row: [svc, action, summary, version] }) => ({
      service: svc, version: version ?? catalog.services[svc]!.latest, action, summary,
    }))
    return { total: scored.length, hits }
  }

  describe(service: string, action: string, version?: string): ActionDescription {
    const svc = service.trim().toLowerCase()
    if (!this.hasService(svc)) {
      throw new CloudError(CloudErrorCode.NOT_FOUND, `unknown service "${svc}"; ${suggestServices(Object.keys(this.load().services), svc)}`)
    }
    const file = this.serviceFile(svc)
    const ver = version || this.latestVersion(svc, action)!
    const index = file.versions[ver]
    if (!index) {
      throw new CloudError(CloudErrorCode.NOT_FOUND, `${svc} has no version ${ver}; available: ${Object.keys(file.versions).join(', ')}`)
    }
    const def = index.actions[action]
    if (!def) {
      const near = this.search(action, { service: svc, limit: 8 }).hits.map((h) => h.action)
      throw new CloudError(CloudErrorCode.NOT_FOUND, `${svc} ${ver} has no action "${action}"${near.length ? `; similar: ${near.join(', ')}` : '; use cloud_api_search'}`)
    }
    const seen = new Set<string>()
    const params = def.input ? expand(index, def.input, 0, seen) : []
    const response = def.output ? (index.types[def.output]?.fields ?? []).map(([name, type, , doc]) => ({ name, type, ...(doc ? { doc } : {}) })) : []
    return { service: svc, version: ver, action, doc: def.doc, params, response }
  }

  english(service: string, action: string): EnglishDocs | undefined {
    const svc = service.trim().toLowerCase()
    if (!/^[a-z][a-z0-9]*$/.test(svc)) return undefined
    let actions = this.englishFiles.get(svc)
    if (actions) {
      this.englishFiles.delete(svc)
    } else {
      try {
        actions = (JSON.parse(readFileSync(join(this.dir, 'en', `${svc}.json`), 'utf8')) as { actions: Record<string, EnglishDocs> }).actions
      } catch {
        actions = {}
      }
    }
    this.englishFiles.set(svc, actions)
    if (this.englishFiles.size > SERVICE_CACHE) this.englishFiles.delete(this.englishFiles.keys().next().value!)
    return Object.hasOwn(actions, action) ? actions[action] : undefined
  }

  private load(): CatalogFile {
    this.catalog ??= JSON.parse(readFileSync(join(this.dir, 'catalog.json'), 'utf8')) as CatalogFile
    return this.catalog
  }

  private olderVersions(): Map<string, string> {
    if (!this.olderActions) {
      this.olderActions = new Map()
      for (const [svc, action, , version] of this.load().actions) if (version) this.olderActions.set(`${svc}.${action}`, version)
    }
    return this.olderActions
  }

  private serviceFile(service: string): ServiceFile {
    const cached = this.serviceFiles.get(service)
    if (cached) {
      this.serviceFiles.delete(service)
      this.serviceFiles.set(service, cached)
      return cached
    }
    const file = JSON.parse(readFileSync(join(this.dir, `${service}.json`), 'utf8')) as ServiceFile
    this.serviceFiles.set(service, file)
    if (this.serviceFiles.size > SERVICE_CACHE) this.serviceFiles.delete(this.serviceFiles.keys().next().value!)
    return file
  }
}

function expand(index: IndexVersion, typeName: string, depth: number, seen: Set<string>): ParamNode[] {
  const def = index.types[typeName]
  if (!def) return []
  seen.add(typeName)
  return def.fields.map(([name, type, required, doc]) => {
    const node: ParamNode = { name, type, required: required === 1, ...(doc ? { doc } : {}) }
    const struct = type.replace(/\[\]$/, '')
    if (index.types[struct]) {
      if (seen.has(struct)) node.collapsed = 'repeat'
      else if (depth + 1 >= MAX_DEPTH) node.collapsed = 'depth'
      else node.children = expand(index, struct, depth + 1, seen)
    }
    return node
  })
}

/** ASCII words lowercased and split on camel case; CJK runs as bigrams. */
export function tokenize(text: string): string[] {
  const terms = new Set<string>()
  for (const word of text.split(/[\s,，。.:：/_-]+/).filter(Boolean)) {
    for (const part of word.split(/(?<=[a-z0-9])(?=[A-Z])/)) {
      const ascii = part.replace(/[^\x00-\x7f]+/g, ' ').trim().toLowerCase()
      for (const a of ascii.split(/\s+/).filter(Boolean)) terms.add(a)
    }
    for (const run of word.match(/[\u3400-\u9fff]+/g) ?? []) {
      if (run.length === 1) terms.add(run)
      for (let i = 0; i + 1 < run.length; i++) terms.add(run.slice(i, i + 2))
    }
  }
  return [...terms]
}

function camelWords(action: string): string[] {
  return action.split(/(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/).map((w) => w.toLowerCase())
}

/** Generic Chinese words that appear in most summaries; they only break ties. */
const WEAK_TERMS = new Set(['查询', '获取', '列表', '信息', '详情', '详细', '查看', '接口', '用于', '一个', '多个', '所有', '当前'])

/** Chinese product names mapped to service ids; matched names are removed from the query text. */
const CJK_PRODUCTS: [string, string][] = [
  ['云服务器', 'cvm'], ['服务器', 'cvm'], ['主机', 'cvm'], ['私有网络', 'vpc'], ['负载均衡', 'clb'], ['云数据库', 'cdb'],
  ['云硬盘', 'cbs'], ['轻量应用服务器', 'lighthouse'], ['轻量服务器', 'lighthouse'], ['轻量', 'lighthouse'], ['对象存储', 'cos'], ['云监控', 'monitor'],
  ['容器服务', 'tke'], ['访问管理', 'cam'], ['费用中心', 'billing'], ['云解析', 'dnspod'], ['内容分发', 'cdn'], ['证书', 'ssl'],
  ['日志服务', 'cls'], ['云函数', 'scf'], ['弹性伸缩', 'as'], ['标签', 'tag'],
]

/** Chinese resource nouns mapped to the English words used in action names. */
const CJK_NOUNS: [string, string][] = [
  ['实例', 'instance'], ['镜像', 'image'], ['快照', 'snapshot'], ['安全组', 'security'], ['子网', 'subnet'],
  ['私有网络', 'vpc'], ['云硬盘', 'disk'], ['磁盘', 'disk'], ['负载均衡', 'load'], ['地域', 'region'], ['可用区', 'zone'],
  ['监控', 'monitor'], ['指标', 'metric'], ['告警', 'alarm'], ['账单', 'bill'], ['费用', 'cost'], ['证书', 'certificate'],
  ['域名', 'domain'], ['密钥', 'key'], ['日志', 'log'], ['数据库', 'db'], ['存储桶', 'bucket'], ['标签', 'tag'],
  ['用户', 'user'], ['角色', 'role'], ['策略', 'polic'], ['规则', 'polic'], ['规格', 'type'], ['机型', 'type'], ['配额', 'quota'],
  ['监听器', 'listener'], ['弹性公网', 'address'], ['网卡', 'network'], ['集群', 'cluster'], ['节点', 'node'], ['备份', 'backup'], ['任务', 'task'],
]

/** Chinese verbs mapped to the first word of action names. */
const CJK_VERBS: [string, string][] = [
  ['查询', 'describe'], ['列表', 'describe'], ['查看', 'describe'], ['获取', 'get'], ['创建', 'create'], ['新建', 'create'],
  ['删除', 'delete'], ['修改', 'modify'], ['启动', 'start'], ['开机', 'start'], ['关闭', 'stop'], ['关机', 'stop'],
  ['重启', 'reboot'], ['销毁', 'terminate'], ['退还', 'terminate'], ['绑定', 'associate'], ['解绑', 'disassociate'],
]

let vocabulary: string[] | undefined

/** Split a CJK run on known words (longest first); only the leftovers become bigrams. */
function segment(run: string): string[] {
  vocabulary ??= [...new Set([...WEAK_TERMS, ...[...CJK_PRODUCTS, ...CJK_NOUNS, ...CJK_VERBS].map(([zh]) => zh)])].sort((a, b) => b.length - a.length)
  const terms: string[] = []
  let rest = ''
  for (let i = 0; i < run.length;) {
    const word = vocabulary.find((w) => run.startsWith(w, i))
    if (!word) { rest += run[i]; i++; continue }
    if (rest) { terms.push(...tokenize(rest)); rest = '' }
    terms.push(word)
    i += word.length
  }
  if (rest) terms.push(...tokenize(rest))
  return [...new Set(terms)]
}

interface Query {
  whole: string
  /** One group per ASCII word or CJK run; a group counts as covered when any of its terms hits. */
  groups: string[][]
  services: string[]
  nouns: string[]
  verbs: string[]
}

function parseQuery(text: string): Query {
  const pick = (table: [string, string][], from: string) => [...new Set(table.filter(([zh]) => from.includes(zh)).map(([, en]) => en))]
  const services: string[] = []
  let rest = text
  for (const [zh, svc] of [...CJK_PRODUCTS].sort((a, b) => b[0].length - a[0].length)) {
    if (rest.includes(zh)) { services.push(svc); rest = rest.split(zh).join(' ') }
  }
  const groups: string[][] = []
  for (const word of rest.split(/[\s,，。.:：/_-]+/).filter(Boolean)) {
    for (const part of word.split(/(?<=[a-z0-9])(?=[A-Z])/)) {
      for (const a of part.replace(/[^\x00-\x7f]+/g, ' ').trim().toLowerCase().split(/\s+/).filter(Boolean)) groups.push([a])
    }
    for (const run of word.match(/[\u3400-\u9fff]+/g) ?? []) groups.push(segment(run))
  }
  return { whole: text.trim().toLowerCase(), groups, services: [...new Set(services)], nouns: pick(CJK_NOUNS, text), verbs: pick(CJK_VERBS, text) }
}

function scoreRow([service, action, summary]: CatalogFile['actions'][number], q: Query): number {
  const words = camelWords(action)
  const lowerAction = action.toLowerCase()
  let score = 0
  let covered = 0
  let counted = 0
  for (const group of q.groups) {
    let hit = false
    let weakOnly = true
    for (const term of group) {
      const weak = WEAK_TERMS.has(term)
      if (!weak) weakOnly = false
      let s = 0
      if (term === service) s = 8
      else if (words.includes(term)) s = 6
      else if (/^[a-z0-9]+$/.test(term) && words.some((w) => w.startsWith(term) || (term.length >= 4 && term.startsWith(w) && w.length >= 4))) s = 3
      else if (summary.includes(term)) s = weak ? 0.5 : term.length > 1 ? 2 : 1
      if (s && !weak) hit = true
      score += s
    }
    if (weakOnly) continue
    counted++
    if (hit) covered++
  }
  if (q.services.length) {
    if (!q.services.includes(service)) return 0
    score += 8
  }
  for (const en of q.nouns) if (words.some((w) => w.startsWith(en))) score += 3
  if (q.verbs.includes(words[0]!)) score += 3
  else if (!q.verbs.length && /^(describe|get|list|query)$/.test(words[0]!)) score += 1
  if (score <= 0 || (counted && !covered && !q.services.length && !q.nouns.length)) return 0
  const compact = q.whole.replace(/\s+/g, '')
  if (compact.length > 3 && lowerAction === compact) score += 20
  else if (compact.length > 3 && lowerAction.includes(compact)) score += 5
  const coverage = counted ? (covered + 1) / (counted + 1) : 1
  // Prefer general actions (DescribeInstances) over long specific ones on equal matches.
  return Math.max(0.01, score * coverage - 0.3 * Math.max(0, words.length - 2))
}

function suggestServices(all: string[], wanted: string): string {
  const near = all.filter((s) => s.startsWith(wanted.slice(0, 2)) || wanted.includes(s)).slice(0, 10)
  return near.length ? `similar: ${near.join(', ')}` : 'use cloud_api_search to find the product id'
}

/** Model-facing text for one action: parameters as an indented tree. */
export function renderDescription(d: ActionDescription, risk?: string): string {
  const lines = [`${d.service}.${d.action} (version ${d.version}${risk ? `, ${risk}` : ''})`]
  if (d.doc) lines.push(d.doc)
  lines.push('', d.params.length ? 'Parameters (* = required):' : 'Parameters: none')
  const walk = (nodes: ParamNode[], indent: string) => {
    for (const n of nodes) {
      const suffix = n.collapsed === 'repeat' ? ' (structure shown above)' : n.collapsed === 'depth' ? ' (nested structure omitted)' : ''
      lines.push(`${indent}- ${n.name}${n.required ? '*' : ''}: ${n.type}${suffix}${n.doc ? ` — ${n.doc}` : ''}`)
      if (n.children) walk(n.children, `${indent}  `)
    }
  }
  walk(d.params, '')
  if (d.response.length) {
    lines.push('', 'Response fields (top level):')
    for (const r of d.response) lines.push(`- ${r.name}: ${r.type}${r.doc ? ` — ${r.doc}` : ''}`)
  }
  return lines.join('\n')
}
