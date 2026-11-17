import { defineTool, ToolArgsError } from '@deepseek-ai/dsh-tools'
import { getPath } from '../core/json-path.js'
import type { JsonValue } from '../core/types.js'
import type { Runtime } from '../runtime.js'
import { VIEW_CATALOG } from '../view/catalog.js'
import { compileView } from '../view/compile.js'
import type { CompiledView, ViewRoot } from '../view/spec.js'
import { validateView } from '../view/validate.js'

const VISUALIZE_TOOL = 'cloud_visualize'

interface VisualizeValue {
  title?: string
  summary: string[]
  truncated: boolean
  bytes: number
  /** Not shown to the model; projected into presentation metadata. */
  view: CompiledView
}

/** Models often write "type" for "kind"; accept it on components (root items and tab items only). */
function normalizeKinds(view: unknown): unknown {
  if (!view || typeof view !== 'object' || Array.isArray(view)) return view
  const root = view as Record<string, unknown>
  return Array.isArray(root.items) ? { ...root, items: root.items.map(normalizeNode) } : root
}

function normalizeNode(node: unknown): unknown {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return node
  const out: Record<string, unknown> = { ...(node as Record<string, unknown>) }
  if (out.kind === undefined && typeof out.type === 'string') {
    out.kind = out.type
    delete out.type
  }
  if (out.kind === 'tabs' && Array.isArray(out.tabs)) {
    out.tabs = out.tabs.map((t) => (t && typeof t === 'object' && Array.isArray((t as { items?: unknown }).items)
      ? { ...(t as object), items: ((t as { items: unknown[] }).items).map(normalizeNode) } : t))
  }
  return out
}

export function visualizeTool(rt: Runtime) {
  return defineTool({
    name: VISUALIZE_TOOL,
    description:
      'Show data to the user as stats, tables, charts and details (Cloud View). Use it when a visual summary helps — '
      + 'lists of resources, comparisons, distributions, trends — not for simple answers. Prefer binding data to cloud_call '
      + 'results by ref instead of copying values. You only get a short confirmation back; the user sees the rendered view.\n'
      + VIEW_CATALOG,
    parameters: {
      view: { type: 'object', required: true, additionalProperties: true, description: 'Cloud View spec: { "title"?: string, "items": Component[] }.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => {
        const v = value as unknown as VisualizeValue
        return [{ type: 'text', text: `Rendered${v.title ? ` "${v.title}"` : ''} for the user:\n- ${v.summary.join('\n- ')}${v.truncated ? '\n(some data was cut to the size limit)' : ''}` }]
      },
      presentationMeta: (_args, value) => ({ kind: 'cloud-view', view: (value as unknown as VisualizeValue).view as unknown as JsonValue }),
    },
    presentCall: (args) => ({ card: 'generic', title: `Visualize · ${String((args.view as { title?: string } | undefined)?.title ?? '')}`, kind: 'read', content: [] }),
    async execute(args, exec) {
      const spec = { v: 1, ...(normalizeKinds(args.view) as object) } as ViewRoot
      const errors = validateView(spec)
      if (errors.length) throw new ToolArgsError(errors)
      const session = exec.agent?.id ?? 'default'
      const { view, summary } = compileView(spec, {
        resolve: (b) => {
          const stored = rt.results.get(session, b.ref)
          try {
            return getPath(stored.data, b.path ?? '')
          } catch (err) {
            throw new ToolArgsError([(err as Error).message])
          }
        },
      })
      const value: VisualizeValue = {
        ...(view.title ? { title: view.title } : {}),
        summary: summary.length ? summary : ['layout only'],
        truncated: view.truncated === true,
        bytes: JSON.stringify(view).length,
        view,
      }
      return JSON.parse(JSON.stringify(value)) as Record<string, JsonValue>
    },
  })
}
