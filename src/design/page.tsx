/**
 * Cloud View design page: renders every shared component from real specs.
 * Built standalone (React bundled) by scripts/build-client.ts into lib/design-page/
 * and served by the plugin at /cloud-infra/design/.
 */
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { CSS as COMPONENT_CSS, TOKENS_LIGHT } from '../client/styles.js'
import { Badge, PreBlock, Value, ViewRenderer } from '../client/renderer/index.js'
import { CallToolView, VisualizeToolView } from '../client/toolviews.js'
import type { ToolViewProps } from '../client/types.js'
import type { Format, JsonValue, Tone } from '../view/spec.js'
import { compileSample } from './compile-sample.js'
import { SAMPLES, type DesignSample } from './samples.js'

const { useEffect, useMemo, useState } = React

;(globalThis as { __dshRequire?: unknown }).__dshRequire = Object.assign(() => undefined, {
  async: () => import('../client/echarts/index.js'),
})

const TOKEN_NAMES = [...TOKENS_LIGHT.matchAll(/--(ci-[a-z-]+):/g)].map((m) => m[1]!)

const PAGE_CSS = `
html{scroll-behavior:smooth;scroll-padding-top:70px}
body{margin:0;background:#f3f4f7;font-family:Roboto,"San Francisco","Helvetica Neue",Helvetica,Arial,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif}
body[data-ds-dark-theme]{background:#11131c}
.dp-app{min-height:100vh;font-size:12px}
.dp-menu{position:fixed;left:0;top:0;bottom:0;width:200px;background:#1e222d;color:#c1c6c8;overflow:auto;z-index:6}
.dp-menu-title{height:50px;display:flex;align-items:center;padding:0 20px;color:#fff;font-size:16px;font-weight:700;border-bottom:1px solid #262f3e}
.dp-menu h4{margin:14px 20px 4px;font-size:12px;color:#888;font-weight:400}
.dp-menu a{display:block;height:40px;line-height:40px;padding:0 20px 0 32px;color:#c1c6c8;text-decoration:none;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dp-menu a:hover{background:#262f3e}
.dp-menu a.on{background:rgba(52,66,88,.6);color:#fff}
.dp-body{margin-left:200px;min-width:0}
.dp-head{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:20px;min-height:50px;padding:10px 20px;background:var(--ci-bg);border-bottom:1px solid var(--ci-border-strong)}
.dp-head h2{margin:0;font-size:16px;font-weight:700;color:var(--ci-strong)}
.dp-head .dp-sub{color:var(--ci-label)}
.dp-head .dp-grow{flex:1}
.dp-main{padding:20px;max-width:1200px}
.dp-intro{margin:0 0 20px;padding:12px 20px;background:var(--ci-info-bg);color:var(--ci-info-fg);line-height:1.7}
.dp-intro code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.dp-sec{margin:0 0 20px;background:var(--ci-bg);box-shadow:var(--ci-shadow)}
.dp-sec-h{display:flex;align-items:baseline;gap:12px;padding:16px 20px 12px;border-bottom:1px solid var(--ci-border)}
.dp-sec-h h3{margin:0;font-size:14px;font-weight:700;color:var(--ci-strong)}
.dp-sec-h .dp-tag{color:var(--ci-label)}
.dp-sec-h .dp-grow{flex:1}
.dp-desc{margin:0;padding:12px 20px 0;color:var(--ci-label);line-height:1.7}
.dp-frame{padding:16px 20px 20px}
.dp-frame.dp-sunk{background:var(--ci-bg-sub);margin:12px 20px 20px;padding:16px}
.dp-spec{padding:0 20px 20px}
.dp-err{color:var(--ci-danger);white-space:pre-wrap}
.dp-swatches{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px}
.dp-sw{display:flex;align-items:center;gap:10px;min-width:0}
.dp-sw i{width:32px;height:32px;border:1px solid var(--ci-border);flex:none}
.dp-sw span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ci-label);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.dp-row{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
.dp-cards{display:flex;flex-direction:column;gap:8px;max-width:880px}
@media (max-width:900px){.dp-menu{display:none}.dp-body{margin-left:0}}
`

function useStyles() {
  useEffect(() => {
    const el = document.createElement('style')
    el.textContent = COMPONENT_CSS + PAGE_CSS
    document.head.appendChild(el)
    return () => el.remove()
  }, [])
}

function Sample({ sample }: { sample: DesignSample }) {
  const [showSpec, setShowSpec] = useState(false)
  const compiled = useMemo(() => {
    try { return { view: compileSample(sample) } } catch (e) { return { error: (e as Error).message } }
  }, [sample])
  return (
    <section className="dp-sec" id={sample.id}>
      <div className="dp-sec-h">
        <h3>{sample.title}</h3>
        <span className="dp-tag">{sample.group}</span>
        <span className="dp-grow" />
        <button type="button" className="ci-btn" onClick={() => setShowSpec(!showSpec)}>{showSpec ? '隐藏 Spec' : '查看 Spec'}</button>
      </div>
      <p className="dp-desc">{sample.description}</p>
      <div className="dp-frame">
        {compiled.view ? <ViewRenderer view={compiled.view} /> : <div className="dp-err">{compiled.error}</div>}
      </div>
      {showSpec ? <div className="dp-spec"><PreBlock text={JSON.stringify(sample.view, null, 2)} lines={40} /></div> : null}
    </section>
  )
}

const TONES: Tone[] = ['neutral', 'info', 'success', 'warning', 'danger']
const FORMATS: [Format | undefined, JsonValue, string][] = [
  [undefined, 'prod-web-01', '不写 format：原样输出，数字加千分位'],
  ['number', 1234567.891, '千分位，最多两位小数'],
  ['percent', 87.5, '数值已是 0–100'],
  ['bytes', 5368709120, '自动换算单位'],
  ['datetime', '2026-11-16T03:21:00Z', 'ISO 字符串或秒/毫秒时间戳'],
  ['status', 'RUNNING', '按常见状态词显示“状态点 + 文字”'],
]
const STATUS_WORDS = ['RUNNING', 'Normal', 'STOPPED', 'PENDING', 'EXPIRED', 'LAUNCH_FAILED', 'Deleting']

function Section({ id, title, tag, desc, children }: { id: string; title: string; tag: string; desc: string; children: React.ReactNode }) {
  return (
    <section className="dp-sec" id={id}>
      <div className="dp-sec-h"><h3>{title}</h3><span className="dp-tag">{tag}</span></div>
      <p className="dp-desc">{desc}</p>
      <div className="dp-frame">{children}</div>
    </section>
  )
}

function Foundations() {
  return (
    <>
      <Section id="tokens" title="颜色 token" tag="基础" desc="组件采用腾讯云控制台（Tea）的视觉规范：直角、12px 正文、#006eff 主色。颜色都来自 --ci-* 变量，DSH 切换到暗色时整体换成 Tea 暗色取值。">
        <div className="dp-swatches">
          {TOKEN_NAMES.filter((k) => !k.endsWith('shadow')).map((k) => (
            <div key={k} className="dp-sw" title={`--${k}`}><i style={{ background: `var(--${k})` }} /><span>{k.slice(3)}</span></div>
          ))}
        </div>
      </Section>
      <Section id="tones" title="语义色 tone 与状态" tag="基础" desc="stats 的 tone 和标签共用五种语义色。format 为 status 时显示为“状态点 + 文字”，常见状态词自动映射到语义色。">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="dp-row">{TONES.map((t) => <Badge key={t} tone={t}>{t}</Badge>)}</div>
          <div className="dp-row" style={{ gap: 20 }}>{STATUS_WORDS.map((w) => <span key={w}>{renderFormat('status', w)}</span>)}</div>
          <div className="dp-row">
            <button type="button" className="ci-btn primary">主按钮</button>
            <button type="button" className="ci-btn">次按钮</button>
            <button type="button" className="ci-btn danger">危险操作</button>
            <button type="button" className="ci-btn" disabled>禁用</button>
            <input className="ci-input" placeholder="输入框" aria-label="示例输入框" />
          </div>
        </div>
      </Section>
      <Section id="formats" title="值格式 format" tag="基础" desc="表格列、kv、stats 和图表数值共用这 5 种格式。">
        <div className="ci-table-wrap">
          <table className="ci-table">
            <thead><tr><th>format</th><th>输入</th><th>显示</th><th>说明</th></tr></thead>
            <tbody>
              {FORMATS.map(([f, v, note]) => (
                <tr key={f ?? 'none'}><td><code>{f ?? '—'}</code></td><td><code>{JSON.stringify(v)}</code></td><td>{renderFormat(f, v)}</td><td style={{ color: 'var(--ci-label)' }}>{note}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  )
}

function renderFormat(format: Format | undefined, value: JsonValue): React.ReactNode {
  return <Value value={value} format={format} />
}

function callProps(args: Record<string, unknown>, meta: Record<string, unknown> | null, error?: { code: string; reason: string }): ToolViewProps {
  const argsRaw = JSON.stringify(args)
  if (!meta && !error) return { phase: 'start', block: { argsRaw }, toolName: 'cloud_call', callId: 'demo' }
  return {
    phase: 'result', toolName: 'cloud_call', callId: 'demo',
    block: {
      kind: 'tool-result', callId: 'demo', name: 'cloud_call', call: { name: 'cloud_call', argsRaw },
      content: [{ type: 'text', text: error?.reason ?? '' }], isError: !!error, meta: meta ?? undefined,
      ...(error ? { error: { name: 'CloudError', ...error } } : {}),
    },
  }
}

const CALL_META = {
  kind: 'cloud-call', ref: 'r1', account: 'dev', service: 'cvm', version: '2017-03-12', action: 'DescribeInstances',
  region: null, regions: ['ap-guangzhou', 'ap-shanghai', 'ap-beijing'], failedRegions: ['ap-beijing'], risk: 'read',
  requestId: 'f1c3a2e4-6b0d-4a51-9a3e-2d7c0b1e9f10', durationMs: 842, truncated: true,
  preview: JSON.stringify({ 'ap-guangzhou': { TotalCount: 18, InstanceSet: [{ InstanceId: 'ins-8h3k2m1q', InstanceName: 'prod-web-01', InstanceState: 'RUNNING' }, '… 17 more'] }, 'ap-shanghai': { TotalCount: 3, InstanceSet: ['… 3 items'] }, 'ap-beijing': { error: 'AuthFailure.UnauthorizedOperation' } }, null, 2),
}

function ToolCards() {
  const overview = useMemo(() => compileSample(SAMPLES[0]!), [])
  return (
    <Section id="toolviews" title="cloud_call / cloud_visualize 在对话中的样子" tag="工具卡片" desc="cloud_call 卡片只展示请求摘要和有界的结果节选，默认折叠，点击标题展开；cloud_visualize 的视图作为独立卡片显示在对话中（不在工具分组里），这里直接渲染。依次为调用中、只读成功（多地域，1 个失败）、写操作和失败。">
      <div className="dp-cards">
        <CallToolView {...callProps({ service: 'cvm', action: 'DescribeInstances', regions: ['ap-guangzhou', 'ap-shanghai', 'ap-beijing'] }, null)} />
        <CallToolView {...callProps({ service: 'cvm', action: 'DescribeInstances' }, CALL_META)} />
        <CallToolView {...callProps({ service: 'vpc', action: 'ModifySecurityGroupAttribute' }, { ...CALL_META, service: 'vpc', action: 'ModifySecurityGroupAttribute', version: '2017-03-12', region: 'ap-guangzhou', regions: null, failedRegions: null, risk: 'write', ref: 'r9', durationMs: 214, truncated: false, preview: '{\n  "RequestId": "0b8e5a3c-71f2-4d0e-9c1a-5e2f7d3b6a90"\n}' })} />
        <CallToolView {...callProps({ service: 'vpc', action: 'DeleteSecurityGroup' }, null, { code: 'CLOUD_READONLY', reason: 'account "ro" is read-only; vpc.DeleteSecurityGroup is a write operation and was refused. Do not try to work around this.' })} />
        <VisualizeToolView phase="result" toolName="cloud_visualize" callId="v1" block={{ kind: 'tool-result', callId: 'v1', name: 'cloud_visualize', call: { name: 'cloud_visualize', argsRaw: JSON.stringify({ view: SAMPLES[0]!.view }) }, content: [], isError: false, meta: { kind: 'cloud-view', view: overview } }} />
      </div>
    </Section>
  )
}

const NAV: { group: string; items: { id: string; title: string }[] }[] = [
  { group: '基础', items: [{ id: 'tokens', title: '颜色 token' }, { id: 'tones', title: '语义色与状态' }, { id: 'formats', title: '值格式' }] },
  ...['示例', '组件'].map((group) => ({ group, items: SAMPLES.filter((s) => s.group === group).map((s) => ({ id: s.id, title: s.title })) })),
  { group: '工具卡片', items: [{ id: 'toolviews', title: 'cloud_call / cloud_visualize' }] },
]

function useActiveSection(): string {
  const [active, setActive] = useState('tokens')
  useEffect(() => {
    const update = () => {
      let current = ''
      for (const el of document.querySelectorAll<HTMLElement>('.dp-sec[id]')) {
        if (el.getBoundingClientRect().top <= 90) current = el.id
      }
      setActive(current || 'tokens')
    }
    update()
    window.addEventListener('scroll', update, { passive: true })
    return () => window.removeEventListener('scroll', update)
  }, [])
  return active
}

function App() {
  useStyles()
  const [dark, setDark] = useState(() => localStorage.getItem('dp-theme') === 'dark')
  useEffect(() => {
    document.body.toggleAttribute('data-ds-dark-theme', dark)
    localStorage.setItem('dp-theme', dark ? 'dark' : 'light')
  }, [dark])
  const active = useActiveSection()
  return (
    <div className="ci-root dp-app">
      <nav className="dp-menu">
        <div className="dp-menu-title">Cloud View</div>
        {NAV.map((g) => (
          <div key={g.group}>
            <h4>{g.group}</h4>
            {g.items.map((it) => <a key={it.id} href={`#${it.id}`} className={active === it.id ? 'on' : ''}>{it.title}</a>)}
          </div>
        ))}
      </nav>
      <div className="dp-body">
        <header className="dp-head">
          <h2>组件设计页</h2>
          <span className="dp-sub">@cocofhu/dsh-cloud-infra · {SAMPLES.length} 个示例</span>
          <span className="dp-grow" />
          <button type="button" className="ci-btn" onClick={() => setDark(!dark)}>{dark ? '切换亮色' : '切换暗色'}</button>
        </header>
        <main className="dp-main">
          <p className="dp-intro">
            Agent 通过 <code>cloud_visualize</code> 提交 Cloud View Spec：<code>{'{ title?, items: [...] }'}</code>，组件只有 stats、table、chart（line / bar / pie）、kv、tabs 五种，按顺序从上到下排列。
            插件校验并绑定 <code>cloud_call</code> 的缓存结果后渲染。每个示例都经过与工具相同的校验和编译流程，点“查看 Spec”可以看到 Agent 需要写的 JSON。
          </p>
          <Foundations />
          {SAMPLES.map((s) => <Sample key={s.id} sample={s} />)}
          <ToolCards />
        </main>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
