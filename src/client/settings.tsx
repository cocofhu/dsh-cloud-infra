import * as React from 'react'
import { Badge, Spinner } from './renderer/index.js'
import { Button, Card, Checkbox, Form, Input, Radio, Table, Text } from './tea.js'
import { useT } from './i18n.js'

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
  const t = useT()
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
    if (!window.confirm(`${t('confirm.delete', { id: a.id })}${a.source === 'store' ? t('confirm.deleteSecret') : ''}`)) return
    setBusy(true); setError('')
    try { setState(await api<State>('accounts.remove', { id: a.id, provider: a.provider })) } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  const test = async (a: AccountView) => {
    setTests((s) => ({ ...s, [a.id]: 'running' }))
    try {
      const { test: r } = await api<{ test: { ok: boolean; identity?: string; error?: string } }>('accounts.test', { id: a.id, provider: a.provider })
      setTests((s) => ({ ...s, [a.id]: { ok: r.ok, text: r.ok ? t('test.ok', { identity: r.identity ?? '' }) : r.error ?? t('test.failed') } }))
    } catch (e) {
      setTests((s) => ({ ...s, [a.id]: { ok: false, text: (e as Error).message } }))
    }
  }

  const edit = (a: AccountView) => setDraft({ ...EMPTY, originalId: a.id, id: a.id, label: a.label ?? '', source: a.source, defaultRegion: a.defaultRegion ?? '', readonly: a.readonly, tccliProfile: a.tccliProfile ?? 'default' })
  const unusedProfiles = state?.tccliProfiles.filter((p) => !state.accounts.some((a) => a.source === 'tccli' && (a.tccliProfile ?? 'default') === p.name)) ?? []
  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d))

  const columns = [
    {
      key: 'id', header: t('col.account'),
      render: (a: AccountView) => <><Text theme="strong">{a.id}</Text>{a.label ? <Text theme="label"> · {a.label}</Text> : null}</>,
    },
    {
      key: 'source', header: t('col.credential'),
      render: (a: AccountView) => (
        <>
          <div>{a.source === 'store' ? t('cred.store') : `tccli:${a.tccliProfile ?? 'default'}`}{a.credential.configured && a.credential.masked ? <Text theme="label"> · {a.credential.masked}</Text> : null}</div>
          {!a.credential.configured ? <Text theme="danger">{a.credential.detail}</Text> : null}
        </>
      ),
    },
    { key: 'region', header: t('col.region'), render: (a: AccountView) => a.defaultRegion ?? <Text theme="weak">{t('region.unset')}</Text> },
    { key: 'mode', header: t('col.mode'), width: 200, render: (a: AccountView) => (a.readonly ? <Badge tone="info">{t('mode.readonly')}</Badge> : <Badge tone="warning">{t('mode.writable')}</Badge>) },
    {
      key: 'test', header: t('col.test'),
      render: (a: AccountView) => {
        const result = tests[a.id]
        if (result === 'running') return <><Spinner /> {t('test.running')}</>
        return result ? <Text theme={result.ok ? 'success' : 'danger'}>{result.text}</Text> : <Text theme="weak">{t('test.none')}</Text>
      },
    },
    {
      key: 'ops', header: t('col.ops'),
      render: (a: AccountView) => (
        <>
          <Button type="link" disabled={tests[a.id] === 'running'} onClick={() => void test(a)}>{t('op.test')}</Button>
          {state?.writable ? <Button type="link" disabled={busy} onClick={() => edit(a)}>{t('op.edit')}</Button> : null}
          {state?.writable ? <Button type="link" className="ci-danger" disabled={busy} onClick={() => void remove(a)}>{t('op.delete')}</Button> : null}
        </>
      ),
    },
  ]

  return (
    <div className="ci-cfg-item ci-root">
      <Card className="ci-card">
        <Card.Body
          title={t('settings.title')}
          subtitle={t('settings.subtitle')}
        >
          <div className="ci-col">
            {error ? <Text theme="danger" parent="div" className="ci-err">{error}</Text> : null}
            {state && !state.writable ? <Text theme="label" parent="p">{t('settings.unavailable')}</Text> : null}
            {state || !error ? (
              <Table
                columns={columns}
                records={state?.accounts ?? []}
                recordKey={(a: AccountView) => `${a.provider}/${a.id}`}
                topTip={!state ? <div className="ci-empty"><Spinner /> {t('settings.loading')}</div> : !state.accounts.length ? <div className="ci-empty">{t('settings.empty')}</div> : undefined}
              />
            ) : null}
            {draft ? (
              <div className="ci-form">
                <Form>
                  <Form.Item label={t('form.id')} required>
                    <Input value={draft.id} placeholder="prod" onChange={(v: string) => set({ id: v })} />
                  </Form.Item>
                  <Form.Item label={t('form.label')}>
                    <Input value={draft.label} placeholder={t('form.labelPlaceholder')} onChange={(v: string) => set({ label: v })} />
                  </Form.Item>
                  <Form.Item label={t('form.region')}>
                    <Input value={draft.defaultRegion} placeholder="ap-guangzhou" onChange={(v: string) => set({ defaultRegion: v })} />
                  </Form.Item>
                  <Form.Item label={t('form.source')}>
                    <Radio.Group value={draft.source} onChange={(v: string) => set({ source: v as Draft['source'] })}>
                      <Radio name="store">{t('form.sourceStore')}</Radio>
                      <Radio name="tccli">{t('form.sourceTccli')}</Radio>
                    </Radio.Group>
                  </Form.Item>
                  {draft.source === 'store' ? (
                    <>
                      <Form.Item label="SecretId">
                        <Input value={draft.secretId} autoComplete="off" placeholder={draft.originalId ? t('form.keep') : 'AKID…'} onChange={(v: string) => set({ secretId: v })} />
                      </Form.Item>
                      <Form.Item label="SecretKey">
                        <Input type="password" value={draft.secretKey} autoComplete="new-password" placeholder={draft.originalId ? t('form.keep') : ''} onChange={(v: string) => set({ secretKey: v })} />
                      </Form.Item>
                    </>
                  ) : (
                    <Form.Item label="tccli profile">
                      <Input value={draft.tccliProfile} list="ci-tccli-profiles" onChange={(v: string) => set({ tccliProfile: v })} />
                      <datalist id="ci-tccli-profiles">{state?.tccliProfiles.map((p) => <option key={p.name} value={p.name} />)}</datalist>
                    </Form.Item>
                  )}
                  <Form.Item label={t('form.permission')}>
                    <Checkbox value={draft.readonly} onChange={(v: boolean) => set({ readonly: v })}>{t('form.readonly')}</Checkbox>
                  </Form.Item>
                </Form>
                <Form.Action>
                  <Button type="primary" loading={busy} disabled={!draft.id.trim()} onClick={() => void save()}>{t('form.save')}</Button>
                  <Button type="weak" disabled={busy} onClick={() => setDraft(null)}>{t('form.cancel')}</Button>
                </Form.Action>
              </div>
            ) : state?.writable ? (
              <div className="ci-btns">
                <Button type="primary" onClick={() => setDraft({ ...EMPTY })}>{t('form.add')}</Button>
                {unusedProfiles.map((p) => (
                  <Button key={p.name} type="weak" onClick={() => setDraft({ ...EMPTY, id: p.name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^[^a-z]+/, 'tc-') || 'tccli', source: 'tccli', tccliProfile: p.name, defaultRegion: p.region ?? '' })}>
                    {t('form.import', { name: p.name })}
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
