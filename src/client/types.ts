/** The subset of DSH client contracts this plugin relies on. */

export interface ToolArgsView {
  text: (key: string) => string | undefined
}

export interface ToolResultBlock {
  kind: 'tool-result'
  callId: string
  name: string
  args?: ToolArgsView
  call: { name: string; argsRaw: string } | null
  content: readonly { type: string; text?: string }[]
  isError: boolean
  error?: { name: string; code: string; reason?: string }
  meta?: unknown
}

export interface ToolCallBlock {
  argsRaw?: string
  args?: ToolArgsView
  phase?: string
}

export type ToolViewProps =
  | { phase: 'preparing' | 'start'; block: ToolCallBlock; toolName: string; callId: string; useDisclosure?: UseDisclosure }
  | { phase: 'result'; block: ToolResultBlock; toolName: string; callId: string; useDisclosure?: UseDisclosure }

export type UseDisclosure = () => { expanded: boolean; toggle: () => void }

export interface SlotsService {
  inject: (name: string, factory: () => unknown) => void
  register: (options: Record<string, unknown>, component: unknown) => () => void
}

export interface ClientContext {
  get: (name: string) => unknown
  effect: (factory: () => () => void, label?: string) => void
}

/** Injected by DSH's module loader: the package-local async chunk loader. */
export interface ModuleRequire {
  (spec: string): unknown
  async?: (spec: string) => Promise<unknown>
}

export interface EchartsChunk {
  mount: (el: HTMLElement, option: Record<string, unknown>, dark: boolean) => { update: (option: Record<string, unknown>, dark: boolean) => void; resize: () => void; dispose: () => void }
}
