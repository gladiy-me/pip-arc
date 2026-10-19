// Vercel serverless wrapper for pip's yard /api/visit (same handler as server/index.ts)
import type { IncomingMessage, ServerResponse } from 'http'
import { handleVisit } from '../server/visit.js'

export const config = { api: { bodyParser: false } }

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }
  await handleVisit(req, res)
}
