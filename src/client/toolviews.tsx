import * as React from 'react'
import type { CompiledView } from '../view/spec.js'
import { Badge, PreBlock, Spinner, ViewRenderer } from './renderer/index.js'
import { cardsEnabled } from './chat-card.js'
import type { ToolResultBlock, ToolViewProps } from './types.js'
import { useT, type MessageKey } from './i18n.js'

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

const RISK = { read: ['risk.read', 'success'], write: ['risk.write', 'warning'], danger: ['risk.danger', 'danger'] } as const

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
  const t = useT()
  const args = parseArgs(props)
  const target = `${String(args.service ?? '…')}.${String(args.action ?? '…')}`
  const { open, toggle } = useOpen(props, false)
  if (props.phase !== 'result') {
    return <Shell title={`${t('tool.call')} · ${target}`} sub={String(args.region ?? (Array.isArray(args.regions) ? t('tool.regions', { count: args.regions.length }) : ''))} open={false} toggle={() => undefined} busy />
  }
  const block = props.block
  const meta = block.meta as CallMeta | undefined
  if (block.isError || meta?.kind !== 'cloud-call') {
    const reason = block.error?.reason || resultText(block)
    return (
      <Shell title={`${t('tool.call')} · ${target}`} sub={block.error?.code ?? t('tool.callFailed')} open={open} toggle={toggle}
        badges={<Badge tone="danger">{t('tool.failed')}</Badge>}>
        <div className="ci-err">{reason || t('tool.callFailed')}</div>
      </Shell>
    )
  }
  const [riskKey, riskTone] = RISK[meta.risk] ?? RISK.write
  const where = meta.regions
    ? meta.failedRegions?.length ? t('tool.regionsFailed', { count: meta.regions.length, failed: meta.failedRegions.length }) : t('tool.regions', { count: meta.regions.length })
    : meta.region ?? ''
  return (
    <Shell title={`${t('tool.call')} · ${meta.service}.${meta.action}`} sub={[meta.account, where, `${meta.durationMs}ms`].filter(Boolean).join(' · ')} open={open} toggle={toggle}
      badges={<Badge tone={riskTone}>{t(riskKey)}</Badge>}>
      <div className="ci-meta">
        <span>{t('meta.account')}<b>{meta.account}</b></span>
        {where ? <span>{t('meta.region')}<b>{where}</b></span> : null}
        <span>{t('meta.version')}<b>{meta.version ?? '—'}</b></span>
        <span>RequestId<b>{meta.requestId ?? '—'}</b></span>
        {meta.failedRegions?.length ? <span>{t('meta.failedRegions')}<b>{meta.failedRegions.join(', ')}</b></span> : null}
      </div>
      <PreBlock text={meta.preview} />
      {meta.truncated ? <div className="ci-note">{t('tool.truncated')}</div> : null}
    </Shell>
  )
}

export function VisualizeToolView(props: ToolViewProps) {
  const t = useT()
  const args = parseArgs(props)
  const title = String((args.view as { title?: string } | undefined)?.title ?? '')
  if (props.phase !== 'result') {
    return <Shell title={`${t('tool.visualize')}${title ? ` · ${title}` : ''}`} sub={t('tool.generating')} open={false} toggle={() => undefined} busy />
  }
  const block = props.block
  const meta = block.meta as { kind?: string; view?: CompiledView } | undefined
  if (block.isError || meta?.kind !== 'cloud-view' || !meta.view) {
    return <ErrorView title={`${t('tool.visualize')}${title ? ` · ${title}` : ''}`} text={block.error?.reason || resultText(block)} />
  }
  if (cardsEnabled()) {
    return <Shell title={`${t('tool.visualize')}${meta.view.title ? ` · ${meta.view.title}` : ''}`} sub={t('tool.shown')} open={false} toggle={() => undefined} badges={<Badge tone="success">{t('tool.done')}</Badge>} />
  }
  return <div className="ci-root" style={{ margin: '4px 0 10px' }}><ViewRenderer view={meta.view} /></div>
}

function ErrorView({ title, text }: { title: string; text: string }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  return (
    <Shell title={title} sub={t('tool.failed')} open={open} toggle={() => setOpen(!open)} badges={<Badge tone="danger">{t('tool.failed')}</Badge>}>
      <div className="ci-err">{text || t('tool.failed')}</div>
    </Shell>
  )
}

/** Cards for the tools without a dedicated view: a localized title, the subject, and the raw result folded. */
const GENERIC: Record<string, { title: MessageKey; subject: (args: Record<string, unknown>) => string }> = {
  cloud_api_search: { title: 'tool.search', subject: (a) => [a.service, a.query].filter(Boolean).map(String).join(' · ') },
  cloud_api_describe: { title: 'tool.describe', subject: (a) => `${String(a.service ?? '…')}.${String(a.action ?? '…')}` },
  cloud_result: { title: 'tool.result', subject: (a) => [a.ref, a.path].filter(Boolean).map(String).join(' · ') },
  cloud_accounts: { title: 'tool.accounts', subject: () => '' },
}

export const GENERIC_TOOLS = Object.keys(GENERIC)

export function GenericToolView(props: ToolViewProps) {
  const t = useT()
  const spec = GENERIC[props.toolName] ?? { title: 'tool.call', subject: () => props.toolName }
  const title = t(spec.title)
  const subject = spec.subject(parseArgs(props))
  const { open, toggle } = useOpen(props, false)
  if (props.phase !== 'result') return <Shell title={title} sub={subject} open={false} toggle={() => undefined} busy />
  const block = props.block
  if (block.isError) return <ErrorView title={subject ? `${title} · ${subject}` : title} text={block.error?.reason || resultText(block)} />
  const text = resultText(block)
  return (
    <Shell title={title} sub={subject} open={open} toggle={toggle}>
      {text ? <PreBlock text={text} /> : null}
    </Shell>
  )
}
