/** Serve the built design page standalone: `npm run design`, then open http://127.0.0.1:5180/cloud-infra/design/ */
import { createServer } from 'node:http'

/** DESIGN_DIR resolves next to the module, so load the built copy in lib/ (typed by its source). */
const { createStaticHandler, DESIGN_DIR, DESIGN_PATH } = (await import(new URL('../lib/web/static.js', import.meta.url).href)) as typeof import('../src/web/static.ts')

const port = Number(process.env.PORT || 5180)
const host = process.env.HOST || '127.0.0.1'
const handler = createStaticHandler(DESIGN_PATH, DESIGN_DIR)

createServer((req, res) => {
  const path = new URL(req.url ?? '/', 'http://local').pathname
  if (path === '/') return void res.writeHead(302, { location: `${DESIGN_PATH}/` }).end()
  if (path === DESIGN_PATH || path.startsWith(`${DESIGN_PATH}/`)) return void handler(req, res)
  res.writeHead(404).end()
}).listen(port, host, () => console.log(`design page: http://${host}:${port}${DESIGN_PATH}/`))
