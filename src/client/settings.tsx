import * as React from 'react'
import { Badge } from './renderer/index.js'

const { useCallback, useEffect, useState } = React

/** Document-relative, so the request follows the app's mount under any proxy prefix. */
const API_ROUTE = 'cloud-infra/api'

interface AccountView {
  id: string
  provider: string
  label?: string
  source: 'store' | 'tccli'
  defaultRegion?: string
  readonly: boolean
  tccliProfile?: string
  credential: { configured: boolean; masked?: string; detail?: string }
}

interface State {
  accounts: AccountView[]
  tccliProfiles: { name: string; region?: string; type?: string }[]
  writable: boolean
}

interface Draft {
  originalId?: string
  id: string
  label: string
  source: 'store' | 'tccli'
  defaultRegion: string
  readonly: boolean
  tccliProfile: string
  secretId: string
  secretKey: string
}

const EMPTY: Draft = { id: '', label: '', source: 'store', defaultRegion: 'ap-guangzhou', readonly: false, tccliProfile: 'default', secretId: '', secretKey: '' }

export async function api<T = Record<string, unknown>>(method: string, payload: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(API_ROUTE, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ method, ...payload }),
  })
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
  if (!res.ok || body.ok === false) throw new Error(body.error || `HTTP ${res.status}`)
  return body as T
}

export function SettingsCard() {
  const [open, setOpen] = useState(true)
  const [state, setState] = useState<State | null>(null)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [tests, setTests] = useState<Record<string, { ok: boolean; text: string } | 'running'>>({})

  const load = useCallback(() => {
    setError('')
    api<State>('state').then(setState, (e: Error) => setError(e.message))
  }, [])
  useEffect(() => { if (open && !state) load() }, [open, state, load])

  const save = async () => {
    if (!draft) return
    setBusy(true); setError('')
    try {
      const account = { id: draft.id.trim(), provider: 'tencent', label: draft.label, source: draft.source, defaultRegion: draft.defaultRegion, readonly: draft.readonly, tccliProfile: draft.tccliProfile }
      const secret = draft.source === 'store' && (draft.secretId || draft.secretKey) ? { secretId: draft.secretId, secretKey: draft.secretKey } : undefined
      setState(await api<State>('accounts.save', { account, secret, originalId: draft.originalId }))
      setDraft(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (a: AccountView) => {
    if (!window.confirm(`删除账号 ${a.id}？${a.source === 'store' ? '保存的密钥也会一并删除。' : ''}`)) return
    setBusy(true); setError('')
    try { setState(await api<State>('accounts.remove', { id: a.id, provider: a.provider })) } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  const test = async (a: AccountView) => {
    setTests((t) => ({ ...t, [a.id]: 'running' }))
    try {
      const { test: r } = await api<{ test: { ok: boolean; identity?: string; error?: string } }>('accounts.test', { id: a.id, provider: a.provider })
      setTests((t) => ({ ...t, [a.id]: { ok: r.ok, text: r.ok ? `连接成功 · ${r.identity ?? ''}` : r.error ?? '失败' } }))
    } catch (e) {
      setTests((t) => ({ ...t, [a.id]: { ok: false, text: (e as Error).message } }))
    }
  }

  const edit = (a: AccountView) => setDraft({ ...EMPTY, originalId: a.id, id: a.id, label: a.label ?? '', source: a.source, defaultRegion: a.defaultRegion ?? '', readonly: a.readonly, tccliProfile: a.tccliProfile ?? 'default' })
  const unusedProfiles = state?.tccliProfiles.filter((p) => !state.accounts.some((a) => a.source === 'tccli' && (a.tccliProfile ?? 'default') === p.name)) ?? []

  return (
    <div className="ci-cfg-item ci-root">
      <details className="ci-cfg" open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
        <summary className="ci-cfg-h">
          <span style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: 2 }}>
            <span className="ci-cfg-n">Cloud Infra · 云账号</span>
            <span className="ci-cfg-d">管理 Agent 可调用的云账号。密钥保存在 DSH 凭据存储中，不进入配置文件和模型上下文。</span>
          </span>
        </summary>
        <div className="ci-cfg-b">
          {error ? <div className="ci-err">{error}</div> : null}
          {!state && !error ? <div className="ci-hint"><span className="ci-spin" style={{ display: 'inline-block', marginRight: 6 }} />读取中…</div> : null}
          {state && !state.writable ? <p className="ci-hint">设置服务不可用：账号只能在 profile 配置里编辑。</p> : null}
          {state?.accounts.map((a) => {
            const t = tests[a.id]
            return (
              <div className="ci-acct" key={`${a.provider}/${a.id}`}>
                <div className="ci-acct-main">
                  <div className="ci-acct-id">{a.id}{a.label ? <span className="ci-acct-sub"> · {a.label}</span> : null}</div>
                  <div className="ci-acct-sub">
                    腾讯云 · {a.source === 'store' ? 'DSH 凭据' : `tccli:${a.tccliProfile ?? 'default'}`} · {a.defaultRegion ?? '未设默认地域'}
                    {a.credential.configured ? ` · ${a.credential.masked ?? ''}` : ''}
                  </div>
                  {!a.credential.configured ? <div className="ci-err">{a.credential.detail}</div> : null}
                  {t && t !== 'running' ? <div className={t.ok ? 'ci-acct-sub' : 'ci-err'}>{t.text}</div> : null}
                </div>
                {a.readonly ? <Badge tone="info">只读</Badge> : <Badge tone="warning">可写（需审批）</Badge>}
                <button type="button" className="ci-btn" disabled={t === 'running'} onClick={() => void test(a)}>{t === 'running' ? '测试中…' : '测试连接'}</button>
                {state.writable ? <button type="button" className="ci-btn" disabled={busy} onClick={() => edit(a)}>编辑</button> : null}
                {state.writable ? <button type="button" className="ci-btn danger" disabled={busy} onClick={() => void remove(a)}>删除</button> : null}
              </div>
            )
          })}
          {state && !state.accounts.length ? <p className="ci-hint">还没有账号。添加一个腾讯云账号后，Agent 就能调用云 API。</p> : null}
          {draft ? (
            <div className="ci-form">
              <label className="ci-field">账号 ID
                <input value={draft.id} placeholder="prod" onChange={(e) => setDraft({ ...draft, id: e.target.value })} />
              </label>
              <label className="ci-field">显示名称
                <input value={draft.label} placeholder="生产环境" onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
              </label>
              <label className="ci-field">默认地域
                <input value={draft.defaultRegion} placeholder="ap-guangzhou" onChange={(e) => setDraft({ ...draft, defaultRegion: e.target.value })} />
              </label>
              <label className="ci-field">凭据来源
                <select value={draft.source} onChange={(e) => setDraft({ ...draft, source: e.target.value as Draft['source'] })}>
                  <option value="store">SecretId / SecretKey（DSH 凭据存储）</option>
                  <option value="tccli">tccli 配置（~/.tccli）</option>
                </select>
              </label>
              {draft.source === 'store' ? (
                <>
                  <label className="ci-field">SecretId
                    <input value={draft.secretId} autoComplete="off" placeholder={draft.originalId ? '留空则保持不变' : 'AKID…'} onChange={(e) => setDraft({ ...draft, secretId: e.target.value })} />
                  </label>
                  <label className="ci-field">SecretKey
                    <input type="password" value={draft.secretKey} autoComplete="new-password" placeholder={draft.originalId ? '留空则保持不变' : ''} onChange={(e) => setDraft({ ...draft, secretKey: e.target.value })} />
                  </label>
                </>
              ) : (
                <label className="ci-field">tccli profile
                  <input value={draft.tccliProfile} list="ci-tccli-profiles" onChange={(e) => setDraft({ ...draft, tccliProfile: e.target.value })} />
                  <datalist id="ci-tccli-profiles">{state?.tccliProfiles.map((p) => <option key={p.name} value={p.name} />)}</datalist>
                </label>
              )}
              <label className="ci-field check">
                <input type="checkbox" checked={draft.readonly} onChange={(e) => setDraft({ ...draft, readonly: e.target.checked })} />
                只读账号（拒绝一切写操作，不弹审批）
              </label>
              <div className="ci-form-ft">
                <button type="button" className="ci-btn" disabled={busy} onClick={() => setDraft(null)}>取消</button>
                <button type="button" className="ci-btn primary" disabled={busy || !draft.id.trim()} onClick={() => void save()}>{busy ? '保存中…' : '保存'}</button>
              </div>
            </div>
          ) : state?.writable ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="ci-btn primary" onClick={() => setDraft({ ...EMPTY })}>添加账号</button>
              {unusedProfiles.map((p) => (
                <button key={p.name} type="button" className="ci-btn" onClick={() => setDraft({ ...EMPTY, id: p.name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^[^a-z]+/, 'tc-') || 'tccli', source: 'tccli', tccliProfile: p.name, defaultRegion: p.region ?? '' })}>
                  导入 tccli:{p.name}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </details>
    </div>
  )
}
