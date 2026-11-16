import * as React from 'react'
import type { CompiledView } from '../view/spec.js'
import { Badge, PreBlock, Spinner, ViewRenderer } from './renderer/index.js'
import { cardsEnabled } from './chat-card.js'
import type { ToolResultBlock, ToolViewProps } from './types.js'

const { useState } = React

interface CallMeta {
  kind: 'cloud-call'
  ref: string
  account: string
  service: string
  version: string | null
  action: string
  region: string | null
  regions: string[] | null
  failedRegions: string[] | null
  risk: 'read' | 'write' | 'danger'
  requestId: string | null
  durationMs: number
  preview: string
  truncated: boolean
}

function parseArgs(props: ToolViewProps): Record<string, unknown> {
  const raw = props.phase === 'result' ? props.block.call?.argsRaw : props.block.argsRaw
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function resultText(block: ToolResultBlock): string {
  return block.content.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n')
}

function useOpen(props: ToolViewProps, initial: boolean) {
  const [local, setLocal] = useState(initial)
  if (props.useDisclosure) {
    const d = props.useDisclosure()
    return { open: d.expanded, toggle: d.toggle }
  }
  return { open: local, toggle: () => setLocal((v) => !v) }
}

const RISK_TEXT = { read: ['只读', 'success'], write: ['写操作', 'warning'], danger: ['高危', 'danger'] } as const

function Chevron({ open }: { open: boolean }) {
  return <svg className={`ci-chev${open ? ' open' : ''}`} viewBox="0 0 12 12" aria-hidden="true"><path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
}

function Shell({ title, sub, badges, open, toggle, children, busy }: {
  title: string; sub?: string; badges?: React.ReactNode; open: boolean; toggle: () => void; children?: React.ReactNode; busy?: boolean
}) {
  return (
    <div className="ci-root ci-tool">
      <button type="button" className="ci-tool-head" onClick={toggle} aria-expanded={open} disabled={!children}>
        {busy ? <Spinner /> : <Chevron open={open && !!children} />}
        <span className="ci-tool-title">{title}</span>
        <span className="ci-tool-sub">{sub}</span>
        {badges}
      </button>
      {open && children ? <div className="ci-tool-body">{children}</div> : null}
    </div>
  )
}

export function CallToolView(props: ToolViewProps) {
  const args = parseArgs(props)
  const target = `${String(args.service ?? '…')}.${String(args.action ?? '…')}`
  const { open, toggle } = useOpen(props, false)
  if (props.phase !== 'result') {
    return <Shell title={`云 API · ${target}`} sub={String(args.region ?? (Array.isArray(args.regions) ? `${args.regions.length} 个地域` : ''))} open={false} toggle={() => undefined} busy />
  }
  const block = props.block
  const meta = block.meta as CallMeta | undefined
  if (block.isError || meta?.kind !== 'cloud-call') {
    const reason = block.error?.reason || resultText(block)
    return (
      <Shell title={`云 API · ${target}`} sub={block.error?.code ?? '调用失败'} open={open} toggle={toggle}
        badges={<Badge tone="danger">失败</Badge>}>
        <div className="ci-err">{reason || '调用失败'}</div>
      </Shell>
    )
  }
  const [riskLabel, riskTone] = RISK_TEXT[meta.risk] ?? RISK_TEXT.write
  const where = meta.regions ? `${meta.regions.length} 个地域${meta.failedRegions?.length ? `（${meta.failedRegions.length} 个失败）` : ''}` : meta.region ?? ''
  return (
    <Shell title={`云 API · ${meta.service}.${meta.action}`} sub={[meta.account, where, `${meta.durationMs}ms`].filter(Boolean).join(' · ')} open={open} toggle={toggle}
      badges={<><Badge tone={riskTone}>{riskLabel}</Badge><Badge tone="neutral">{meta.ref}</Badge></>}>
      <div className="ci-meta">
        <span>账号<b>{meta.account}</b></span>
        {where ? <span>地域<b>{where}</b></span> : null}
        <span>版本<b>{meta.version ?? '—'}</b></span>
        <span>RequestId<b>{meta.requestId ?? '—'}</b></span>
        {meta.failedRegions?.length ? <span>失败地域<b>{meta.failedRegions.join(', ')}</b></span> : null}
      </div>
      <PreBlock text={meta.preview} />
      {meta.truncated ? <div className="ci-note">结果较大，此处为节选；完整结果缓存为 {meta.ref}。</div> : null}
    </Shell>
  )
}

export function VisualizeToolView(props: ToolViewProps) {
  const args = parseArgs(props)
  const title = String((args.view as { title?: string } | undefined)?.title ?? '')
  if (props.phase !== 'result') {
    return <Shell title={`可视化${title ? ` · ${title}` : ''}`} sub="生成中…" open={false} toggle={() => undefined} busy />
  }
  const block = props.block
  const meta = block.meta as { kind?: string; view?: CompiledView } | undefined
  if (block.isError || meta?.kind !== 'cloud-view' || !meta.view) {
    return <ErrorView title={`可视化${title ? ` · ${title}` : ''}`} text={block.error?.reason || resultText(block)} />
  }
  if (cardsEnabled()) {
    return <Shell title={`可视化${meta.view.title ? ` · ${meta.view.title}` : ''}`} sub="已在对话中展示" open={false} toggle={() => undefined} badges={<Badge tone="success">完成</Badge>} />
  }
  return <div className="ci-root" style={{ margin: '4px 0 10px' }}><ViewRenderer view={meta.view} /></div>
}

function ErrorView({ title, text }: { title: string; text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <Shell title={title} sub="失败" open={open} toggle={() => setOpen(!open)} badges={<Badge tone="danger">失败</Badge>}>
      <div className="ci-err">{text || '失败'}</div>
    </Shell>
  )
}
