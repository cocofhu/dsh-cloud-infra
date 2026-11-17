/** The subset of DSH client contracts this plugin relies on. */

export interface ToolResultBlock {
  kind: 'tool-result'
  callId: string
  name: string
  call: { name: string; argsRaw: string } | null
  content: readonly { type: string; text?: string }[]
  isError: boolean
  error?: { name: string; code: string; reason?: string }
  meta?: unknown
}

export interface ToolCallBlock {
  argsRaw?: string
}

export type ToolViewProps =
  | { phase: 'preparing' | 'start'; block: ToolCallBlock; toolName: string; callId: string; useDisclosure?: UseDisclosure }
  | { phase: 'result'; block: ToolResultBlock; toolName: string; callId: string; useDisclosure?: UseDisclosure }

type UseDisclosure = () => { expanded: boolean; toggle: () => void }

export interface SlotsService {
  inject: (name: string, factory: () => unknown) => void
  register: (options: Record<string, unknown>, component: unknown) => () => void
}

export interface ClientContext {
  get: (name: string) => unknown
  effect: (factory: () => () => void, label?: string) => void
  /** Sub-plugins load only once their own services exist. */
  plugin?: (plugin: { name?: string; inject: string[]; apply: (ctx: ClientContext) => void }) => void
}

/** Injected by DSH's module loader: the package-local async chunk loader. */
export interface ModuleRequire {
  (spec: string): unknown
  async?: (spec: string) => Promise<unknown>
}

export interface EchartsChunk {
  mount: (el: HTMLElement, option: Record<string, unknown>, dark: boolean) => { update: (option: Record<string, unknown>, dark: boolean) => void; resize: () => void; dispose: () => void }
}
