/**
 * Bundle the browser half into DSH ModuleLoader scripts:
 *   lib/client.js          entry (slots, renderers, settings card)
 *   lib/client.echarts.js  ECharts, loaded on demand through require.async
 * React stays external and is resolved from the shared module table. The Tea components
 * the plugin uses, and only the Tea CSS rules and theme variables they need, are bundled
 * into client.js (see tea-trim-plugin.ts and tea-css.ts).
 * Also builds the standalone component design page into lib/design-page/.
 */
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { build } from 'esbuild'
import { CSS as HOST_CSS } from '../src/client/styles.ts'
import { buildTeaCss, injectTeaCss, TEA_CSS_PLACEHOLDER, teaCssPlugin } from './tea-css.ts'
import { teaTrimPlugin } from './tea-trim-plugin.ts'

const ROOT = join(import.meta.dirname, '..')
const OUT = join(ROOT, 'lib')
const PKG = (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { name: string }).name
const minify = !process.argv.includes('--dev')
const plugins = [teaTrimPlugin(ROOT), teaCssPlugin()]

/** Fill the Tea CSS placeholder with the rules the bundle (all of `codes`) actually uses. */
function withTeaCss<T extends string[]>(codes: T): { codes: T; css: string } {
  const css = buildTeaCss(ROOT, codes.join('\n'), HOST_CSS)
  return { codes: codes.map((c) => (c.includes(TEA_CSS_PLACEHOLDER) ? injectTeaCss(c, css) : c)) as T, css }
}

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
    plugins,
  })
  return result.outputFiles[0]!.text
}

function wrap(code: string, chunk?: string): string {
  const head = chunk ? `{ id: ${JSON.stringify(PKG)}, chunk: ${JSON.stringify(chunk)}, ` : `{ id: ${JSON.stringify(PKG)}, `
  return `window.__ModuleLoader__.load(${head}factory: (require) => {\nvar __dshRequire = require;\nvar module = { exports: {} };\nvar exports = module.exports;\n${code}\nreturn module.exports;\n} });\n`
}

mkdirSync(OUT, { recursive: true })
const { codes: [mainCode], css: teaCss } = withTeaCss([await bundle('src/client/index.tsx')])
const main = wrap(mainCode!)
const echarts = wrap(await bundle('src/client/echarts/index.ts'), 'client.echarts.js')
if (/echarts\/core|zrender/.test(main)) throw new Error('client.js must not include ECharts; import it only from the lazy chunk')
writeFileSync(join(OUT, 'client.js'), main)
writeFileSync(join(OUT, 'client.echarts.js'), echarts)
const teaDir = dirname(createRequire(join(ROOT, 'package.json')).resolve('tea-component/package.json'))
copyFileSync(join(teaDir, 'Attribution.txt'), join(OUT, 'tea-component.Attribution.txt'))

const testing = await build({
  entryPoints: [join(ROOT, 'src/client/testing.ts')],
  write: false,
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node22',
  mainFields: ['module', 'main'],
  external: ['react', 'react-dom'],
  jsx: 'transform',
  jsxFactory: 'React.createElement',
  jsxFragment: 'React.Fragment',
  logLevel: 'warning',
  plugins,
})
mkdirSync(join(OUT, 'tests'), { recursive: true })
writeFileSync(join(OUT, 'tests', 'client-under-test.cjs'), withTeaCss([testing.outputFiles[0]!.text]).codes[0]!)
const DESIGN = join(OUT, 'design-page')
rmSync(DESIGN, { recursive: true, force: true })
const design = await build({
  entryPoints: { design: join(ROOT, 'src/design/page.tsx') },
  outdir: DESIGN,
  write: false,
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2020',
  chunkNames: 'chunks/[name]-[hash]',
  alias: { '@deepseek-ai/dsh-tools': join(ROOT, 'src/design/dsh-tools-shim.ts') },
  jsx: 'transform',
  jsxFactory: 'React.createElement',
  jsxFragment: 'React.Fragment',
  define: { 'process.env.NODE_ENV': '"production"' },
  minify,
  legalComments: 'none',
  logLevel: 'warning',
  plugins,
})
const designCodes = withTeaCss(design.outputFiles.map((f) => f.text)).codes
design.outputFiles.forEach((f, i) => {
  mkdirSync(dirname(f.path), { recursive: true })
  writeFileSync(f.path, designCodes[i]!)
})
writeFileSync(join(DESIGN, 'index.html'), `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cloud View 组件 · ${PKG}</title>
</head>
<body>
<div id="root"></div>
<script type="module" src="./design.js"></script>
</body>
</html>
`)
console.log(`client: client.js ${(main.length / 1024).toFixed(0)}KB (Tea CSS ${(teaCss.length / 1024).toFixed(0)}KB), client.echarts.js ${(echarts.length / 1024).toFixed(0)}KB, design page lib/design-page/`)
