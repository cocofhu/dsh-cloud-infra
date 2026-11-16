/**
 * Cloud View design page: renders every shared component from real specs.
 * Built standalone (React bundled) by scripts/build-client.ts into lib/design-page/
 * and served by the plugin at /cloud-infra/design/.
 */
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { CSS as COMPONENT_CSS } from '../client/styles.js'
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

const LIGHT = {
  'bg-layer-1': '#fff', 'bg-layer-2': '#fff', 'bg-layer-3': '#fff', 'border-l1': '#0000000a', 'border-l2': '#0000001a',
  'brand-primary-new-colorprimary-new-color': '#4176e6', 'button-elevated-fill': '#fff', 'button-primary-fill': '#0f1115',
  'interactive-bg-hover': '#2631480f', 'interactive-bg-hover-danger': '#ec13130d', 'label-caption': '#adb2b8',
  'label-primary': '#0f1115', 'label-primary-foreground': '#fff', 'label-secondary': '#61666b', 'label-tertiary': '#81858c',
  'state-business-primary': '#4176e6', 'state-business-tertiary': '#e4edfd', 'state-error-primary': '#ec1313',
  'state-success-primary': '#22c55e', 'state-success-tertiary': '#e6faed', 'state-warn-label': '#dd8629', 'state-warn-tertiary': '#fef5e7',
}
const DARK: typeof LIGHT = {
  'bg-layer-1': '#232324', 'bg-layer-2': '#2c2c2e', 'bg-layer-3': '#353638', 'border-l1': '#ffffff0f', 'border-l2': '#ffffff1f',
  'brand-primary-new-colorprimary-new-color': '#5686fe', 'button-elevated-fill': '#43454a', 'button-primary-fill': '#f9fafb',
  'interactive-bg-hover': '#ffffff14', 'interactive-bg-hover-danger': '#f25a5a26', 'label-caption': '#81858c',
  'label-primary': '#f9fafb', 'label-primary-foreground': '#0f1115', 'label-secondary': '#cfd3d6', 'label-tertiary': '#adb2b8',
  'state-business-primary': '#7aaaff', 'state-business-tertiary': '#34415b', 'state-error-primary': '#f25a5a',
  'state-success-primary': '#22c55e', 'state-success-tertiary': '#233c2c', 'state-warn-label': '#dd8629', 'state-warn-tertiary': '#27241f',
}
const vars = (t: typeof LIGHT) => Object.entries(t).map(([k, v]) => `--dsw-alias-${k}:${v}`).join(';')

const PAGE_CSS = `
:root{${vars(LIGHT)};--dp-page:#f6f7f9}
body[data-ds-dark-theme]{${vars(DARK)};--dp-page:#1a1a1b}
*{box-sizing:border-box}
html{scroll-behavior:smooth;scroll-padding-top:72px}
body{margin:0;background:var(--dp-page);color:var(--dsw-alias-label-primary);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei","Helvetica Neue",Helvetica,Arial,sans-serif;font-size:14px}
.dp-top{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:12px;height:56px;padding:0 24px;background:var(--dsw-alias-bg-layer-1);border-bottom:1px solid var(--dsw-alias-border-l2)}
.dp-top h1{font-size:16px;margin:0;font-weight:650}
.dp-top .dp-sub{color:var(--dsw-alias-label-tertiary);font-size:13px}
.dp-top .dp-grow{flex:1}
.dp-layout{display:grid;grid-template-columns:220px minmax(0,1fr);max-width:1320px;margin:0 auto}
.dp-nav{position:sticky;top:56px;align-self:start;height:calc(100vh - 56px);overflow:auto;padding:20px 12px 40px 24px}
.dp-nav h4{margin:16px 0 6px;font-size:12px;color:var(--dsw-alias-label-tertiary);font-weight:600}
.dp-nav a{display:block;padding:5px 10px;border-radius:8px;color:var(--dsw-alias-label-secondary);text-decoration:none;font-size:13px}
.dp-nav a:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dp-nav a.on{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);font-weight:600}
.dp-main{padding:24px 32px 80px;min-width:0}
.dp-intro{margin:0 0 28px;color:var(--dsw-alias-label-secondary);line-height:1.7;max-width:820px}
.dp-intro code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;background:var(--dsw-alias-interactive-bg-hover);padding:1px 5px;border-radius:4px}
.dp-sec{margin:0 0 36px}
.dp-sec h2{font-size:17px;margin:0 0 4px;font-weight:650}
.dp-sec h3{font-size:12px;margin:0 0 4px;color:var(--dsw-alias-label-tertiary);font-weight:600;letter-spacing:.02em}
.dp-desc{margin:0 0 12px;color:var(--dsw-alias-label-secondary);line-height:1.6;max-width:860px}
.dp-frame{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:14px;padding:18px}
.dp-bar{display:flex;gap:8px;margin-top:10px}
.dp-spec{margin-top:10px}
.dp-err{color:var(--dsw-alias-state-error-primary);white-space:pre-wrap;font-size:12px}
.dp-swatches{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:10px}
.dp-sw{display:flex;align-items:center;gap:10px;font-size:12px;min-width:0}
.dp-sw i{width:34px;height:34px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);flex:none}
.dp-sw span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary)}
.dp-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.dp-fmt{width:100%;border-collapse:collapse;font-size:13px}
.dp-fmt td,.dp-fmt th{text-align:left;padding:7px 10px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.dp-fmt th{color:var(--dsw-alias-label-tertiary);font-weight:600;font-size:12px}
.dp-fmt code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
.dp-cards{display:flex;flex-direction:column;gap:6px;max-width:860px}
@media (max-width:860px){.dp-layout{grid-template-columns:1fr}.dp-nav{display:none}.dp-main{padding:20px 16px 60px}}
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
      <h3>{sample.group}</h3>
      <h2>{sample.title}</h2>
      <p className="dp-desc">{sample.description}</p>
      <div className="dp-frame ci-root">
        {compiled.view ? <ViewRenderer view={compiled.view} /> : <div className="dp-err">{compiled.error}</div>}
      </div>
      <div className="dp-bar">
        <button type="button" className="ci-btn" onClick={() => setShowSpec(!showSpec)}>{showSpec ? '隐藏 Spec' : '查看 Spec'}</button>
      </div>
      {showSpec ? <div className="dp-spec ci-root"><PreBlock text={JSON.stringify(sample.view, null, 2)} lines={40} /></div> : null}
    </section>
  )
}

const TONES: Tone[] = ['neutral', 'info', 'success', 'warning', 'danger']
const FORMATS: [Format, JsonValue, string][] = [
  ['text', 'prod-web-01', '原样输出'],
  ['number', 1234567.891, '千分位，最多两位小数'],
  ['percent', 87.5, '数值已是 0–100'],
  ['bytes', 5368709120, '自动换算单位'],
  ['currency', 13150.5, '金额'],
  ['datetime', '2026-11-16T03:21:00Z', 'ISO 字符串或秒/毫秒时间戳'],
  ['duration', 93784, '秒'],
  ['status', 'RUNNING', '按常见状态词上色'],
  ['tag', ['prod', 'web'], '数组逐个显示为标签'],
  ['code', 'ins-8h3k2m1q', '等宽字体'],
  ['link', 'https://cloud.tencent.com', '只允许 http(s)'],
]
const STATUS_WORDS = ['RUNNING', 'Normal', 'STOPPED', 'PENDING', 'EXPIRED', 'LAUNCH_FAILED', 'Deleting']

function Foundations() {
  return (
    <>
      <section className="dp-sec" id="tokens">
        <h3>基础</h3>
        <h2>颜色 token</h2>
        <p className="dp-desc">组件只使用 DSH 的 <code>--dsw-alias-*</code> 变量，跟随 DSH 的亮色和暗色主题。本页内置了与 DSH 0.2 一致的取值，便于独立预览。</p>
        <div className="dp-frame dp-swatches">
          {Object.keys(LIGHT).map((k) => (
            <div key={k} className="dp-sw" title={`--dsw-alias-${k}`}><i style={{ background: `var(--dsw-alias-${k})` }} /><span>{k}</span></div>
          ))}
        </div>
      </section>
      <section className="dp-sec" id="tones">
        <h3>基础</h3>
        <h2>语义色 tone 与状态徽标</h2>
        <p className="dp-desc">stats、alert、timeline 和 Badge 共用五种 tone。format 为 status 时，常见状态词自动映射到 tone。</p>
        <div className="dp-frame ci-root" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="dp-row">{TONES.map((t) => <Badge key={t} tone={t}>{t}</Badge>)}</div>
          <div className="dp-row">{STATUS_WORDS.map((w) => <span key={w}>{renderFormat('status', w)}</span>)}</div>
        </div>
      </section>
      <section className="dp-sec" id="formats">
        <h3>基础</h3>
        <h2>值格式 format</h2>
        <p className="dp-desc">表格列、kv、stats 和图表坐标轴共用同一套格式化。</p>
        <div className="dp-frame ci-root">
          <table className="dp-fmt">
            <thead><tr><th>format</th><th>输入</th><th>显示</th><th>说明</th></tr></thead>
            <tbody>
              {FORMATS.map(([f, v, note]) => (
                <tr key={f}><td><code>{f}</code></td><td><code>{JSON.stringify(v)}</code></td><td>{renderFormat(f, v)}</td><td style={{ color: 'var(--dsw-alias-label-tertiary)' }}>{note}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}

function renderFormat(format: Format, value: JsonValue): React.ReactNode {
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
    <section className="dp-sec" id="toolviews">
      <h3>工具卡片</h3>
      <h2>cloud_call / cloud_visualize 在对话中的样子</h2>
      <p className="dp-desc">cloud_call 卡片只展示请求摘要和有界的结果节选，默认折叠，点击标题展开；cloud_visualize 直接渲染视图。下面依次是调用中、只读成功（多地域，1 个失败）、写操作和失败。</p>
      <div className="dp-frame dp-cards">
        <CallToolView {...callProps({ service: 'cvm', action: 'DescribeInstances', regions: ['ap-guangzhou', 'ap-shanghai', 'ap-beijing'] }, null)} />
        <CallToolView {...callProps({ service: 'cvm', action: 'DescribeInstances' }, CALL_META)} />
        <CallToolView {...callProps({ service: 'vpc', action: 'ModifySecurityGroupAttribute' }, { ...CALL_META, service: 'vpc', action: 'ModifySecurityGroupAttribute', version: '2017-03-12', region: 'ap-guangzhou', regions: null, failedRegions: null, risk: 'write', ref: 'r9', durationMs: 214, truncated: false, preview: '{\n  "RequestId": "0b8e5a3c-71f2-4d0e-9c1a-5e2f7d3b6a90"\n}' })} />
        <CallToolView {...callProps({ service: 'vpc', action: 'DeleteSecurityGroup' }, null, { code: 'CLOUD_READONLY', reason: 'account "ro" is read-only; vpc.DeleteSecurityGroup is a write operation and was refused. Do not try to work around this.' })} />
        <VisualizeToolView phase="result" toolName="cloud_visualize" callId="v1" block={{ kind: 'tool-result', callId: 'v1', name: 'cloud_visualize', call: { name: 'cloud_visualize', argsRaw: JSON.stringify({ view: SAMPLES[0]!.view }) }, content: [], isError: false, meta: { kind: 'cloud-view', view: overview } }} />
      </div>
    </section>
  )
}

const NAV: { group: string; items: { id: string; title: string }[] }[] = [
  { group: '基础', items: [{ id: 'tokens', title: '颜色 token' }, { id: 'tones', title: '语义色与状态' }, { id: 'formats', title: '值格式' }] },
  ...['示例', '数据', '图表', '其他', '布局'].map((group) => ({ group, items: SAMPLES.filter((s) => s.group === group).map((s) => ({ id: s.id, title: s.title })) })),
  { group: '工具卡片', items: [{ id: 'toolviews', title: 'cloud_call / cloud_visualize' }] },
]

function useActiveSection(): string {
  const [active, setActive] = useState('tokens')
  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      const hit = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
      if (hit) setActive(hit.target.id)
    }, { rootMargin: '-64px 0px -70% 0px' })
    document.querySelectorAll('.dp-sec[id]').forEach((el) => observer.observe(el))
    return () => observer.disconnect()
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
    <>
      <header className="dp-top">
        <h1>Cloud View 组件</h1>
        <span className="dp-sub">@cocofhu/dsh-cloud-infra · {SAMPLES.length} 个示例</span>
        <span className="dp-grow" />
        <button type="button" className="ci-btn" onClick={() => setDark(!dark)}>{dark ? '亮色' : '暗色'}</button>
      </header>
      <div className="dp-layout">
        <nav className="dp-nav">
          {NAV.map((g) => (
            <div key={g.group}>
              <h4>{g.group}</h4>
              {g.items.map((it) => <a key={it.id} href={`#${it.id}`} className={active === it.id ? 'on' : ''}>{it.title}</a>)}
            </div>
          ))}
        </nav>
        <main className="dp-main">
          <p className="dp-intro">
            Agent 通过 <code>cloud_visualize</code> 提交 Cloud View Spec，插件校验并绑定 <code>cloud_call</code> 的缓存结果后，由这里的组件渲染。
            本页的每个示例都经过与工具相同的校验和编译流程，展开“查看 Spec”即可看到 Agent 需要写的 JSON。
          </p>
          <Foundations />
          {SAMPLES.map((s) => <Sample key={s.id} sample={s} />)}
          <ToolCards />
        </main>
      </div>
    </>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
