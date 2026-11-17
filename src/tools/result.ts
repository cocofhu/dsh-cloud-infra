import { defineTool, ToolArgsError } from '@deepseek-ai/dsh-tools'
import { getPath, parsePath } from '../core/json-path.js'
import { truncateJson } from '../core/truncate.js'
import type { JsonValue } from '../core/types.js'
import type { Runtime } from '../runtime.js'

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 200

export interface ResultSlice {
  ref: string
  path: string
  total?: number
  offset?: number
  items?: JsonValue[]
  value?: JsonValue
}

export function sliceResult(data: JsonValue, args: { path?: string; fields?: string[]; offset?: number; limit?: number }): Omit<ResultSlice, 'ref'> {
  const path = args.path?.trim() ?? ''
  try {
    parsePath(path)
    args.fields?.forEach((f) => parsePath(f))
  } catch (err) {
    throw new ToolArgsError([(err as Error).message])
  }
  const target = getPath(data, path)
  if (!Array.isArray(target)) return { path, value: target ?? null }
  const offset = Math.max(0, Math.floor(args.offset ?? 0))
  const limit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(args.limit ?? DEFAULT_LIMIT)))
  const page = target.slice(offset, offset + limit)
  const items = args.fields?.length
    ? page.map((item) => Object.fromEntries(args.fields!.map((f) => [f, getPath(item, f) ?? null])))
    : page
  return { path, total: target.length, offset, items }
}

export function resultTool(rt: Runtime) {
  return defineTool({
    name: 'cloud_result',
    description:
      'Read part of a cached cloud_call result without calling the cloud again. '
      + 'path uses a.b, a[0], a[*].b; when it points to an array, offset/limit page it and fields picks columns (paths relative to each item).',
    parameters: {
      ref: { type: 'string', required: true, description: 'ref returned by cloud_call, e.g. r3' },
      path: { type: 'string', description: 'Path inside the result, e.g. InstanceSet. Empty = whole result.' },
      fields: { type: 'array', items: { type: 'string' }, description: 'For arrays: keep only these item paths, e.g. ["InstanceId","Placement.Zone"].' },
      offset: { type: 'integer', description: 'For arrays: first item index. Default 0.' },
      limit: { type: 'integer', description: `For arrays: items to return, 1-${MAX_LIMIT}. Default ${DEFAULT_LIMIT}.` },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: renderSlice(value as unknown as ResultSlice, rt.config().maxOutputChars) }],
    },
    presentCall: (args) => ({ card: 'generic', title: `Read result · ${String(args.ref ?? '')}${args.path ? ` · ${String(args.path)}` : ''}`, kind: 'read', content: [] }),
    async execute(args, exec) {
      const stored = rt.results.get(exec.agent?.id ?? 'default', args.ref)
      const slice: ResultSlice = { ref: stored.ref, ...sliceResult(stored.data, args) }
      return JSON.parse(JSON.stringify(slice)) as Record<string, JsonValue>
    },
  })
}

function renderSlice(slice: ResultSlice, maxChars: number): string {
  if (slice.items) {
    const end = (slice.offset ?? 0) + slice.items.length
    const more = end < (slice.total ?? 0) ? ` · next offset=${end}` : ' · end'
    const { text } = truncateJson(slice.items, maxChars)
    return `${slice.ref}${slice.path ? ` ${slice.path}` : ''}: items ${slice.offset}-${end - 1} of ${slice.total}${more}\n${text}`
  }
  return `${slice.ref}${slice.path ? ` ${slice.path}` : ''}:\n${truncateJson(slice.value ?? null, maxChars).text}`
}
