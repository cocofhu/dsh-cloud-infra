import * as React from 'react'
import type { CompiledView } from '../view/spec.js'
import { ViewRenderer } from './renderer/index.js'
import type { ClientContext, SlotsService } from './types.js'

/** Chat node kind for a Cloud View rendered at Turn level, outside the tool-call group. */
const CARD_NODE_KIND = 'cloud-infra-view'

interface CardState {
  seq: number
  view: CompiledView
}

interface SessionEvent {
  type: string
  seq: number
  surfaceOp?: string
  data?: { message?: { source?: { callId?: unknown } }; meta?: unknown; isError?: boolean }
}

interface Match {
  event: SessionEvent
  location: unknown
}

interface NodeContext {
  key: string
  id: string
  start?: Match
  matches: readonly Match[]
  state: CardState | undefined
  current: ReadonlyMap<string, unknown>
}

interface CardNode {
  key: string
  kind: string
  id: string
  target: 'chat'
  anchorSeq: number
  location: unknown
  visibility: 'visible'
  groupTree: 'turn'
  data: { view: CompiledView }
}

interface ConversationService {
  events: { register: (definition: Record<string, unknown>) => () => void }
}

let enabled = false

/** Whether visualization results render as Turn-level cards; the tool row then only records the call. */
export function cardsEnabled(): boolean {
  return enabled
}

function viewOf(event: SessionEvent): CompiledView | undefined {
  if (event.type !== 'tool/result' || event.surfaceOp !== 'append' || event.data?.isError) return undefined
  const meta = event.data?.meta as { kind?: string; view?: CompiledView } | undefined
  return meta?.kind === 'cloud-view' && meta.view ? meta.view : undefined
}

function stateOf(match: Match): CardState | undefined {
  const view = viewOf(match.event)
  return view ? { seq: match.event.seq, view } : undefined
}

export const cardDefinition = {
  kind: CARD_NODE_KIND,
  target: 'chat',
  match: {
    'tool/result': (event: SessionEvent) => {
      const callId = event.data?.message?.source?.callId
      return viewOf(event) && callId != null ? { id: String(callId), role: 'start' as const } : null
    },
  },
  start: (_context: NodeContext, match: Match) => stateOf(match),
  update: (context: NodeContext, match: Match) => stateOf(match) ?? context.state,
  buildViewNode: (context: NodeContext): CardNode | null => {
    const state = context.state
    if (!state) return null
    const location = context.start?.location ?? context.matches[0]?.location ?? { kind: 'unresolved' }
    const current = context.current.get('chat') as CardNode | null | undefined
    if (current && current.data.view === state.view && current.anchorSeq === state.seq && current.location === location) return current
    return {
      key: context.key, kind: CARD_NODE_KIND, id: context.id, target: 'chat', anchorSeq: state.seq,
      location, visibility: 'visible', groupTree: 'turn', data: { view: state.view },
    }
  },
}

export function CloudViewCard({ node }: { node: { data: { view: CompiledView } } }) {
  return <div className="ci-root"><ViewRenderer view={node.data.view} /></div>
}

export const cardPlugin = {
  name: 'cloud-infra-view-card',
  inject: ['slots', 'uiConversation'],
  apply(ctx: ClientContext): void {
    const slots = ctx.get('slots') as SlotsService
    const conversation = ctx.get('uiConversation') as ConversationService
    ctx.effect(() => {
      enabled = true
      const dispose = conversation.events.register(cardDefinition)
      return () => { enabled = false; dispose() }
    }, CARD_NODE_KIND)
    slots.inject('conversation.chat.node', () => slots.register({ name: 'conversation.chat.node', key: CARD_NODE_KIND }, CloudViewCard))
  },
}
