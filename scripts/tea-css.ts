/**
 * Build Tea's stylesheet for use inside DSH without touching the host page:
 * - theme variables (`:root`, `[theme-mode=light|dark]`) move to `body` and switch
 *   with DSH's dark theme (`body[data-ds-dark-theme]`); `color-scheme` is dropped;
 * - the few selectors that are not Tea classes (`input[type=file]`, `.clearfix`, …)
 *   are scoped under `.ci-root`;
 * - Tea's element reset (margins, list styles, …) applies inside `.ci-root` only, with
 *   `:where()` so it keeps the low specificity Tea's own rules expect;
 * - keyframes get a `tea-` prefix so they cannot collide with the host's animations.
 * - rules for components the plugin never renders are dropped (~100KB).
 * Tea classes themselves stay global so Tea popups rendered into `body` keep working.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { Plugin } from 'esbuild'
import postcss, { type Root } from 'postcss'

const SCOPE = '.ci-root'
const LIGHT = new Set([':root', '.tea-theme-light', '[theme-mode=light]'])
const DARK = new Set(['.tea-theme-dark', '[theme-mode=dark]'])
const UNUSED = new RegExp(`\\.tea-(${[
  'accordion', 'breadcrumb', 'calendar', 'cascader', 'datepicker', 'datetimepicker', 'dialog', 'drawer', 'flag',
  'guide', 'inputnum', 'layout', 'menu', 'monaco', 'nav', 'notification', 'progress', 'rate', 'region',
  'regionempty', 'segment', 'sidebar', 'slider', 'step', 'switch', 'timeline', 'timepicker', 'toast',
  'transfer', 'tree', 'upload',
].join('|')})(?![a-z])`)

function themeSelector(selector: string): string {
  const parts = selector.split(',').map((s) => s.trim())
  if (parts.every((p) => LIGHT.has(p))) return 'body'
  if (parts.every((p) => DARK.has(p))) return 'body[data-ds-dark-theme]'
  throw new Error(`unexpected theme selector ${selector}`)
}

function isTeaSelector(selector: string): boolean {
  return /\.tea-|\[class\*=tea-\]/.test(selector)
}

function scope(root: Root): void {
  const frames = new Map<string, string>()
  root.walkAtRules(/keyframes$/, (rule) => {
    const renamed = `tea-${rule.params}`
    frames.set(rule.params, renamed)
    rule.params = renamed
  })
  root.walkRules((rule) => {
    const parent = rule.parent
    if (parent?.type === 'atrule' && /keyframes$/.test((parent as { name: string }).name)) return
    const selectors = rule.selectors.filter((s) => !/::-ms-|:-ms-/.test(s) && !UNUSED.test(s))
    if (!selectors.length) { rule.remove(); return }
    rule.selectors = selectors.map((s) => (isTeaSelector(s) ? s : `${SCOPE} ${s}`))
  })
  root.walkDecls(/^(-webkit-)?animation(-name)?$/, (decl) => {
    decl.value = decl.value.replace(/[\w-]+/g, (word) => frames.get(word) ?? word)
  })
}

/** The element reset that `tea-themeable.css` has and the no-reset build lacks, minus html/body. */
function scopedReset(dist: string): string {
  const full = postcss.parse(readFileSync(join(dist, 'tea-themeable.css'), 'utf8'))
  const reset = postcss.root()
  for (const node of full.nodes) {
    if (node.type !== 'rule') continue
    if (isTeaSelector(node.selector)) {
      if (/^\.tea-text\{?/.test(node.selector)) break
      continue
    }
    const selectors = node.selectors.filter((s) => !/^(html|body)\b|:root/.test(s))
    if (!selectors.length) continue
    const rule = node.clone()
    rule.selectors = selectors.map((s) => `:where(${SCOPE}) ${s}`)
    reset.append(rule)
  }
  return reset.toString()
}

export function buildTeaCss(root: string): string {
  const require = createRequire(join(root, 'package.json'))
  const dist = join(dirname(require.resolve('tea-component/package.json')), 'dist')
  const theme = postcss.parse(readFileSync(join(dist, 'themes/default-pack.css'), 'utf8'))
  theme.walkRules((rule) => { rule.selector = themeSelector(rule.selector) })
  theme.walkDecls('color-scheme', (decl) => { decl.remove() })
  const components = postcss.parse(readFileSync(join(dist, 'tea-themeable-no-reset.css'), 'utf8'))
  scope(components)
  return theme.toString() + scopedReset(dist) + components.toString()
}

/** esbuild plugin serving the built stylesheet as `import css from 'virtual:tea-css'`. */
export function teaCssPlugin(root: string): Plugin {
  let css: string | undefined
  return {
    name: 'tea-css',
    setup(build) {
      build.onResolve({ filter: /^virtual:tea-css$/ }, () => ({ path: 'tea-css', namespace: 'tea-css' }))
      build.onLoad({ filter: /.*/, namespace: 'tea-css' }, () => {
        css ??= buildTeaCss(root)
        return { contents: `export default ${JSON.stringify(css)}`, loader: 'js' }
      })
    },
  }
}
