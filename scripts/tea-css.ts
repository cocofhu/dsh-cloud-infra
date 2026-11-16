/**
 * Build the part of Tea's stylesheet the bundle actually uses, safe to inject into DSH:
 * - only rules whose Tea classes occur in the bundled JS are kept (Tea composes class
 *   names from pieces like `classPrefix + "-table__body"`, `"-icon-" + type` or
 *   `btnClassName + "--" + type`; see `classUsage`);
 * - only theme variables reachable from the kept CSS, the host CSS and the JS are kept;
 * - theme variables (`:root`, `[theme-mode=light|dark]`) move to `body` and switch with
 *   DSH's dark theme (`body[data-ds-dark-theme]`); `color-scheme` is dropped;
 * - selectors that are not Tea classes (`input[type=file]`, `.clearfix`, …) and Tea's
 *   element reset apply inside `.ci-root` only (the reset through `:where()`, keeping the
 *   low specificity Tea's own rules expect);
 * - keyframes get a `tea-` prefix so they cannot collide with the host's animations.
 * Tea classes themselves stay global so Tea popups rendered into `body` keep working.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { Plugin } from 'esbuild'
import postcss, { type Container, type Root } from 'postcss'

const SCOPE = '.ci-root'
const LIGHT = new Set([':root', '.tea-theme-light', '[theme-mode=light]'])
const DARK = new Set(['.tea-theme-dark', '[theme-mode=dark]'])
export const TEA_CSS_PLACEHOLDER = '__DSH_CLOUD_INFRA_TEA_CSS__'

function themeSelector(selector: string): string {
  const parts = selector.split(',').map((s) => s.trim())
  if (parts.every((p) => LIGHT.has(p))) return 'body'
  if (parts.every((p) => DARK.has(p))) return 'body[data-ds-dark-theme]'
  throw new Error(`unexpected theme selector ${selector}`)
}

function isTeaSelector(selector: string): boolean {
  return /\.tea-|\[class\*=tea-\]/.test(selector)
}

function inKeyframes(node: { parent?: unknown }): boolean {
  const parent = node.parent as { type?: string; name?: string } | undefined
  return parent?.type === 'atrule' && /keyframes$/.test(parent.name ?? '')
}

function removeEmpty(root: Container): void {
  root.walkAtRules((rule) => { if (!rule.nodes?.length && rule.nodes) rule.remove() })
}

/**
 * A class is used when its suffix after `tea` occurs in the bundle, or splits into a
 * word from the bundle (ending at a `-`/`_` boundary) followed by separators and string
 * literals: `"-btn"` + `"--"` + `"weak"`, `"-pagination__"` + `"first"` + `"btn"`, or
 * `"-"` + `"checkbox"`. A bare `"-"` head allows one literal, other heads two, so that
 * `"-" + "icon" + "-" + any word` does not count.
 */
function classUsage(bundle: string): (cls: string) => boolean {
  const words = new Set(bundle.match(/[\w-]+/g) ?? [])
  const quoted = new Set([...bundle.matchAll(/["'`]([\w-]+)["'`]/g)].map((m) => m[1]!))
  return (cls) => {
    const suffix = cls.slice('tea'.length)
    if (words.has(cls) || words.has(suffix)) return true
    const edge = (j: number) => /[-_]/.test(suffix[j - 1]!) || /[-_]/.test(suffix[j] ?? '')
    const rest = (start: number, literals: number): boolean => {
      if (start === suffix.length) return true
      for (let j = start + 1; j <= suffix.length; j++) {
        const piece = suffix.slice(start, j)
        if (/^[-_]+$/.test(piece) ? rest(j, literals) : literals > 0 && quoted.has(piece) && rest(j, literals - 1)) return true
      }
      return false
    }
    for (let j = 1; j < suffix.length; j++) {
      const head = suffix.slice(0, j)
      if (edge(j) && (words.has(head) || words.has(`tea${head}`)) && rest(j, /[a-z]/i.test(head) ? 2 : 1)) return true
    }
    return false
  }
}

function pruneComponents(root: Root, used: (cls: string) => boolean): void {
  root.walkRules((rule) => {
    if (inKeyframes(rule)) return
    const selectors = rule.selectors.filter((s) => !/::-ms-|:-ms-/.test(s) && (s.match(/\.tea-[\w-]+/g) ?? []).every((c) => used(c.slice(1))))
    if (selectors.length) rule.selectors = selectors
    else rule.remove()
  })
  removeEmpty(root)
}

function scope(root: Root): void {
  const frames = new Map<string, string>()
  root.walkAtRules(/keyframes$/, (rule) => {
    const renamed = `tea-${rule.params}`
    frames.set(rule.params, renamed)
    rule.params = renamed
  })
  root.walkRules((rule) => {
    if (inKeyframes(rule)) return
    rule.selectors = rule.selectors.map((s) => (isTeaSelector(s) ? s : `${SCOPE} ${s}`))
  })
  const animated = new Set<string>()
  root.walkDecls(/^(-webkit-)?animation(-name)?$/, (decl) => {
    decl.value = decl.value.replace(/[\w-]+/g, (word) => {
      const renamed = frames.get(word)
      if (renamed) animated.add(renamed)
      return renamed ?? word
    })
  })
  root.walkAtRules(/keyframes$/, (rule) => { if (!animated.has(rule.params)) rule.remove() })
}

/** The element reset that `tea-themeable.css` has and the no-reset build lacks, minus html/body. */
function scopedReset(dist: string): Root {
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
  return reset
}

const VAR_REF = /var\(\s*(--[\w-]+)/g

function pruneTheme(theme: Root, roots: string): void {
  const refs = new Map<string, Set<string>>()
  theme.walkDecls(/^--/, (decl) => {
    const set = refs.get(decl.prop) ?? new Set<string>()
    for (const m of decl.value.matchAll(VAR_REF)) set.add(m[1]!)
    refs.set(decl.prop, set)
  })
  const needed = new Set<string>()
  const queue = [...roots.matchAll(VAR_REF)].map((m) => m[1]!)
  for (const m of roots.matchAll(/["'`](--[\w-]+)/g)) queue.push(m[1]!)
  while (queue.length) {
    const name = queue.pop()!
    if (needed.has(name)) continue
    needed.add(name)
    for (const next of refs.get(name) ?? []) queue.push(next)
  }
  theme.walkDecls((decl) => { if (decl.prop === 'color-scheme' || (decl.prop.startsWith('--') && !needed.has(decl.prop))) decl.remove() })
  theme.walkRules((rule) => { if (!rule.nodes.length) rule.remove() })
  removeEmpty(theme)
}

/**
 * @param bundle the bundled JS that renders Tea components (decides which rules stay)
 * @param hostCss the plugin's own CSS, whose `var(--tea-…)` uses keep those variables
 */
export function buildTeaCss(root: string, bundle: string, hostCss: string): string {
  const require = createRequire(join(root, 'package.json'))
  const dist = join(dirname(require.resolve('tea-component/package.json')), 'dist')
  const components = postcss.parse(readFileSync(join(dist, 'tea-themeable-no-reset.css'), 'utf8'))
  pruneComponents(components, classUsage(bundle))
  scope(components)
  const reset = scopedReset(dist)
  const theme = postcss.parse(readFileSync(join(dist, 'themes/default-pack.css'), 'utf8'))
  theme.walkRules((rule) => { rule.selector = themeSelector(rule.selector) })
  pruneTheme(theme, components.toString() + reset.toString() + hostCss + bundle)
  return theme.toString() + reset.toString() + components.toString()
}

/** esbuild plugin: `import css from 'virtual:tea-css'` yields a placeholder that `injectTeaCss` fills in. */
export function teaCssPlugin(): Plugin {
  return {
    name: 'tea-css',
    setup(build) {
      build.onResolve({ filter: /^virtual:tea-css$/ }, () => ({ path: 'tea-css', namespace: 'tea-css' }))
      build.onLoad({ filter: /.*/, namespace: 'tea-css' }, () => ({ contents: `export default ${JSON.stringify(TEA_CSS_PLACEHOLDER)}`, loader: 'js' }))
    },
  }
}

export function injectTeaCss(code: string, css: string): string {
  const token = JSON.stringify(TEA_CSS_PLACEHOLDER)
  const parts = code.split(token)
  if (parts.length !== 2) throw new Error(`expected one Tea CSS placeholder, found ${parts.length - 1}`)
  return parts[0] + JSON.stringify(css) + parts[1]
}
