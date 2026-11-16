import type { CompiledChart, Format, JsonValue } from '../../view/spec.js'
import { axisLabel, formatValue } from '../format.js'

type Option = Record<string, unknown>

function valueFormatter(format: Format | undefined, unit: string | undefined): (v: unknown) => string {
  return (v) => {
    if (v === null || v === undefined || v === '-') return '—'
    const text = formatValue(v as JsonValue, format ?? 'number')
    return unit ? `${text} ${unit}` : text
  }
}

/** Translate a compiled chart node into an ECharts option. Pure: no DOM, no echarts import. */
export function chartOption(node: CompiledChart): Option {
  const fmt = valueFormatter(node.format, node.unit)
  const base: Option = {
    animationDuration: 300,
    grid: { left: 12, right: 16, top: 36, bottom: 8, containLabel: true },
    tooltip: { trigger: 'axis', confine: true, valueFormatter: fmt },
    legend: { type: 'scroll', top: 0, show: node.series.length > 1 },
  }
  if (node.chart === 'pie') {
    return {
      ...base,
      tooltip: { trigger: 'item', confine: true, valueFormatter: fmt },
      legend: { type: 'scroll', orient: 'vertical', right: 0, top: 'middle' },
      series: [{
        type: 'pie',
        radius: ['45%', '70%'],
        center: ['40%', '50%'],
        data: node.slices ?? [],
        label: { formatter: '{d}%', textBorderWidth: 0 },
        labelLine: { length: 8, length2: 8 },
      }],
    }
  }
  const type = node.chart
  const categories = node.categories ?? []
  return {
    ...base,
    xAxis: { type: 'category', data: categories.map((c) => axisLabel(c, node.xFormat)), boundaryGap: type === 'bar', axisLabel: { hideOverlap: true } },
    yAxis: { type: 'value', axisLabel: { formatter: fmt }, splitLine: { lineStyle: { type: 'dashed' } } },
    ...(categories.length > 60 ? { dataZoom: [{ type: 'inside' }] } : {}),
    series: node.series.map((s) => ({
      type,
      name: s.name,
      data: s.data,
      ...(type === 'line' ? { showSymbol: categories.length <= 40, smooth: false, connectNulls: false } : {}),
      ...(type === 'bar' && node.series.length === 1 ? { barMaxWidth: 36 } : {}),
      emphasis: { focus: 'series' },
    })),
  }
}

export const CHART_HEIGHT = 300
