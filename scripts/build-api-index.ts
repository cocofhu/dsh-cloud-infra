/**
 * Build the Tencent Cloud API index from the full SDK's type declarations.
 *
 *   lib/api-index/tencent/catalog.json   every service and action, each with the newest version that has it, for search
 *   lib/api-index/tencent/<service>.json input structures of every version, loaded on demand
 *   lib/api-index/tencent/en/<service>.json English action summaries and top-level parameter docs,
 *                                         from the international SDK, for English UI text
 *
 * Usage: node scripts/build-api-index.ts [outDir]
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const SDK_ROOT = dirname(require.resolve('tencentcloud-sdk-nodejs/package.json'))
const SERVICES_DIR = join(SDK_ROOT, 'tencentcloud', 'services')
const INTL_ROOT = join(dirname(require.resolve('tencentcloud-sdk-nodejs-intl-en/package.json')), 'tencentcloud')
const OUT_DIR = process.argv[2] ?? join(import.meta.dirname, '..', 'lib', 'api-index', 'tencent')

/** Filter fields list every filter name in their doc, so they need room. */
const FIELD_DOC_MAX = 1200
const ACTION_DOC_MAX = 600
const SUMMARY_MAX = 90
const EN_FIELD_DOC_MAX = 400

/** [name, type, required (1|0), doc] */
type Field = [string, string, number, string]
interface TypeDef { doc?: string; fields: Field[] }
interface ActionDef { doc: string; input: string | null; output: string | null }
interface VersionIndex { actions: Record<string, ActionDef>; types: Record<string, TypeDef> }

function cleanDoc(raw: string | undefined, max: number): string {
  if (!raw) return ''
  let text = raw
    .replace(/注意：此字段可能返回 null，表示取不到有效值。?/g, '')
    .replace(/<li>/gi, ' • ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/?[a-z][^>]*>/gi, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/\[([^\]]+)\]\((?:[^()]|\([^()]*\))*\)/g, '$1')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (text.length > max) text = `${text.slice(0, max - 1)}…`
  return text
}

/** First sentence of an action doc, without the "本接口(Xxx)用于" boilerplate. */
function summarize(doc: string): string {
  let text = doc.replace(/^本接口\s*[（(][^)）]*[)）]\s*/, '').replace(/^用于/, '')
  const end = text.search(/[。；;]/)
  if (end > 0) text = text.slice(0, end)
  return text.length > SUMMARY_MAX ? `${text.slice(0, SUMMARY_MAX - 1)}…` : text
}

/** "This API is used to apply for a free certificate." -> "Apply for a free certificate". */
function summarizeEn(doc: string): string {
  let text = doc.replace(/^This (?:API|interface)(?:\s*\([^)]*\))? (?:is used to|is used for|can be used to|is to|allows you to|is designed to)\s*/i, '')
  const end = text.search(/\.(?:\s|$)/)
  if (end > 0) text = text.slice(0, end)
  text = text.charAt(0).toUpperCase() + text.slice(1)
  return text.length > SUMMARY_MAX ? `${text.slice(0, SUMMARY_MAX - 1)}…` : text
}

function jsDocOf(node: ts.Node): string | undefined {
  const docs = (node as { jsDoc?: ts.JSDoc[] }).jsDoc
  const doc = docs?.[docs.length - 1]
  return doc ? ts.getTextOfJSDocComment(doc.comment) : undefined
}

function typeText(node: ts.TypeNode | undefined, sf: ts.SourceFile): string {
  if (!node) return 'any'
  if (ts.isArrayTypeNode(node)) return `${typeText(node.elementType, sf)}[]`
  if (ts.isTypeReferenceNode(node)) {
    const name = node.typeName.getText(sf)
    if (name === 'Array' && node.typeArguments?.length === 1) return `${typeText(node.typeArguments[0], sf)}[]`
    return name
  }
  return node.getText(sf).replace(/\s+/g, ' ')
}

function referencedTypes(type: string): string[] {
  return [...type.matchAll(/[A-Z][A-Za-z0-9_]*/g)].map((m) => m[0])
}

function parseModels(file: string): Map<string, TypeDef | null> {
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  const types = new Map<string, TypeDef | null>()
  for (const stmt of sf.statements) {
    if (ts.isInterfaceDeclaration(stmt)) {
      const fields: Field[] = []
      for (const member of stmt.members) {
        if (!ts.isPropertySignature(member) || !member.name) continue
        fields.push([
          member.name.getText(sf).replace(/^["']|["']$/g, ''),
          typeText(member.type, sf),
          member.questionToken ? 0 : 1,
          cleanDoc(jsDocOf(member), FIELD_DOC_MAX),
        ])
      }
      const doc = cleanDoc(jsDocOf(stmt), FIELD_DOC_MAX)
      types.set(stmt.name.text, doc ? { doc, fields } : { fields })
    } else if (ts.isTypeAliasDeclaration(stmt)) {
      // `export type XxxRequest = null` marks an action without parameters.
      types.set(stmt.name.text, stmt.type.kind === ts.SyntaxKind.LiteralType || stmt.type.kind === ts.SyntaxKind.NullKeyword ? null : { fields: [] })
    }
  }
  return types
}

function parseClient(file: string): { action: string; doc: string; input?: string; output?: string }[] {
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  const out: { action: string; doc: string; input?: string; output?: string }[] = []
  for (const stmt of sf.statements) {
    if (!ts.isClassDeclaration(stmt)) continue
    for (const member of stmt.members) {
      if (!ts.isMethodDeclaration(member) || !member.name) continue
      const action = member.name.getText(sf)
      if (!/^[A-Z]/.test(action)) continue
      const input = member.parameters[0]?.type
      const ret = member.type && ts.isTypeReferenceNode(member.type) ? member.type.typeArguments?.[0] : undefined
      out.push({
        action,
        doc: cleanDoc(jsDocOf(member), ACTION_DOC_MAX),
        input: input ? typeText(input, sf) : undefined,
        output: ret ? typeText(ret, sf) : undefined,
      })
    }
  }
  return out
}

/** Keep only the types reachable from request structures, plus each response's top level. */
function buildVersion(dir: string, service: string): VersionIndex | undefined {
  const clientFile = join(dir, `${service}_client.d.ts`)
  const modelsFile = join(dir, `${service}_models.d.ts`)
  if (!existsSync(clientFile) || !existsSync(modelsFile)) return undefined
  const models = parseModels(modelsFile)
  const actions: Record<string, ActionDef> = {}
  const types: Record<string, TypeDef> = {}
  const queue: string[] = []
  const include = (name: string) => {
    if (types[name] || !models.has(name)) return
    const def = models.get(name)
    if (!def) return
    types[name] = def
    queue.push(name)
  }
  for (const { action, doc, input, output } of parseClient(clientFile)) {
    const inputDef = input ? models.get(input) : undefined
    actions[action] = { doc, input: inputDef ? input! : null, output: output && models.get(output) ? output : null }
    if (inputDef) include(input!)
    if (output && models.get(output)) {
      const res = models.get(output)!
      types[output] = { fields: res.fields.filter((f) => f[0] !== 'RequestId').map(([n, t, r, d]) => [n, t, r, cleanDoc(d, 120)]) }
    }
  }
  while (queue.length) {
    const name = queue.shift()!
    for (const field of types[name]!.fields) for (const ref of referencedTypes(field[1])) include(ref)
  }
  return { actions, types }
}

interface EnAction { summary: string; params: Record<string, string> }

function commentText(raw: string): string {
  return raw.split('\n').map((l) => l.replace(/^\s*\*\s?/, '')).filter((l) => !/^@/.test(l.trim())).join('\n')
}

/** The international SDK ships plain JS; its docs live in JSDoc comments. */
function buildEnVersion(dir: string, service: string): Record<string, EnAction> {
  const clientFile = join(dir, `${service}_client.js`)
  const modelsFile = join(dir, 'models.js')
  if (!existsSync(clientFile) || !existsSync(modelsFile)) return {}
  const models = readFileSync(modelsFile, 'utf8')
  const fields = new Map<string, Record<string, string>>()
  for (const m of models.matchAll(/^class (\w+) extends\s+AbstractModel \{([\s\S]*?)^    deserialize\(/gm)) {
    const docs: Record<string, string> = {}
    for (const f of m[2]!.matchAll(/\/\*\*([\s\S]*?)\*\/\s*this\.(\w+) = null;/g)) {
      const doc = cleanDoc(commentText(f[1]!), EN_FIELD_DOC_MAX)
      if (doc) docs[f[2]!] = doc
    }
    fields.set(m[1]!, docs)
  }
  const out: Record<string, EnAction> = {}
  for (const m of readFileSync(clientFile, 'utf8').matchAll(/\/\*\*([\s\S]*?)\*\/\s*([A-Z]\w*)\(req, cb\)/g)) {
    const input = /@param \{(\w+)\} req/.exec(m[1]!)?.[1]
    out[m[2]!] = { summary: summarizeEn(cleanDoc(commentText(m[1]!), ACTION_DOC_MAX)), params: (input && fields.get(input)) || {} }
  }
  return out
}

/** Newest version wins per action. */
function buildEnService(service: string): Record<string, EnAction> {
  const root = join(INTL_ROOT, service)
  if (!existsSync(root)) return {}
  const out: Record<string, EnAction> = {}
  for (const dirName of readdirSync(root).filter((d) => versionOf(d)).sort().reverse()) {
    for (const [action, def] of Object.entries(buildEnVersion(join(root, dirName), service))) out[action] ??= def
  }
  return out
}

function versionOf(dirName: string): string | undefined {
  const m = /^v(\d{4})(\d{2})(\d{2})$/.exec(dirName)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : undefined
}

function main(): void {
  const sdkVersion = (JSON.parse(readFileSync(join(SDK_ROOT, 'package.json'), 'utf8')) as { version: string }).version
  rmSync(OUT_DIR, { recursive: true, force: true })
  mkdirSync(join(OUT_DIR, 'en'), { recursive: true })
  let enActions = 0
  let enBytes = 0
  const services: Record<string, { latest: string; versions: string[] }> = {}
  const actions: ([string, string, string] | [string, string, string, string])[] = []
  let totalBytes = 0
  for (const service of readdirSync(SERVICES_DIR).sort()) {
    if (!/^[a-z][a-z0-9]*$/.test(service)) continue
    const versions: Record<string, VersionIndex> = {}
    for (const dirName of readdirSync(join(SERVICES_DIR, service))) {
      const version = versionOf(dirName)
      if (!version) continue
      const built = buildVersion(join(SERVICES_DIR, service, dirName), service)
      if (built && Object.keys(built.actions).length) versions[version] = built
    }
    const sorted = Object.keys(versions).sort().reverse()
    if (!sorted.length) continue
    const latest = sorted[0]!
    services[service] = { latest, versions: sorted }
    const listed = new Set<string>()
    for (const version of sorted) {
      for (const [action, def] of Object.entries(versions[version]!.actions)) {
        if (listed.has(action)) continue
        listed.add(action)
        actions.push(version === latest ? [service, action, summarize(def.doc)] : [service, action, summarize(def.doc), version])
      }
    }
    const body = JSON.stringify({ service, versions })
    totalBytes += body.length
    writeFileSync(join(OUT_DIR, `${service}.json`), body)
    const en = buildEnService(service)
    if (Object.keys(en).length) {
      const enBody = JSON.stringify({ service, actions: en })
      enActions += Object.keys(en).length
      enBytes += enBody.length
      writeFileSync(join(OUT_DIR, 'en', `${service}.json`), enBody)
    }
  }
  const catalog = JSON.stringify({ provider: 'tencent', sdkVersion, services, actions })
  writeFileSync(join(OUT_DIR, 'catalog.json'), catalog)
  console.log(`api-index: ${Object.keys(services).length} services, ${actions.length} actions; catalog ${(catalog.length / 1024).toFixed(0)}KB, services ${(totalBytes / 1024 / 1024).toFixed(1)}MB (SDK ${sdkVersion}); English docs for ${enActions} actions, ${(enBytes / 1024 / 1024).toFixed(1)}MB`)
}

if (import.meta.url === `file://${process.argv[1]}`) main()
