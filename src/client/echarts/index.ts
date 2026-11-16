/** Lazy chunk (client.echarts.js): ECharts with the chart types and components Cloud View uses. */
import * as echarts from 'echarts/core'
import { BarChart, GaugeChart, GraphChart, HeatmapChart, LineChart, PieChart, RadarChart, SankeyChart, ScatterChart, TreeChart, TreemapChart, FunnelChart, BoxplotChart, CandlestickChart } from 'echarts/charts'
import {
  DataZoomComponent, DatasetComponent, GridComponent, LegendComponent, MarkAreaComponent, MarkLineComponent, MarkPointComponent,
  PolarComponent, RadarComponent, TitleComponent, ToolboxComponent, TooltipComponent, TransformComponent, VisualMapComponent,
} from 'echarts/components'
import { LabelLayout, UniversalTransition } from 'echarts/features'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([
  BarChart, GaugeChart, GraphChart, HeatmapChart, LineChart, PieChart, RadarChart, SankeyChart, ScatterChart, TreeChart, TreemapChart,
  FunnelChart, BoxplotChart, CandlestickChart,
  DataZoomComponent, DatasetComponent, GridComponent, LegendComponent, MarkAreaComponent, MarkLineComponent, MarkPointComponent,
  PolarComponent, RadarComponent, TitleComponent, ToolboxComponent, TooltipComponent, TransformComponent, VisualMapComponent,
  LabelLayout, UniversalTransition, CanvasRenderer,
])

/** Tencent Cloud console chart palette. */
const PALETTE = ['#006eff', '#29cc85', '#ffbb00', '#ff584c', '#9741d9', '#1fc0cc', '#7dd936', '#ff9c19', '#e63984', '#655ce6']
const PALETTE_DARK = ['#2684ff', '#3dd598', '#ffc53d', '#ff7a6e', '#a96be3', '#3fd0db', '#95e05a', '#ffb04d', '#ee5d9c', '#837cf0']

function cssVar(el: HTMLElement, name: string, fallback: string): string {
  const v = getComputedStyle(el).getPropertyValue(name).trim()
  return v || fallback
}

/** Theme from the Cloud View tokens on the chart container, rebuilt on every mount/update so light/dark switches follow. */
function theme(el: HTMLElement, dark: boolean): Record<string, unknown> {
  const text = cssVar(el, '--ci-text', dark ? 'rgba(211,222,235,0.9)' : 'rgba(0,0,0,0.9)')
  const label = cssVar(el, '--ci-label', dark ? 'rgba(211,222,235,0.6)' : 'rgba(0,0,0,0.4)')
  const line = cssVar(el, '--ci-border', dark ? '#344158' : '#e7eaef')
  const axis = cssVar(el, '--ci-border-strong', dark ? '#344158' : '#cfd5de')
  const tooltipBg = cssVar(el, '--ci-bg', dark ? '#1e222d' : '#ffffff')
  return {
    color: dark ? PALETTE_DARK : PALETTE,
    backgroundColor: 'transparent',
    textStyle: { color: text, fontFamily: 'inherit', fontSize: 12 },
    legend: { textStyle: { color: label }, itemWidth: 12, itemHeight: 8, icon: 'rect' },
    tooltip: { backgroundColor: tooltipBg, borderColor: axis, borderRadius: 0, textStyle: { color: text, fontSize: 12 }, extraCssText: 'box-shadow:0 2px 4px 0 rgba(54,58,80,0.32);' },
    categoryAxis: { axisLine: { lineStyle: { color: axis } }, axisTick: { show: false }, axisLabel: { color: label }, splitLine: { lineStyle: { color: line } } },
    valueAxis: { axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: label }, splitLine: { lineStyle: { color: line, type: 'dashed' } } },
    timeAxis: { axisLine: { lineStyle: { color: axis } }, axisLabel: { color: label }, splitLine: { lineStyle: { color: line } } },
    title: { textStyle: { color: text } },
    gauge: { axisLine: { lineStyle: { color: [[1, line]] } }, splitLine: { lineStyle: { color: axis } }, axisTick: { lineStyle: { color: axis } }, axisLabel: { color: label }, detail: { color: text } },
    pie: { label: { color: text } },
    radar: { axisName: { color: label }, axisLine: { lineStyle: { color: line } }, splitLine: { lineStyle: { color: line } }, splitArea: { areaStyle: { color: ['transparent'] } } },
    bar: { barMaxWidth: 28 },
    line: { symbolSize: 4, lineStyle: { width: 2 } },
  }
}

export function mount(el: HTMLElement, option: Record<string, unknown>, dark: boolean) {
  let chart = echarts.init(el, theme(el, dark) as never, { renderer: 'canvas' })
  let currentDark = dark
  chart.setOption(option as never)
  const observer = new ResizeObserver(() => chart.resize())
  observer.observe(el)
  return {
    update(next: Record<string, unknown>, nextDark: boolean) {
      if (nextDark !== currentDark) {
        chart.dispose()
        chart = echarts.init(el, theme(el, nextDark) as never, { renderer: 'canvas' })
        currentDark = nextDark
      }
      chart.setOption(next as never, true)
    },
    resize() { chart.resize() },
    dispose() { observer.disconnect(); chart.dispose() },
  }
}
