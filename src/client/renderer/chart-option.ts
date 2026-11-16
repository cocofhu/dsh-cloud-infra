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
  switch (node.chart) {
    case 'pie':
    case 'donut':
      return {
        ...base,
        tooltip: { trigger: 'item', confine: true, valueFormatter: fmt },
        legend: { type: 'scroll', orient: 'vertical', right: 0, top: 'middle' },
        series: [{
          type: 'pie',
          radius: node.chart === 'donut' ? ['45%', '70%'] : '70%',
          center: ['40%', '50%'],
          data: node.slices ?? [],
          label: { formatter: '{d}%', textBorderWidth: 0 },
          labelLine: { length: 8, length2: 8 },
        }],
      }
    case 'gauge': {
      const g = node.gauge ?? { value: 0, max: 100 }
      return {
        series: [{
          type: 'gauge', min: 0, max: g.max, progress: { show: true, width: 12 }, axisLine: { lineStyle: { width: 12 } },
          detail: { valueAnimation: true, formatter: (v: number) => fmt(v), fontSize: 20 }, data: [{ value: g.value }],
        }],
      }
    }
    case 'scatter':
      return {
        ...base,
        tooltip: { trigger: 'item', confine: true },
        legend: { type: 'scroll', top: 0, show: (node.points?.length ?? 0) > 1 },
        xAxis: { type: 'value', scale: true },
        yAxis: { type: 'value', scale: true, axisLabel: { formatter: fmt } },
        series: (node.points ?? []).map((p) => ({ type: 'scatter', name: p.name, data: p.data, symbolSize: 8 })),
      }
    case 'heatmap': {
      const values = (node.cells ?? []).map((c) => c[2])
      return {
        ...base,
        tooltip: { position: 'top', confine: true },
        grid: { left: 12, right: 16, top: 12, bottom: 48, containLabel: true },
        xAxis: { type: 'category', data: (node.categories ?? []).map((c) => axisLabel(c, node.xFormat)), splitArea: { show: true } },
        yAxis: { type: 'category', data: (node.yCategories ?? []).map((c) => String(c)), splitArea: { show: true } },
        visualMap: { min: values.length ? Math.min(...values) : 0, max: values.length ? Math.max(...values) : 1, calculable: true, orient: 'horizontal', left: 'center', bottom: 0, inRange: { color: ['#d5e7ff', '#006eff', '#002da0'] } },
        series: [{ type: 'heatmap', data: node.cells ?? [], label: { show: (node.cells?.length ?? 0) <= 100 } }],
      }
    }
    default: {
      const horizontal = node.chart === 'hbar'
      const type = node.chart === 'line' || node.chart === 'area' ? 'line' : 'bar'
      const categoryAxis = {
        type: 'category',
        data: (node.categories ?? []).map((c) => axisLabel(c, node.xFormat)),
        boundaryGap: type === 'bar',
        axisLabel: { hideOverlap: true },
      }
      const valueAxis = { type: 'value', axisLabel: { formatter: fmt }, splitLine: { lineStyle: { type: 'dashed' } } }
      return {
        ...base,
        ...(horizontal ? { yAxis: { ...categoryAxis, inverse: true }, xAxis: valueAxis } : { xAxis: categoryAxis, yAxis: valueAxis }),
        ...((node.categories?.length ?? 0) > 60 && !horizontal ? { dataZoom: [{ type: 'inside' }], grid: { ...(base.grid as Option), bottom: 8 } } : {}),
        series: node.series.map((s) => ({
          type,
          name: s.name,
          data: s.data,
          ...(node.stack ? { stack: 'total' } : {}),
          ...(node.chart === 'area' ? { areaStyle: { opacity: 0.18 } } : {}),
          ...(type === 'line' ? { showSymbol: (node.categories?.length ?? 0) <= 40, smooth: false, connectNulls: false } : {}),
          ...(type === 'bar' && node.series.length === 1 ? { barMaxWidth: 36 } : {}),
          emphasis: { focus: 'series' },
        })),
      }
    }
  }
}

export function chartHeight(node: { chart?: string; height?: number; categories?: unknown[] }): number {
  if (node.height) return node.height
  if (node.chart === 'hbar') return Math.min(900, Math.max(200, (node.categories?.length ?? 5) * 26 + 60))
  if (node.chart === 'gauge') return 240
  return 300
}
