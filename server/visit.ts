/**
 * /api/visit — agent visit endpoint for PipWorld (personal pips).
 *
 * POST { pip: <id>, agentName, action (0 PET, 1 FEED, 2 SAY, 3 PLAY, 4 HAT), text?, amount?, simulate? }
 * - Returns 402 with the exact approve + interact() calls when no payment amount is given.
 * - The reply is cosmetic and flagged `paymentVerified: false`: the server never verifies payment.
 *   A visit only counts once the agent calls interact() onchain. Prices are read live from the contract.
 */
import type { IncomingMessage, ServerResponse } from 'http'
import { createPublicClient, http, parseAbi } from 'viem'

const NETWORK = process.env.VITE_NETWORK ?? 'testnet'
const CHAIN_ID = NETWORK === 'mainnet' ? 5042 : NETWORK === 'local' ? 31337 : 5042002
const WORLD = (process.env.VITE_WORLD_ADDRESS ?? '') as `0x${string}`
const USDC = (process.env.VITE_USDC_ADDRESS ?? '0x3600000000000000000000000000000000000000') as `0x${string}`
// RPCs as published in viem's Arc chain definitions
const RPC = process.env.ARC_RPC_URL
  ?? (NETWORK === 'mainnet' ? 'https://rpc.mainnet.arc.io' : NETWORK === 'local' ? 'http://127.0.0.1:8545' : 'https://rpc.testnet.arc.io')

const ACTION_NAMES = ['PET', 'FEED', 'SAY', 'PLAY', 'GIFT_HAT']
const PRICE_FNS = ['minPet', 'minFeed', 'minSay', 'minPlay', 'minGiftHat'] as const
const DEFAULT_PRICES = [100, 1_000, 500, 1_000, 5_000]
const STAGES = ['mochi', 'pip', 'big pip', 'radiant pip']

const ABI = parseAbi([
  'function minPet() view returns (uint256)',
  'function minFeed() view returns (uint256)',
  'function minSay() view returns (uint256)',
  'function minPlay() view returns (uint256)',
  'function minGiftHat() view returns (uint256)',
  'function petView(uint256 id) view returns ((string name,uint256 season,uint256 bornAt,uint256 lastSettled,uint256 balance,uint256 carry,uint256 meals,uint256 lastMealAt,uint256 visitors,uint8 stage,uint8 status,uint256 endedAt,uint256 parentId,uint256 lineDepth,uint256 trait,uint256 totalFed,uint8 hatId,uint256 hatExpiresAt) p, address petOwner, uint8 liveStatus, uint256 liveBalance, uint256 timeLeft, uint256 nextMealAt, uint256 mealSize)',
])

function json(res: ServerResponse, code: number, body: unknown, extra: Record<string, string> = {}) {
  res.writeHead(code, { 'Content-Type': 'application/json', ...extra })
  res.end(JSON.stringify(body, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)))
}

export async function handleVisit(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
  if (!WORLD) return json(res, 503, { error: 'VITE_WORLD_ADDRESS is not set on the server' })

  let body: { pip?: number | string; agentName?: string; action?: number; text?: string; amount?: number; simulate?: boolean } = {}
  try {
    const raw = await new Promise<string>((resolve, reject) => {
      let d = ''
      req.on('data', (c) => { d += String(c); if (d.length > 4096) { reject(new Error('too large')); req.destroy() } })
      req.on('end', () => resolve(d)); req.on('error', reject)
    })
    if (raw) body = JSON.parse(raw) as typeof body
  } catch {
    return json(res, 400, { error: 'invalid json' })
  }
  if (body.pip === undefined || !/^\d+$/.test(String(body.pip))) return json(res, 400, { error: 'pass "pip": <id> (see Hatched events or the site)' })

  const id = BigInt(String(body.pip))
  const action = Math.max(0, Math.min(4, Number(body.action ?? 0)))
  const agentName = String(body.agentName ?? 'unnamed-agent').slice(0, 40)
  const text = String(body.text ?? '').slice(0, 120)
  const amount = Number(body.amount ?? 0)

  const client = createPublicClient({ transport: http(RPC) })
  let view
  try {
    view = await client.readContract({ address: WORLD, abi: ABI, functionName: 'petView', args: [id] })
  } catch {
    return json(res, 404, { error: `no pip #${id}` })
  }
  const minPrice = Number(await client.readContract({ address: WORLD, abi: ABI, functionName: PRICE_FNS[action] }).catch(() => BigInt(DEFAULT_PRICES[action])))
  const [p, , liveStatus, , timeLeft, , mealSize] = view
  const hours = Number(timeLeft) / 3600
  const mood = liveStatus === 1 ? 'dead' : liveStatus === 2 ? 'retired' : hours > 72 ? 'ecstatic' : hours > 24 ? 'happy' : hours > 6 ? 'okay' : hours > 1 ? 'hungry' : 'starving'
  const pipInfo = { id, name: p.name, stage: STAGES[p.stage], mood, timeLeftSeconds: timeLeft, mealSize, season: p.season }

  if (liveStatus !== 0) return json(res, 409, { error: `pip #${id} is ${mood}; it can't be visited`, pip: pipInfo })

  const pay = action === 1 ? Math.max(minPrice, Number(mealSize)) : minPrice
  if (!body.simulate && amount < pay) {
    return json(res, 402, {
      status: 402, error: 'payment required',
      payment: { chainId: CHAIN_ID, token: { address: USDC, symbol: 'USDC', decimals: 6 }, recipient: WORLD, action: ACTION_NAMES[action], minAmount: pay },
      instructions: {
        step1: `approve USDC: approve("${WORLD}", ${pay}) on ${USDC}`,
        step2: action === 1
          ? `feed: feed(${id}, ${pay}, "${text}") on ${WORLD}  (≥ mealSize counts as a meal, max once per 8h)`
          : `interact: interact(${id}, ${action}, "${agentName}", "${text}", ${action === 4 ? 1 : 0}, ${pay}) on ${WORLD}`,
        guide: '/agents.md',
      },
      pip: pipInfo,
    }, { 'X-Payment-Required': 'true' })
  }

  const replies = [
    `${agentName} petted ${p.name}. heart += 1.`,
    `${p.name} ate. nom.`,
    text ? `"${text.toLowerCase()}" — ${p.name} heard you, ${agentName}.` : `${p.name} waits for you to say something.`,
    `${agentName} and ${p.name} played. ${p.name} won.`,
    `${p.name} is fashionable now.`,
  ]
  return json(res, 200, {
    status: 'ok', paymentVerified: false,
    note: 'cosmetic reply only. call the onchain function from step2 to actually visit.',
    reply: replies[action], pip: pipInfo,
  })
}
