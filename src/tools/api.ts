import { defineTool } from '@deepseek-ai/dsh-tools'
import { renderDescription, type ActionDescription, type SearchHit } from '../core/catalog.js'
import type { JsonValue } from '../core/types.js'
import { DEFAULT_PROVIDER, type Runtime } from '../runtime.js'

interface SearchValue {
  provider: string
  query: string
  service?: string
  total: number
  offset: number
  hits: (SearchHit & { risk: string })[]
}

export function apiSearchTool(rt: Runtime) {
  return defineTool({
    name: 'cloud_api_search',
    description:
      'Search the cloud API index for actions by keywords (English or Chinese, e.g. "cvm instance list", "安全组 规则", "monitor metric data"). '
      + 'Returns service id, newest version, action and a one-line summary. With only "service", lists that product\'s actions.',
    parameters: {
      provider: { type: 'string', description: 'Cloud provider id. Default "tencent".' },
      query: { type: 'string', description: 'Keywords. May be empty when "service" is given.' },
      service: { type: 'string', description: 'Restrict to one product id, e.g. cvm.' },
      limit: { type: 'integer', description: 'Max hits, 1-100. Default 20.' },
      offset: { type: 'integer', description: 'Skip this many hits, for paging.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: renderSearch(value as unknown as SearchValue) }],
    },
    presentCall: (args) => ({ card: 'generic', title: `搜索云 API · ${String(args.query ?? args.service ?? '')}`, kind: 'search', content: [] }),
    async execute(args) {
      const providerId = args.provider || DEFAULT_PROVIDER
      const provider = rt.providers.get(providerId)
      const query = args.query?.trim() ?? ''
      const { total, hits } = provider.catalog.search(query, { service: args.service, limit: args.limit, offset: args.offset })
      const value: SearchValue = {
        provider: providerId,
        query,
        ...(args.service ? { service: args.service } : {}),
        total,
        offset: Math.max(0, args.offset ?? 0),
        hits: hits.map((h) => ({ ...h, risk: provider.classify({ provider: providerId, account: '', service: h.service, action: h.action, params: {} }) })),
      }
      return JSON.parse(JSON.stringify(value)) as Record<string, JsonValue>
    },
  })
}

function renderSearch(v: SearchValue): string {
  if (!v.hits.length) return `No action matches "${v.query}"${v.service ? ` in ${v.service}` : ''}. Try other keywords (English action words like Describe/Instance work best) or list a product with service only.`
  const lines = v.hits.map((h) => `- ${h.service} ${h.version} ${h.action} [${h.risk}] — ${h.summary}`)
  const end = v.offset + v.hits.length
  const more = end < v.total ? `\n(${v.total - end} more; pass offset=${end})` : ''
  return `${v.total} match(es)${v.service ? ` in ${v.service}` : ''}:\n${lines.join('\n')}${more}\nUse cloud_api_describe for parameters.`
}

export function apiDescribeTool(rt: Runtime) {
  return defineTool({
    name: 'cloud_api_describe',
    description: 'Show the full input parameters (types, required flags, field docs, nested structures) and top-level response fields of one cloud API action.',
    parameters: {
      provider: { type: 'string', description: 'Cloud provider id. Default "tencent".' },
      service: { type: 'string', required: true, description: 'Product id, e.g. cvm.' },
      action: { type: 'string', required: true, description: 'PascalCase action, e.g. DescribeInstances.' },
      version: { type: 'string', description: 'API version; defaults to the newest.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => {
        const v = value as unknown as ActionDescription & { risk: string }
        return [{ type: 'text', text: renderDescription(v, v.risk) }]
      },
    },
    presentCall: (args) => ({ card: 'generic', title: `云 API 文档 · ${String(args.service ?? '')}.${String(args.action ?? '')}`, kind: 'read', content: [] }),
    async execute(args) {
      const providerId = args.provider || DEFAULT_PROVIDER
      const provider = rt.providers.get(providerId)
      const description = provider.catalog.describe(args.service, args.action.trim(), args.version?.trim() || undefined)
      const risk = provider.classify({ provider: providerId, account: '', service: description.service, action: description.action, params: {} })
      return JSON.parse(JSON.stringify({ ...description, risk })) as Record<string, JsonValue>
    },
  })
}
