/**
 * esbuild plugin that keeps the parts of Tea the plugin never uses out of the bundle:
 * - `Icon`'s type → SVG component map becomes empty, so `<Icon type>` falls back to
 *   Tea's CSS icons (`.tea-icon-<type>`, data-URI SVGs in the stylesheet), and the
 *   tea-icons-react barrel (~370KB) is replaced by the few icons Tea components import;
 * - `Table.addons` holds only the addons listed in `TABLE_ADDONS` instead of all 18;
 * - `Select` (with its list, dropdown and react-window) is replaced by a stub where Tea
 *   imports it without needing it: `Bubble` only compares child types against it, and
 *   `Pagination` renders it only for the page-size picker (`pageSizeVisible: false`);
 * - `Input.Password` (strength popup built on List, Dropdown and react-window) is a stub;
 *   plain `<Input type="password">` is unaffected;
 * - the virtualized table body (react-window) is a stub: only the `scrollable` addon,
 *   which is not in `TABLE_ADDONS`, turns it on;
 * - the popup layer (Tooltip / Bubble / Copy, built on popper.js) is left out: Tooltip
 *   becomes the native `title` attribute (Pagination's turn buttons use it), Bubble
 *   (Form.Item `tips`) and Copy (Text `copyable`) render their children only.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { Plugin } from 'esbuild'

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walk(path, out)
    else if (name.endsWith('.js')) out.push(path)
  }
  return out
}

/** Addons reachable through `Table.addons`; add one here before using it. */
const TABLE_ADDONS = ['sortable']

const stub = (name: string) => `export function ${name}() { throw new Error("Tea ${name} is not bundled with dsh-cloud-infra") }`
const TOOLTIP = `import React from "react";
export function Tooltip(props) {
  var child = props.children;
  return typeof props.title === "string" && React.isValidElement(child) ? React.cloneElement(child, { title: props.title }) : child;
}`
const STUBS: { request: RegExp; importer: RegExp; contents: string }[] = [
  { request: /^\.\.\/select$/, importer: /[\\/]es[\\/](bubble[\\/]Bubble|pagination[\\/]Pagination)\.js$/, contents: stub('Select') },
  { request: /^\.\/InputPassword$/, importer: /[\\/]es[\\/]input[\\/]Input\.js$/, contents: stub('InputPassword') },
  { request: /^\.\.\/tooltip$/, importer: /[\\/]es[\\/](button[\\/]Button|icon[\\/]Icon|text[\\/]Text|check[\\/]Check|pagination[\\/]Pagination)\.js$/, contents: TOOLTIP },
  { request: /^\.\.\/bubble$/, importer: /[\\/]es[\\/]form[\\/]FormItem\.js$/, contents: 'export function Bubble(props) { return props.children }' },
  { request: /^\.\.\/copy$/, importer: /[\\/]es[\\/]text[\\/]Text\.js$/, contents: 'export function Copy(props) { return props.children || null }' },
  { request: /^\.\/TableVirtualizedBody$/, importer: /[\\/]es[\\/]table[\\/]TableBody\.js$/, contents: stub('TableVirtualizedBody') },
]

export function teaTrimPlugin(root: string): Plugin {
  const require = createRequire(join(root, 'package.json'))
  const teaDir = dirname(require.resolve('tea-component/package.json'))
  const iconsDir = dirname(createRequire(join(teaDir, 'package.json')).resolve('tea-icons-react/package.json'))
  const files = new Map<string, string>()
  for (const m of readFileSync(join(iconsDir, 'esm/index.js'), 'utf8').matchAll(/export \{ default as (\w+) \} from '(\.\/components\/[^']+)'/g)) files.set(m[1]!, m[2]!)
  const used = new Set<string>()
  const iconMap = join(teaDir, 'es/icon/tea-icons-map.js')
  for (const file of walk(join(teaDir, 'es'))) {
    if (file === iconMap) continue
    for (const m of readFileSync(file, 'utf8').matchAll(/import\s*\{([^}]+)\}\s*from\s*"tea-icons-react"/g)) {
      const names = m[1]!.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '').split(',').map((s) => s.trim()).filter(Boolean)
      for (const name of names) used.add(name)
    }
  }
  const missing = [...used].filter((n) => !files.has(n))
  if (missing.length) throw new Error(`tea-icons-react has no component file for ${missing.join(', ')}`)
  const contents = [...used].sort().map((n) => `export { default as ${n} } from '${files.get(n)}'`).join('\n')
  return {
    name: 'tea-trim',
    setup(build) {
      build.onResolve({ filter: /^tea-icons-react$/ }, () => ({ path: 'tea-icons-react', namespace: 'tea-icons' }))
      STUBS.forEach(({ request, importer }, i) => {
        build.onResolve({ filter: request }, (args) => (importer.test(args.importer) ? { path: String(i), namespace: 'tea-stub' } : undefined))
      })
      build.onLoad({ filter: /.*/, namespace: 'tea-stub' }, (args) => ({ contents: STUBS[Number(args.path)]!.contents, loader: 'js', resolveDir: join(teaDir, 'es') }))
      build.onLoad({ filter: /.*/, namespace: 'tea-icons' }, () => ({ contents, resolveDir: join(iconsDir, 'esm'), loader: 'js' }))
      build.onLoad({ filter: /[\\/]es[\\/]icon[\\/]tea-icons-map\.js$/ }, () => ({ contents: 'export var teaIconsMap = {}', loader: 'js' }))
      build.onLoad({ filter: /[\\/]es[\\/]table[\\/]Table\.js$/ }, (args) => {
        const source = readFileSync(args.path, 'utf8')
        const star = 'import * as addons from "./addons";'
        if (!source.includes(star)) throw new Error(`unexpected ${args.path}: Table no longer imports "./addons" as a namespace`)
        const imports = TABLE_ADDONS.map((n) => `import { ${n} } from "./addons/${n}";`).join('\n')
        const contents = source.replace(star, `${imports}\nvar addons = { ${TABLE_ADDONS.join(', ')} };`)
        return { contents, loader: 'js', resolveDir: dirname(args.path) }
      })
    },
  }
}
