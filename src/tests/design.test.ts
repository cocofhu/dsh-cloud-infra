import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { compileSample } from '../design/compile-sample.js'
import { SAMPLES } from '../design/samples.js'
import type { CompiledNode } from '../view/spec.js'
import { CHART_TYPES, NODE_KINDS } from '../view/spec.js'
import { createStaticHandler, DESIGN_DIR } from '../web/static.js'

function walk(node: CompiledNode, visit: (n: CompiledNode) => void): void {
  visit(node)
  if (node.kind === 'group') node.children.forEach((c) => walk(c, visit))
  if (node.kind === 'tabs') node.tabs.forEach((t) => walk(t.body, visit))
  if (node.kind === 'card') walk(node.body, visit)
}

test('every design sample validates and compiles', () => {
  for (const sample of SAMPLES) assert.doesNotThrow(() => compileSample(sample), sample.id)
})

test('design samples cover every component kind and chart type', () => {
  const kinds = new Set<string>()
  const charts = new Set<string>()
  for (const sample of SAMPLES) {
    walk(compileSample(sample).body, (n) => {
      kinds.add(n.kind)
      if (n.kind === 'chart') charts.add(n.chart)
    })
  }
  assert.deepEqual(NODE_KINDS.filter((k) => !kinds.has(k)), [])
  assert.deepEqual(CHART_TYPES.filter((c) => !charts.has(c)), [])
})

test('design samples produce non-empty data', () => {
  for (const sample of SAMPLES) {
    walk(compileSample(sample).body, (n) => {
      if (n.kind === 'table') assert.ok(n.rows.length > 0, `${sample.id} table`)
      if (n.kind === 'chart') assert.ok(n.series.length || n.slices?.length || n.points?.length || n.cells?.length || n.gauge, `${sample.id} ${n.chart}`)
      if (n.kind === 'tree') assert.ok(n.nodes.length > 0, `${sample.id} tree`)
    })
  }
})

test('the design page is built next to the host code', () => {
  assert.ok(existsSync(join(DESIGN_DIR, 'index.html')))
  assert.ok(existsSync(join(DESIGN_DIR, 'design.js')))
})

test('static handler serves files, redirects the bare mount and refuses traversal', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ci-static-'))
  mkdirSync(join(root, 'chunks'))
  writeFileSync(join(root, 'index.html'), '<p>hi</p>')
  writeFileSync(join(root, 'chunks', 'a.js'), 'x')
  const handler = createStaticHandler('/m/design', root)
  const server: Server = createServer((req, res) => void handler(req, res))
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  try {
    const index = await fetch(`${base}/m/design/`)
    assert.equal(index.status, 200)
    assert.match(index.headers.get('content-type')!, /text\/html/)
    assert.equal(await index.text(), '<p>hi</p>')
    const chunk = await fetch(`${base}/m/design/chunks/a.js`)
    assert.match(chunk.headers.get('cache-control')!, /immutable/)
    const bare = await fetch(`${base}/m/design`, { redirect: 'manual' })
    assert.equal(bare.status, 301)
    assert.equal(bare.headers.get('location'), 'design/')
    assert.equal((await fetch(`${base}/m/design/%2e%2e%2fsecret`)).status, 403)
    assert.equal((await fetch(`${base}/m/design/missing.js`)).status, 404)
    assert.equal((await fetch(`${base}/m/design/`, { method: 'POST' })).status, 405)
  } finally {
    server.close()
  }
})
