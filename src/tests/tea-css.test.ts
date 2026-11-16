import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import postcss from 'postcss'
import { compileSample } from '../design/compile-sample.js'
import { SAMPLES } from '../design/samples.js'
import type { CompiledView } from '../view/spec.js'

interface ClientUnderTest {
  ViewRenderer: (props: { view: CompiledView }) => React.ReactNode
  CallToolView: (props: Record<string, unknown>) => React.ReactNode
  SettingsCard: () => React.ReactNode
  TEA_CSS: string
}

const require = createRequire(import.meta.url)
const client = require('./client-under-test.cjs') as ClientUnderTest
const fullCss = readFileSync(join(dirname(require.resolve('tea-component/package.json')), 'dist/tea-themeable-no-reset.css'), 'utf8')
const hasRule = (css: string, cls: string) => new RegExp(`\\.${cls}(?![\\w-])`).test(css)

test('the pruned Tea CSS keeps every rule whose Tea classes all occur in rendered markup', () => {
  const markup = [
    ...SAMPLES.map((s) => renderToStaticMarkup(React.createElement(client.ViewRenderer, { view: compileSample(s) }))),
    renderToStaticMarkup(React.createElement(client.SettingsCard)),
    renderToStaticMarkup(React.createElement(client.CallToolView, { phase: 'call', block: { argsRaw: '{"service":"cvm","action":"DescribeInstances"}' } })),
  ].join('')
  const classes = new Set([...markup.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1]!.split(/\s+/)).filter((c) => c.startsWith('tea-')))
  assert.ok(classes.size > 30, `only ${classes.size} Tea classes rendered`)
  const selectors = (css: string) => {
    const out: string[] = []
    postcss.parse(css).walkRules((rule) => { out.push(...rule.selectors) })
    return out
  }
  const kept = new Set(selectors(client.TEA_CSS))
  const needed = selectors(fullCss).filter((s) => {
    const used = s.match(/\.tea-[\w-]+/g)
    return used?.every((c) => classes.has(c.slice(1))) && !/:-ms-|::-ms-/.test(s)
  })
  assert.ok(needed.length > 100, `only ${needed.length} applicable rules`)
  assert.deepEqual(needed.filter((s) => !kept.has(s)), [])
})

test('the pruned Tea CSS drops components the plugin never renders', () => {
  for (const cls of ['tea-datepicker', 'tea-dialog', 'tea-tree', 'tea-dropdown', 'tea-list', 'tea-icon-cloud']) assert.ok(!hasRule(client.TEA_CSS, cls), cls)
  assert.ok(client.TEA_CSS.length < 160_000, `${client.TEA_CSS.length} bytes`)
  assert.match(client.TEA_CSS, /^body\{--tea-/)
  assert.match(client.TEA_CSS, /body\[data-ds-dark-theme\]\{/)
})
