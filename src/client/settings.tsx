import * as React from 'react'
import { Badge, Spinner } from './renderer/index.js'
import { Button, Card, Checkbox, Form, Input, Radio, Table, Text } from './tea.js'

const { useCallback, useEffect, useState } = React

/** Document-relative, so the request follows the app's mount under any proxy prefix. */
const API_ROUTE = 'cloud-infra/api'
const DESIGN_ROUTE = 'cloud-infra/design/'

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
  const [state, setState] = useState<State | null>(null)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [tests, setTests] = useState<Record<string, { ok: boolean; text: string } | 'running'>>({})

  const load = useCallback(() => {
    setError('')
    api<State>('state').then(setState, (e: Error) => setError(e.message))
  }, [])
  useEffect(() => { if (!state) load() }, [state, load])

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
  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d))

  const columns = [
    {
      key: 'id', header: '账号',
      render: (a: AccountView) => <><Text theme="strong">{a.id}</Text>{a.label ? <Text theme="label"> · {a.label}</Text> : null}</>,
    },
    {
      key: 'source', header: '凭据',
      render: (a: AccountView) => (
        <>
          <div>{a.source === 'store' ? 'DSH 凭据' : `tccli:${a.tccliProfile ?? 'default'}`}{a.credential.configured && a.credential.masked ? <Text theme="label"> · {a.credential.masked}</Text> : null}</div>
          {!a.credential.configured ? <Text theme="danger">{a.credential.detail}</Text> : null}
        </>
      ),
    },
    { key: 'region', header: '默认地域', render: (a: AccountView) => a.defaultRegion ?? <Text theme="weak">未设置</Text> },
    { key: 'mode', header: '权限', render: (a: AccountView) => (a.readonly ? <Badge tone="info">只读</Badge> : <Badge tone="warning">可写（需审批）</Badge>) },
    {
      key: 'test', header: '连接',
      render: (a: AccountView) => {
        const t = tests[a.id]
        if (t === 'running') return <><Spinner /> 测试中…</>
        return t ? <Text theme={t.ok ? 'success' : 'danger'}>{t.text}</Text> : <Text theme="weak">未测试</Text>
      },
    },
    {
      key: 'ops', header: '操作',
      render: (a: AccountView) => (
        <>
          <Button type="link" disabled={tests[a.id] === 'running'} onClick={() => void test(a)}>测试连接</Button>
          {state?.writable ? <Button type="link" disabled={busy} onClick={() => edit(a)}>编辑</Button> : null}
          {state?.writable ? <Button type="link" className="ci-danger" disabled={busy} onClick={() => void remove(a)}>删除</Button> : null}
        </>
      ),
    },
  ]

  return (
    <div className="ci-cfg-item ci-root">
      <Card className="ci-card">
        <Card.Body
          title="Cloud Infra · 云账号"
          subtitle="管理 Agent 可调用的云账号。密钥保存在 DSH 凭据存储中，不进入配置文件和模型上下文。"
          operation={<Button type="weak" onClick={() => window.open(DESIGN_ROUTE, '_blank', 'noopener')}>组件设计页</Button>}
        >
          <div className="ci-col">
            {error ? <Text theme="danger" parent="div" className="ci-err">{error}</Text> : null}
            {state && !state.writable ? <Text theme="label" parent="p">设置服务不可用：账号只能在 profile 配置里编辑。</Text> : null}
            {state || !error ? (
              <Table
                columns={columns}
                records={state?.accounts ?? []}
                recordKey={(a: AccountView) => `${a.provider}/${a.id}`}
                topTip={!state ? <div className="ci-empty"><Spinner /> 读取中…</div> : !state.accounts.length ? <div className="ci-empty">还没有账号。添加一个腾讯云账号后，Agent 就能调用云 API。</div> : undefined}
              />
            ) : null}
            {draft ? (
              <div className="ci-form">
                <Form>
                  <Form.Item label="账号 ID" required>
                    <Input value={draft.id} placeholder="prod" onChange={(v: string) => set({ id: v })} />
                  </Form.Item>
                  <Form.Item label="显示名称">
                    <Input value={draft.label} placeholder="生产环境" onChange={(v: string) => set({ label: v })} />
                  </Form.Item>
                  <Form.Item label="默认地域">
                    <Input value={draft.defaultRegion} placeholder="ap-guangzhou" onChange={(v: string) => set({ defaultRegion: v })} />
                  </Form.Item>
                  <Form.Item label="凭据来源">
                    <Radio.Group value={draft.source} onChange={(v: string) => set({ source: v as Draft['source'] })}>
                      <Radio name="store">SecretId / SecretKey（DSH 凭据存储）</Radio>
                      <Radio name="tccli">tccli 配置（~/.tccli）</Radio>
                    </Radio.Group>
                  </Form.Item>
                  {draft.source === 'store' ? (
                    <>
                      <Form.Item label="SecretId">
                        <Input value={draft.secretId} autoComplete="off" placeholder={draft.originalId ? '留空则保持不变' : 'AKID…'} onChange={(v: string) => set({ secretId: v })} />
                      </Form.Item>
                      <Form.Item label="SecretKey">
                        <Input type="password" value={draft.secretKey} autoComplete="new-password" placeholder={draft.originalId ? '留空则保持不变' : ''} onChange={(v: string) => set({ secretKey: v })} />
                      </Form.Item>
                    </>
                  ) : (
                    <Form.Item label="tccli profile">
                      <Input value={draft.tccliProfile} list="ci-tccli-profiles" onChange={(v: string) => set({ tccliProfile: v })} />
                      <datalist id="ci-tccli-profiles">{state?.tccliProfiles.map((p) => <option key={p.name} value={p.name} />)}</datalist>
                    </Form.Item>
                  )}
                  <Form.Item label="权限">
                    <Checkbox value={draft.readonly} onChange={(v: boolean) => set({ readonly: v })}>只读账号（拒绝一切写操作，不弹审批）</Checkbox>
                  </Form.Item>
                </Form>
                <Form.Action>
                  <Button type="primary" loading={busy} disabled={!draft.id.trim()} onClick={() => void save()}>保存</Button>
                  <Button type="weak" disabled={busy} onClick={() => setDraft(null)}>取消</Button>
                </Form.Action>
              </div>
            ) : state?.writable ? (
              <div className="ci-btns">
                <Button type="primary" onClick={() => setDraft({ ...EMPTY })}>添加账号</Button>
                {unusedProfiles.map((p) => (
                  <Button key={p.name} type="weak" onClick={() => setDraft({ ...EMPTY, id: p.name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^[^a-z]+/, 'tc-') || 'tccli', source: 'tccli', tccliProfile: p.name, defaultRegion: p.region ?? '' })}>
                    导入 tccli:{p.name}
                  </Button>
                ))}
              </div>
            ) : null}
          </div>
        </Card.Body>
      </Card>
    </div>
  )
}
