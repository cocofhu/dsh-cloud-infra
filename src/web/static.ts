import { readFile, stat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const DESIGN_PATH = '/cloud-infra/design'
export const DESIGN_DIR = fileURLToPath(new URL('../design-page/', import.meta.url))

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
}

/** Serve a built static directory under `mount`; `/mount` redirects to `/mount/` so relative asset URLs resolve. */
export function createStaticHandler(mount: string, root: string) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD' }).end()
      return
    }
    const url = new URL(req.url ?? '/', 'http://local')
    if (url.pathname === mount) {
      res.writeHead(301, { location: `${mount.slice(mount.lastIndexOf('/') + 1)}/${url.search}` }).end()
      return
    }
    let rel: string
    try {
      rel = decodeURIComponent(url.pathname.slice(mount.length + 1)) || 'index.html'
    } catch {
      res.writeHead(400).end()
      return
    }
    const file = normalize(join(root, rel))
    if (!file.startsWith(root.endsWith(sep) ? root : root + sep)) {
      res.writeHead(403).end()
      return
    }
    try {
      if (!(await stat(file)).isFile()) throw new Error('not a file')
      const body = await readFile(file)
      res.writeHead(200, {
        'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
        'cache-control': rel.startsWith('chunks/') ? 'public, max-age=31536000, immutable' : 'no-cache',
        'x-content-type-options': 'nosniff',
      })
      res.end(req.method === 'HEAD' ? undefined : body)
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found (run `npm run build:client` to build the design page)\n')
    }
  }
}
