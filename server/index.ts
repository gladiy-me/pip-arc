/**
 * pip's yard API server — runs on port 3131 alongside Vite
 */
import { createServer } from 'http'
import { handleVisit } from './visit.js'

const PORT = 3131

const server = createServer(async (req, res) => {
  const url = req.url ?? '/'
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  if (url === '/visit' || url === '/visit/') {
    await handleVisit(req, res)
  } else if (url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, service: "pip's yard api" }))
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'not found' }))
  }
})

server.listen(PORT, () => {
  console.log(`pip api server running on port ${PORT}`)
})
