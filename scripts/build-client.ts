/**
 * Bundle the browser half into DSH ModuleLoader scripts:
 *   lib/client.js          entry (slots, renderers, settings card)
 *   lib/client.echarts.js  ECharts, loaded on demand through require.async
 * React stays external and is resolved from the shared module table.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { build } from 'esbuild'

const ROOT = join(import.meta.dirname, '..')
const OUT = join(ROOT, 'lib')
const PKG = (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { name: string }).name
const minify = !process.argv.includes('--dev')

async function bundle(entry: string): Promise<string> {
  const result = await build({
    entryPoints: [join(ROOT, entry)],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'browser',
    target: 'es2020',
    external: ['react', 'react-dom'],
    jsx: 'transform',
    jsxFactory: 'React.createElement',
    jsxFragment: 'React.Fragment',
    define: { 'process.env.NODE_ENV': '"production"' },
    minify,
    legalComments: 'none',
    logLevel: 'warning',
  })
  return result.outputFiles[0]!.text
}

function wrap(code: string, chunk?: string): string {
  const head = chunk ? `{ id: ${JSON.stringify(PKG)}, chunk: ${JSON.stringify(chunk)}, ` : `{ id: ${JSON.stringify(PKG)}, `
  return `window.__ModuleLoader__.load(${head}factory: (require) => {\nvar __dshRequire = require;\nvar module = { exports: {} };\nvar exports = module.exports;\n${code}\nreturn module.exports;\n} });\n`
}

mkdirSync(OUT, { recursive: true })
const main = wrap(await bundle('src/client/index.tsx'))
const echarts = wrap(await bundle('src/client/echarts/index.ts'), 'client.echarts.js')
if (/echarts\/core|zrender/.test(main)) throw new Error('client.js must not include ECharts; import it only from the lazy chunk')
writeFileSync(join(OUT, 'client.js'), main)
writeFileSync(join(OUT, 'client.echarts.js'), echarts)

await build({
  entryPoints: [join(ROOT, 'src/client/testing.ts')],
  outfile: join(OUT, 'tests', 'client-under-test.cjs'),
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node22',
  external: ['react', 'react-dom'],
  jsx: 'transform',
  jsxFactory: 'React.createElement',
  jsxFragment: 'React.Fragment',
  logLevel: 'warning',
})
console.log(`client: client.js ${(main.length / 1024).toFixed(0)}KB, client.echarts.js ${(echarts.length / 1024).toFixed(0)}KB`)
