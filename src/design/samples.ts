/**
 * Design-page fixtures: mock cloud_call results plus one Cloud View spec per
 * component. Every spec goes through the real validate + compile pipeline, so
 * the page shows exactly what the agent can produce.
 */
import type { JsonObject, JsonValue } from '../core/types.js'
import type { ViewNode } from '../view/spec.js'

export interface DesignSample {
  id: string
  group: string
  title: string
  description: string
  view: { title?: string; body: ViewNode }
}

function rng(seed: number) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

const rand = rng(20261116)
const pick = <T,>(items: readonly T[]): T => items[Math.floor(rand() * items.length)]!
const hex = (n: number) => Array.from({ length: n }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(rand() * 36)]).join('')
const ip = (a: number) => `${a}.${Math.floor(rand() * 250) + 2}.${Math.floor(rand() * 250) + 2}.${Math.floor(rand() * 250) + 2}`

const ZONES = ['ap-guangzhou-3', 'ap-guangzhou-4', 'ap-guangzhou-6', 'ap-guangzhou-7']
const TYPES = [['S5.MEDIUM4', 2, 4], ['S5.LARGE8', 4, 8], ['SA3.2XLARGE16', 8, 16], ['S6.4XLARGE32', 16, 32]] as const
const STATES = ['RUNNING', 'RUNNING', 'RUNNING', 'RUNNING', 'RUNNING', 'STOPPED', 'STOPPED', 'PENDING', 'LAUNCH_FAILED']
const APPS = ['web', 'api', 'worker', 'cache', 'batch']
const ENVS = ['prod', 'prod', 'staging', 'dev']

function instance(i: number): JsonObject {
  const [type, cpu, mem] = pick(TYPES)
  const state = pick(STATES)
  const app = pick(APPS)
  const env = pick(ENVS)
  const created = Date.UTC(2026, 0, 1) + Math.floor(rand() * 300) * 86400_000
  return {
    InstanceId: `ins-${hex(8)}`,
    InstanceName: `${env}-${app}-${String(i + 1).padStart(2, '0')}`,
    InstanceState: state,
    InstanceType: type,
    CPU: cpu,
    Memory: mem,
    Placement: { Zone: pick(ZONES), ProjectId: 0 },
    PrivateIpAddresses: [ip(10)],
    PublicIpAddresses: state === 'RUNNING' && rand() > 0.3 ? [ip(129)] : [],
    InstanceChargeType: rand() > 0.35 ? 'POSTPAID_BY_HOUR' : 'PREPAID',
    SystemDisk: { DiskType: 'CLOUD_BSSD', DiskSize: pick([50, 100, 200]) },
    CreatedTime: new Date(created).toISOString(),
    Tags: [{ Key: 'env', Value: env }, { Key: 'app', Value: app }],
  }
}

const instances = Array.from({ length: 42 }, (_, i) => instance(i))

const REGION_COUNTS: [string, number][] = [
  ['ap-chengdu', 97], ['ap-seoul', 30], ['ap-guangzhou', 18], ['ap-beijing', 18], ['ap-singapore', 18],
  ['ap-hongkong', 14], ['ap-nanjing', 6], ['ap-chongqing', 5], ['ap-shanghai', 3], ['ap-tokyo', 1], ['ap-bangkok', 1],
]

const regions: JsonObject = Object.fromEntries(REGION_COUNTS.map(([region, n]) => [region, { TotalCount: n, InstanceSet: [], RequestId: hex(8) }]))

const start = Date.UTC(2026, 10, 16, 0, 0) / 1000
const monitor: JsonObject = {
  MetricName: 'CPUUsage',
  Period: 300,
  DataPoints: instances.slice(0, 3).map((ins, k) => ({
    Dimensions: [{ Name: 'InstanceId', Value: ins.InstanceId as string }],
    Timestamps: Array.from({ length: 72 }, (_, t) => start + t * 300),
    Values: Array.from({ length: 72 }, (_, t) => Math.round((20 + k * 15 + 18 * Math.sin((t + k * 9) / 9) + rand() * 8) * 10) / 10),
  })),
}

const topology: JsonValue[] = [
  { Name: 'vpc-prod (10.0.0.0/16)', Info: '3 个子网', Children: [
    { Name: 'subnet-web · ap-guangzhou-3', Info: '10.0.1.0/24 · 剩余 231 IP', Children: instances.slice(0, 3).map((i) => ({ Name: i.InstanceName, Info: i.InstanceId })) },
    { Name: 'subnet-api · ap-guangzhou-4', Info: '10.0.2.0/24 · 剩余 240 IP', Children: instances.slice(3, 5).map((i) => ({ Name: i.InstanceName, Info: i.InstanceId })) },
    { Name: 'subnet-db · ap-guangzhou-6', Info: '10.0.3.0/24 · 剩余 250 IP' },
  ] },
  { Name: 'vpc-staging (172.16.0.0/16)', Info: '1 个子网', Children: [
    { Name: 'subnet-default · ap-guangzhou-3', Info: '172.16.0.0/20 · 剩余 4090 IP' },
  ] },
]

const events: JsonValue[] = [
  { Time: '2026-11-16T01:12:00Z', Event: '创建实例 prod-web-04', Detail: 'RunInstances · S5.LARGE8 · ap-guangzhou-3', Level: 'success' },
  { Time: '2026-11-16T02:40:00Z', Event: '安全组规则变更', Detail: 'sg-3kx8q1 放通 443/TCP', Level: 'info' },
  { Time: '2026-11-16T03:05:00Z', Event: 'CPU 使用率告警', Detail: 'prod-api-02 连续 5 分钟 > 90%', Level: 'warning' },
  { Time: '2026-11-16T03:21:00Z', Event: '实例启动失败', Detail: 'LAUNCH_FAILED：可用区库存不足', Level: 'danger' },
  { Time: '2026-11-16T04:00:00Z', Event: '告警恢复', Detail: 'prod-api-02 CPU 回落到 41%', Level: 'success' },
]

const heat: JsonValue[] = []
for (const day of ['周一', '周二', '周三', '周四', '周五', '周六', '周日']) {
  for (let h = 0; h < 24; h += 2) heat.push({ Day: day, Hour: `${String(h).padStart(2, '0')}:00`, Calls: Math.round(200 + 800 * Math.max(0, Math.sin((h - 6) / 24 * Math.PI * 2)) * (day.startsWith('周六') || day === '周日' ? 0.4 : 1) + rand() * 120) })
}

const cost = {
  Months: ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'],
  CVM: [8210, 8460, 9120, 9480, 10230, 10890],
  CBS: [1210, 1260, 1330, 1350, 1420, 1500],
  CLB: [640, 640, 700, 720, 760, 760],
}

/** Mock results by ref, as returned by cloud_call. */
export const RESULTS: Record<string, JsonValue> = {
  r1: { TotalCount: instances.length, InstanceSet: instances, RequestId: 'f1c3a2e4-6b0d-4a51-9a3e-2d7c0b1e9f10' },
  r2: regions,
  r3: monitor,
  r4: topology,
  r5: events,
  r6: heat,
  r7: cost,
}

const r = (path?: string) => ({ ref: 'r1', ...(path ? { path } : {}) })
const SET = r('InstanceSet')

export const SAMPLES: DesignSample[] = [
  {
    id: 'overview', group: '示例', title: '组合看板',
    description: '一次 cloud_visualize 调用组合统计卡片、图表和表格，数据全部按 ref 绑定 cloud_call 原始结果，由组件自己分组和计数。',
    view: { title: '广州 CVM 实例概览', body: { kind: 'group', children: [
      { kind: 'stats', items: [
        { label: '实例总数', value: SET },
        { label: '系统盘', value: { ref: 'r1', path: 'InstanceSet[*].SystemDisk.DiskSize', agg: 'sum' }, unit: 'GB', tone: 'info' },
        { label: 'vCPU', value: { ref: 'r1', path: 'InstanceSet[*].CPU', agg: 'sum' }, unit: '核' },
        { label: '内存', value: { ref: 'r1', path: 'InstanceSet[*].Memory', agg: 'sum' }, unit: 'GB' },
      ] },
      { kind: 'group', direction: 'row', children: [
        { kind: 'chart', chart: 'donut', title: '实例状态', data: SET, x: 'InstanceState' },
        { kind: 'chart', chart: 'hbar', title: '机型 × 状态', data: SET, x: 'InstanceType', series: 'InstanceState', stack: true },
      ] },
      { kind: 'table', title: '实例明细', data: SET, columns: [
        { key: 'InstanceId', format: 'code' }, { key: 'InstanceName', title: '名称' }, { key: 'InstanceState', title: '状态', format: 'status' },
        { key: 'InstanceType', title: '机型' }, { key: 'Placement.Zone', title: '可用区' }, { key: 'PublicIpAddresses', title: '公网 IP', format: 'tag' },
      ] },
    ] } },
  },
  {
    id: 'multi-region', group: '示例', title: '多地域对比',
    description: 'cloud_call 的 regions 参数返回 { 地域: 结果 }。这种“对象的对象”在需要行的地方自动展开成 { key, ...value }，x 取 "key" 即可横向对比。',
    view: { body: { kind: 'group', direction: 'row', children: [
      { kind: 'chart', chart: 'bar', title: '各地域实例数', data: { ref: 'r2' }, x: 'key', y: 'TotalCount' },
      { kind: 'chart', chart: 'pie', title: '地域占比', data: { ref: 'r2' }, x: 'key', y: 'TotalCount' },
    ] } },
  },
  {
    id: 'stats', group: '数据', title: 'stats 统计卡片',
    description: 'value 可以是常量，也可以绑定数组路径：不写 agg 时计数，agg 支持 count / sum / avg / min / max / first。tone 给数值上色。',
    view: { body: { kind: 'stats', items: [
      { label: '实例', value: SET },
      { label: '平均 vCPU', value: { ref: 'r1', path: 'InstanceSet[*].CPU', agg: 'avg' }, format: 'number', unit: '核' },
      { label: '可用率', value: 99.95, format: 'percent', tone: 'success' },
      { label: '待处理告警', value: 3, tone: 'warning', hint: '近 24 小时' },
      { label: '启动失败', value: 1, tone: 'danger' },
      { label: '本月费用', value: 13150, format: 'currency', tone: 'info' },
    ] } },
  },
  {
    id: 'table', group: '数据', title: 'table 表格',
    description: '支持筛选、点击表头排序和分页（默认每页 10 行），不在内部纵向滚动。columns 省略时自动推断，并跳过全空的列。',
    view: { body: { kind: 'table', data: SET, pageSize: 8, columns: [
      { key: 'InstanceId', format: 'code' }, { key: 'InstanceName', title: '名称' }, { key: 'InstanceState', title: '状态', format: 'status' },
      { key: 'CPU', title: 'vCPU', format: 'number' }, { key: 'SystemDisk.DiskSize', title: '系统盘 (GB)' },
      { key: 'Tags[*].Value', title: '标签', format: 'tag' }, { key: 'CreatedTime', title: '创建时间', format: 'datetime' },
    ] } },
  },
  {
    id: 'kv', group: '数据', title: 'kv 键值详情',
    description: '展示单个对象的字段，items 省略时列出全部标量字段。',
    view: { body: { kind: 'kv', title: '实例详情', columns: 3, data: r('InstanceSet[0]'), items: [
      { path: 'InstanceId', format: 'code' }, { path: 'InstanceName', label: '名称' }, { path: 'InstanceState', label: '状态', format: 'status' },
      { path: 'InstanceType', label: '机型' }, { path: 'Placement.Zone', label: '可用区' }, { path: 'PrivateIpAddresses', label: '内网 IP', format: 'tag' },
      { path: 'InstanceChargeType', label: '计费模式' }, { path: 'Memory', label: '内存 (GB)' }, { path: 'CreatedTime', label: '创建时间', format: 'datetime' },
    ] } },
  },
  {
    id: 'chart-line', group: '图表', title: 'line / area 折线与面积图',
    description: '每行自带时间和数值数组（如云监控 DataPoints）时，每行一条序列。列模式用平行数组画堆叠面积图。',
    view: { body: { kind: 'group', direction: 'row', children: [
      { kind: 'chart', chart: 'line', title: 'CPU 使用率', data: { ref: 'r3', path: 'DataPoints' }, x: 'Timestamps', y: 'Values', series: 'Dimensions[0].Value', format: 'percent', xFormat: 'datetime' },
      { kind: 'chart', chart: 'area', title: '月度费用', data: { ref: 'r7' }, x: 'Months', y: ['CVM', 'CBS', 'CLB'], stack: true, format: 'currency' },
    ] } },
  },
  {
    id: 'chart-bar', group: '图表', title: 'bar / hbar 柱状图',
    description: '行模式按 x 分组，省略 y 时计数，series 拆分多组，stack 堆叠。',
    view: { body: { kind: 'group', direction: 'row', children: [
      { kind: 'chart', chart: 'bar', title: '各可用区实例（按状态）', data: SET, x: 'Placement.Zone', series: 'InstanceState', stack: true },
      { kind: 'chart', chart: 'hbar', title: '各机型 vCPU 合计', data: SET, x: 'InstanceType', y: 'CPU', unit: '核' },
    ] } },
  },
  {
    id: 'chart-pie', group: '图表', title: 'pie / donut 饼图',
    description: 'x 是扇区名，y 求和；省略 y 时计数。',
    view: { body: { kind: 'group', direction: 'row', children: [
      { kind: 'chart', chart: 'pie', title: '计费模式', data: SET, x: 'InstanceChargeType' },
      { kind: 'chart', chart: 'donut', title: '各机型内存', data: SET, x: 'InstanceType', y: 'Memory', unit: 'GB' },
    ] } },
  },
  {
    id: 'chart-other', group: '图表', title: 'scatter / heatmap / gauge',
    description: '散点图需要数值型 x、y；热力图用 x、y 两个分类和 value；仪表盘取一个数值。',
    view: { body: { kind: 'group', columns: 3, children: [
      { kind: 'chart', chart: 'scatter', title: 'vCPU × 内存', data: SET, x: 'CPU', y: 'Memory', series: 'InstanceState' },
      { kind: 'chart', chart: 'heatmap', title: 'API 调用量', data: { ref: 'r6' }, x: 'Hour', y: 'Day', value: 'Calls' },
      { kind: 'chart', chart: 'gauge', title: '当前 CPU', data: { ref: 'r3', path: 'DataPoints[0].Values' }, format: 'percent' },
    ] } },
  },
  {
    id: 'echarts', group: '图表', title: 'echarts 原生配置',
    description: '简单形式表达不了的图（雷达、桑基、关系图等）直接写 ECharts option。外部资源会被清洗，data 中的绑定变成 dataset。',
    view: { body: { kind: 'echarts', title: '各环境资源画像', height: 300, option: {
      tooltip: {}, legend: { bottom: 0 },
      radar: { indicator: [{ name: 'CPU', max: 100 }, { name: '内存', max: 100 }, { name: '磁盘', max: 100 }, { name: '带宽', max: 100 }, { name: '连接数', max: 100 }] },
      series: [{ type: 'radar', data: [{ name: 'prod', value: [72, 64, 48, 81, 69] }, { name: 'staging', value: [35, 41, 30, 22, 18] }] }],
    } } },
  },
  {
    id: 'timeline', group: '其他', title: 'timeline 时间线',
    description: 'time、label、description、tone 都是相对每行的路径；tone 支持常见状态词。',
    view: { body: { kind: 'timeline', title: '今日变更与告警', data: { ref: 'r5' }, time: 'Time', label: 'Event', description: 'Detail', tone: 'Level' } },
  },
  {
    id: 'tree', group: '其他', title: 'tree 树',
    description: '适合 VPC → 子网 → 实例这类层级，前两层默认展开。',
    view: { body: { kind: 'tree', title: '网络拓扑', data: { ref: 'r4' }, label: 'Name', children: 'Children', value: 'Info' } },
  },
  {
    id: 'text', group: '其他', title: 'markdown / alert 文本',
    description: 'markdown 只支持安全子集；alert 有五种 tone。',
    view: { body: { kind: 'group', children: [
      { kind: 'markdown', text: '### 巡检结论\n- **2 台**实例处于 `STOPPED`，建议确认是否释放\n- 1 台实例启动失败，详见 [实例文档](https://cloud.tencent.com/document/product/213)' },
      { kind: 'alert', tone: 'info', title: '提示', text: '数据来自 DescribeInstances，最多展示 2000 行。' },
      { kind: 'alert', tone: 'success', text: '所有安全组都已绑定实例。' },
      { kind: 'alert', tone: 'warning', title: '注意', text: '3 台按量计费实例已连续停机超过 30 天。' },
      { kind: 'alert', tone: 'danger', title: '高危', text: '安全组 sg-3kx8q1 对 0.0.0.0/0 放通了 22 端口。' },
    ] } },
  },
  {
    id: 'json', group: '其他', title: 'json 原始数据',
    description: '兜底展示。超过 20 行时折叠，点击展开，不产生内部滚动条。',
    view: { body: { kind: 'json', title: 'InstanceSet[0]', data: r('InstanceSet[0]') } },
  },
  {
    id: 'layout', group: '布局', title: 'group / card / tabs',
    description: 'group 纵向或横向排列，columns 用响应式网格；card 加标题边框；tabs 切换多块内容（标签过多时换行）。',
    view: { body: { kind: 'tabs', tabs: [
      { label: '网格 columns: 3', body: { kind: 'group', columns: 3, children: [
        { kind: 'card', title: 'prod', subtitle: '生产环境', body: { kind: 'stats', items: [{ label: '实例', value: 24, tone: 'success' }] } },
        { kind: 'card', title: 'staging', subtitle: '预发环境', body: { kind: 'stats', items: [{ label: '实例', value: 11 }] } },
        { kind: 'card', title: 'dev', subtitle: '开发环境', body: { kind: 'stats', items: [{ label: '实例', value: 7, tone: 'warning' }] } },
      ] } },
      { label: '横向 row', body: { kind: 'group', direction: 'row', children: [
        { kind: 'card', title: '左侧卡片', body: { kind: 'markdown', text: '宽度不足时自动换行。' } },
        { kind: 'card', title: '右侧卡片', body: { kind: 'markdown', text: '每项最小宽度 260px。' } },
      ] } },
      ...REGION_COUNTS.slice(0, 6).map(([region, n]) => ({ label: `${region} ${n}`, body: { kind: 'markdown', text: `${region}：${n} 台实例` } as ViewNode })),
    ] } },
  },
]
