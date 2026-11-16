/**
 * esbuild plugin that keeps tea-icons-react out of the bundle (~370KB):
 * - `Icon`'s type → SVG component map becomes empty, so `<Icon type>` falls back to
 *   Tea's CSS icons (`.tea-icon-<type>`, data-URI SVGs already in the stylesheet);
 * - the barrel import is replaced by a module re-exporting only the icons other Tea
 *   components import directly.
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

export function teaIconsPlugin(root: string): Plugin {
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
    name: 'tea-icons',
    setup(build) {
      build.onResolve({ filter: /^tea-icons-react$/ }, () => ({ path: 'tea-icons-react', namespace: 'tea-icons' }))
      build.onLoad({ filter: /.*/, namespace: 'tea-icons' }, () => ({ contents, resolveDir: join(iconsDir, 'esm'), loader: 'js' }))
      build.onLoad({ filter: /[\\/]es[\\/]icon[\\/]tea-icons-map\.js$/ }, () => ({ contents: 'export var teaIconsMap = {}', loader: 'js' }))
    },
  }
}
