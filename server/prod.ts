/**
 * Production server for HF Spaces / Docker.
 * Serves the Vite build output (dist/) as static files and
 * the /visit and /health API routes on the same port ($PORT).
 */
import { createServer } from 'http'
import { createReadStream, statSync, existsSync } from 'fs'
import { join, extname } from 'path'
import { fileURLToPath } from 'url'
import { handleVisit } from './visit.js'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const DIST = join(__dirname, '..', 'dist')
const PORT = Number(process.env.PORT ?? 7860)

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
}

function serveStatic(res: import('http').ServerResponse, filePath: string) {
  const ext = extname(filePath).toLowerCase()
  const mime = MIME[ext] ?? 'application/octet-stream'
  res.writeHead(200, { 'Content-Type': mime })
  createReadStream(filePath).pipe(res)
}

const server = createServer(async (req, res) => {
  const url = (req.url ?? '/').split('?')[0]

  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  // API routes
  if (url === '/visit' || url === '/visit/') {
    await handleVisit(req, res)
    return
  }
  if (url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, service: "pip's yard api" }))
    return
  }

  // Static file serving (SPA fallback to index.html)
  let filePath = join(DIST, url === '/' ? 'index.html' : url)
  if (existsSync(filePath) && statSync(filePath).isFile()) {
    serveStatic(res, filePath)
    return
  }
  // SPA fallback
  const indexPath = join(DIST, 'index.html')
  if (existsSync(indexPath)) {
    serveStatic(res, indexPath)
    return
  }
  res.writeHead(404)
  res.end('Not found')
})

server.listen(PORT, () => {
  console.log(`pip.exe serving on port ${PORT}`)
})
