import type { Format, JsonValue } from '../view/spec.js'

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']

export function formatBytes(n: number): string {
  let v = Math.abs(n)
  let i = 0
  while (v >= 1024 && i < BYTE_UNITS.length - 1) { v /= 1024; i++ }
  return `${n < 0 ? '-' : ''}${v >= 100 || i === 0 ? v.toFixed(0) : v.toFixed(1)} ${BYTE_UNITS[i]}`
}

/** Seconds and milliseconds epoch numbers, ISO strings and "YYYY-MM-DD HH:mm:ss" all become local time. */
export function toDate(v: JsonValue): Date | null {
  if (typeof v === 'number') return new Date(v < 1e11 ? v * 1000 : v)
  if (typeof v === 'string' && v) {
    if (/^\d{10,13}$/.test(v)) return toDate(Number(v))
    const d = new Date(/^\d{4}-\d{2}-\d{2} \d/.test(v) ? v.replace(' ', 'T') : v)
    return Number.isNaN(d.getTime()) ? null : d
  }
  return null
}

function pad(n: number): string { return String(n).padStart(2, '0') }

export function formatDate(d: Date, withSeconds = false): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}${withSeconds ? `:${pad(d.getSeconds())}` : ''}`
}

export function formatNumber(n: number): string {
  if (Number.isInteger(n)) return n.toLocaleString()
  return n.toLocaleString(undefined, { maximumFractionDigits: Math.abs(n) < 1 ? 4 : 2 })
}

/** Plain-text rendering of a value under a format; React components add color and tags on top. */
export function formatValue(v: JsonValue | undefined, format?: Format): string {
  if (v === undefined || v === null || v === '') return '—'
  if (Array.isArray(v)) return v.map((x) => formatValue(x, format)).join(', ')
  if (typeof v === 'object') return JSON.stringify(v)
  switch (format) {
    case 'number': return typeof v === 'number' ? formatNumber(v) : String(v)
    case 'percent': return typeof v === 'number' ? `${formatNumber(v)}%` : String(v)
    case 'bytes': return typeof v === 'number' || /^\d+(\.\d+)?$/.test(String(v)) ? formatBytes(Number(v)) : String(v)
    case 'datetime': { const d = toDate(v); return d ? formatDate(d, true) : String(v) }
    default: return typeof v === 'number' ? formatNumber(v) : String(v)
  }
}

export function axisLabel(v: JsonValue, format?: Format): string {
  if (format === 'datetime') { const d = toDate(v); return d ? formatDate(d) : String(v) }
  return formatValue(v, format)
}
