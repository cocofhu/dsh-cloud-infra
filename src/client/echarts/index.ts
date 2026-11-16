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

const PALETTE = ['#4d6bfe', '#20a97c', '#f0973a', '#e0668e', '#7f6bd6', '#2bb3c0', '#d9a514', '#8c97a8', '#5ab1ef', '#c05050']

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.body).getPropertyValue(name).trim()
  return v || fallback
}

/** Theme from DSH design tokens, rebuilt on every mount/update so light/dark switches follow. */
function theme(dark: boolean): Record<string, unknown> {
  const text = cssVar('--dsw-alias-label-secondary', dark ? '#c9cdd4' : '#4e5969')
  const faint = cssVar('--dsw-alias-label-tertiary', dark ? '#8a919f' : '#86909c')
  const line = cssVar('--dsw-alias-border-l2', dark ? '#3a3f4b' : '#e5e6eb')
  const tooltipBg = cssVar('--dsw-alias-bg-layer-1', dark ? '#1f2329' : '#ffffff')
  return {
    color: PALETTE,
    backgroundColor: 'transparent',
    textStyle: { color: text, fontFamily: 'inherit' },
    legend: { textStyle: { color: text } },
    tooltip: { backgroundColor: tooltipBg, borderColor: line, textStyle: { color: cssVar('--dsw-alias-label-primary', text) } },
    categoryAxis: { axisLine: { lineStyle: { color: line } }, axisTick: { lineStyle: { color: line } }, axisLabel: { color: faint }, splitLine: { lineStyle: { color: line } } },
    valueAxis: { axisLine: { lineStyle: { color: line } }, axisLabel: { color: faint }, splitLine: { lineStyle: { color: line } } },
    timeAxis: { axisLabel: { color: faint }, splitLine: { lineStyle: { color: line } } },
    title: { textStyle: { color: text } },
    gauge: { axisLabel: { color: faint }, detail: { color: text } },
  }
}

export function mount(el: HTMLElement, option: Record<string, unknown>, dark: boolean) {
  let chart = echarts.init(el, theme(dark) as never, { renderer: 'canvas' })
  let currentDark = dark
  chart.setOption(option as never)
  const observer = new ResizeObserver(() => chart.resize())
  observer.observe(el)
  return {
    update(next: Record<string, unknown>, nextDark: boolean) {
      if (nextDark !== currentDark) {
        chart.dispose()
        chart = echarts.init(el, theme(nextDark) as never, { renderer: 'canvas' })
        currentDark = nextDark
      }
      chart.setOption(next as never, true)
    },
    resize() { chart.resize() },
    dispose() { observer.disconnect(); chart.dispose() },
  }
}
