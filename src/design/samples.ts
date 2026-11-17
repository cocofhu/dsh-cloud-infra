/**
 * Design-page fixtures: mock cloud_call results plus one Cloud View spec per
 * component. Every spec goes through the real validate + compile pipeline, so
 * the page shows exactly what the agent can produce.
 */
import type { JsonObject, JsonValue } from '../core/types.js'
import type { ContentNode, ViewNode } from '../view/spec.js'

export interface DesignSample {
  id: string
  group: string
  title: string
  description: string
  view: { title?: string; items: ViewNode[] }
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
  r4: cost,
}

const r = (path?: string) => ({ ref: 'r1', ...(path ? { path } : {}) })
const SET = r('InstanceSet')

export const SAMPLES: DesignSample[] = [
  {
    id: 'overview', group: '示例', title: '组合看板',
    description: '一次 cloud_visualize 调用里，组件按 items 顺序从上到下排列。数据全部按 ref 绑定 cloud_call 原始结果，由组件自己分组和计数。',
    view: { title: '广州 CVM 实例概览', items: [
      { kind: 'stats', items: [
        { label: '实例总数', value: SET },
        { label: '系统盘', value: { ref: 'r1', path: 'InstanceSet[*].SystemDisk.DiskSize', agg: 'sum' }, unit: 'GB', tone: 'info' },
        { label: 'vCPU', value: { ref: 'r1', path: 'InstanceSet[*].CPU', agg: 'sum' }, unit: '核' },
        { label: '内存', value: { ref: 'r1', path: 'InstanceSet[*].Memory', agg: 'sum' }, unit: 'GB' },
      ] },
      { kind: 'chart', chart: 'pie', title: '实例状态', data: SET, x: 'InstanceState' },
      { kind: 'table', title: '实例明细', data: SET, columns: [
        { key: 'InstanceId' }, { key: 'InstanceName', title: '名称' }, { key: 'InstanceState', title: '状态', format: 'status' },
        { key: 'InstanceType', title: '机型' }, { key: 'Placement.Zone', title: '可用区' }, { key: 'PublicIpAddresses', title: '公网 IP' },
      ] },
    ] },
  },
  {
    id: 'multi-region', group: '示例', title: '多地域对比',
    description: 'cloud_call 的 regions 参数返回 { 地域: 结果 }。这种“对象的对象”在需要行的地方自动展开成 { key, ...value }，x 取 "key" 即可横向对比。',
    view: { items: [
      { kind: 'chart', chart: 'bar', title: '各地域实例数', data: { ref: 'r2' }, x: 'key', y: 'TotalCount', unit: '台' },
    ] },
  },
  {
    id: 'stats', group: '组件', title: 'stats 统计卡片',
    description: 'value 可以是常量，也可以绑定数组路径：默认计数，agg: "sum" 求和。tone 给数值上色。',
    view: { items: [{ kind: 'stats', items: [
      { label: '实例', value: SET },
      { label: 'vCPU 合计', value: { ref: 'r1', path: 'InstanceSet[*].CPU', agg: 'sum' }, unit: '核' },
      { label: '可用率', value: 99.95, format: 'percent', tone: 'success' },
      { label: '待处理告警', value: 3, tone: 'warning' },
      { label: '启动失败', value: 1, tone: 'danger' },
    ] }] },
  },
  {
    id: 'table', group: '组件', title: 'table 表格',
    description: '内置筛选、点击表头排序和分页（每页 10 行），不在内部纵向滚动。列宽按表头和内容估算，放不下时整表横向滚动。columns 省略时自动推断，并跳过全空的列。',
    view: { items: [{ kind: 'table', data: SET, columns: [
      { key: 'InstanceId' }, { key: 'InstanceName' }, { key: 'InstanceState', format: 'status' }, { key: 'InstanceType' },
      { key: 'CPU', format: 'number' }, { key: 'Memory', title: '内存 GB', format: 'number' }, { key: 'Placement.Zone', title: '可用区' },
      { key: 'PublicIpAddresses', title: '公网 IP' }, { key: 'InstanceChargeType', title: '计费' }, { key: 'CreatedTime', title: '创建时间', format: 'datetime' },
    ] }] },
  },
  {
    id: 'chart-line', group: '组件', title: 'chart · line 折线图',
    description: '每行自带时间和数值数组（如云监控 DataPoints）时，每行一条线，series 给线命名。时间轴按 x 路径自动识别。',
    view: { items: [
      { kind: 'chart', chart: 'line', title: 'CPU 使用率', data: { ref: 'r3', path: 'DataPoints' }, x: 'Timestamps', y: 'Values', series: 'Dimensions[0].Value', format: 'percent' },
    ] },
  },
  {
    id: 'chart-bar', group: '组件', title: 'chart · bar 柱状图',
    description: '按 x 分组，省略 y 时计数，写 y 时求和；series 拆成多组柱子。data 也可以是平行数组组成的对象，y 写多个路径。',
    view: { items: [
      { kind: 'chart', chart: 'bar', title: '各可用区实例（按状态）', data: SET, x: 'Placement.Zone', series: 'InstanceState' },
      { kind: 'chart', chart: 'bar', title: '月度费用', data: { ref: 'r4' }, x: 'Months', y: ['CVM', 'CBS', 'CLB'], unit: '元' },
    ] },
  },
  {
    id: 'chart-pie', group: '组件', title: 'chart · pie 饼图',
    description: 'x 是扇区名，y 求和；省略 y 时计数。',
    view: { items: [
      { kind: 'chart', chart: 'pie', title: '各机型内存', data: SET, x: 'InstanceType', y: 'Memory', unit: 'GB' },
    ] },
  },
  {
    id: 'kv', group: '组件', title: 'kv 键值详情',
    description: '展示单个资源的字段，items 省略时列出全部标量字段。',
    view: { items: [{ kind: 'kv', title: '实例详情', data: r('InstanceSet[0]'), items: [
      { path: 'InstanceId' }, { path: 'InstanceName', label: '名称' }, { path: 'InstanceState', label: '状态', format: 'status' },
      { path: 'InstanceType', label: '机型' }, { path: 'Placement.Zone', label: '可用区' }, { path: 'PrivateIpAddresses', label: '内网 IP' },
      { path: 'InstanceChargeType', label: '计费模式' }, { path: 'Memory', label: '内存 (GB)' }, { path: 'CreatedTime', label: '创建时间', format: 'datetime' },
    ] }] },
  },
  {
    id: 'tabs', group: '组件', title: 'tabs 标签页',
    description: '每个标签页里同样是从上到下排列的组件，适合按地域或分组切换；标签过多时换行。tabs 不能嵌套。',
    view: { items: [{ kind: 'tabs', tabs: [
      { label: '概览', items: [{ kind: 'stats', items: [{ label: '实例', value: SET }, { label: '运行中', value: 31, tone: 'success' }] }] },
      { label: '按机型', items: [{ kind: 'chart', chart: 'bar', data: SET, x: 'InstanceType', unit: '台' }] },
      ...REGION_COUNTS.slice(0, 4).map(([region, n]) => ({ label: `${region} ${n}`, items: [{ kind: 'kv', data: { 地域: region, 实例数: n } }] as ContentNode[] })),
    ] }] },
  },
]
