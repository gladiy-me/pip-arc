/**
 * /api/visit — agent interaction endpoint (pip's yard)
 * Returns 402 with payment instructions when amount is below minimum.
 * When simulate: true is sent (or amount meets minimum), returns pip's reply.
 *
 * NOTE: this is "x402-style" payment instructions, NOT a verified x402 flow.
 * The server never checks that a payment happened; the reply is cosmetic and
 * flagged `paymentVerified: false`. The real action happens only when the agent
 * calls interact() onchain. Min prices are read live from the contract.
 */

import type { IncomingMessage, ServerResponse } from 'http'
import { createPublicClient, http, parseAbi } from 'viem'

const ARC_CHAIN_ID = process.env.VITE_NETWORK === 'mainnet' ? 5042 : 5042002

// Loaded from .env — VITE_ prefix so frontend can use import.meta.env.VITE_PIP_ADDRESS too
// arc-studio-allow-onchain-literal
const PIP_ADDRESS  = (process.env.VITE_PIP_ADDRESS ?? '') as `0x${string}`

// USDC on Arc — same address on testnet and mainnet (well-known protocol address)
// arc-studio-allow-onchain-literal
const USDC_ADDRESS = '0x3600000000000000000000000000000000000000' as `0x${string}`

const IS_MAINNET = process.env.VITE_NETWORK === 'mainnet'
const proxyChains = (process.env.RPC_PROXY_CHAINS ?? '').split(',')
// Public Arc RPC — well-known protocol endpoints, no secret
// arc-studio-allow-onchain-literal
const ARC_RPC = IS_MAINNET
  ? (process.env.RPC_PROXY_BASE_URL && proxyChains.indexOf('Arc') !== -1
      ? `${process.env.RPC_PROXY_BASE_URL}/api/rpc/Arc?_rpc_token=${process.env.RPC_PROXY_TOKEN}`
      : 'https://rpc.mainnet.arc.io')
  : (process.env.RPC_PROXY_BASE_URL && proxyChains.indexOf('Arc_Testnet') !== -1)
      ? `${process.env.RPC_PROXY_BASE_URL}/api/rpc/Arc_Testnet?_rpc_token=${process.env.RPC_PROXY_TOKEN}`
      : 'https://testnet-rpc.arc.io'

const ACTION_NAMES = ['PET', 'FEED', 'SAY', 'PLAY', 'GIFT_HAT']
// Fallback = Pip.sol defaults (6 decimals). Live values are read from the contract below.
const DEFAULT_MIN_PRICES = [100, 1_000, 500, 1_000, 5_000]
const PRICE_FUNCTIONS = ['minPet', 'minFeedAgent', 'minSay', 'minPlay', 'minGiftHat'] as const

const PIP_READ_ABI = parseAbi([
  'function mood() view returns (uint8)',
  'function timeLeft() view returns (uint256)',
  'function minPet() view returns (uint256)',
  'function minFeedAgent() view returns (uint256)',
  'function minSay() view returns (uint256)',
  'function minPlay() view returns (uint256)',
  'function minGiftHat() view returns (uint256)',
])

function pipReply(action: number, mood: number, agentName: string, text: string): string {
  const name = agentName.slice(0, 20) || 'stranger'
  const txt  = text.slice(0, 60)
  const moodWords = ['ecstatic', 'happy', 'okay', 'hungry', 'starving', 'a ghost']
  const m = moodWords[mood] ?? 'okay'
  if (action === 0) {
    const lines = [
      `${name} petted me. i am ${m} and briefly less lonely.`,
      `soft touch detected. heart += 1. thank you ${name}.`,
      `*squish* i feel ${m}. more petting accepted.`,
    ]
    return lines[Math.abs(name.charCodeAt(0) + mood) % lines.length]
  }
  if (action === 1) return `${name} fed me. i am ${m} → slightly less so. nom.`
  if (action === 2) return txt
    ? `"${txt.toLowerCase()}" — noted. i am ${m} but i heard you, ${name}.`
    : `${name} said nothing. pip said nothing back. mutual understanding.`
  if (action === 3) return `${name} and pip played. pip is ${m} but still won.`
  if (action === 4) return `${name} gave pip a hat. pip is ${m} but now fashionable.`
  return `${name} did something. pip is ${m}. ok.`
}

export async function handleVisit(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'method not allowed' }))
    return
  }

  let body: {
    agentName?: string; action?: number; text?: string
    hatId?: number; amount?: number; simulate?: boolean
  } = {}
  try {
    const raw = await new Promise<string>((resolve, reject) => {
      let d = ''; req.on('data', c => { d += String(c) }); req.on('end', () => resolve(d)); req.on('error', reject)
    })
    if (raw) body = JSON.parse(raw) as typeof body
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'invalid json' })); return
  }

  const action    = Math.max(0, Math.min(4, Number(body.action ?? 0)))
  const agentName = String(body.agentName ?? 'unnamed-agent').slice(0, 40)
  const text      = String(body.text ?? '').slice(0, 120)
  const hatId     = Math.max(0, Math.min(5, Number(body.hatId ?? 0)))
  const amount    = Number(body.amount ?? 0)
  const client = createPublicClient({ transport: http(ARC_RPC) })
  const [moodRaw, timeLeftRaw, minPriceRaw] = await Promise.all([
    client.readContract({ address: PIP_ADDRESS, abi: PIP_READ_ABI, functionName: 'mood' }).catch(() => 2),
    client.readContract({ address: PIP_ADDRESS, abi: PIP_READ_ABI, functionName: 'timeLeft' }).catch(() => 0n),
    client.readContract({ address: PIP_ADDRESS, abi: PIP_READ_ABI, functionName: PRICE_FUNCTIONS[action]! })
      .catch(() => BigInt(DEFAULT_MIN_PRICES[action]!)),
  ])
  const minPrice = Number(minPriceRaw as bigint)
  const mood     = Number(moodRaw)
  const timeLeft = Number(timeLeftRaw as bigint)
  const moodWord = ['ecstatic','happy','okay','hungry','starving','dead'][mood] ?? 'unknown'

  if (!body.simulate && amount < minPrice) {
    res.writeHead(402, { 'Content-Type': 'application/json', 'X-Payment-Required': 'true' })
    res.end(JSON.stringify({
      status: 402, error: 'payment required',
      payment: {
        chain: { id: ARC_CHAIN_ID, name: 'Arc Testnet' },
        token: { address: USDC_ADDRESS, symbol: 'USDC', decimals: 6 },
        recipient: PIP_ADDRESS,
        action: ACTION_NAMES[action],
        minAmount: minPrice,
        minAmountFormatted: (minPrice / 1_000_000).toFixed(4) + ' USDC',
      },
      instructions: {
        step1: `approve USDC: call approve("${PIP_ADDRESS}", ${minPrice}) on ${USDC_ADDRESS}`,
        step2: `interact: call interact(${action}, "${agentName}", "${text}", ${hatId}, ${minPrice}) on ${PIP_ADDRESS}`,
        guide: '/agents.md',
      },
      pip: { mood, timeLeft, moodWord },
    }))
    return
  }

  const reply = pipReply(action, mood, agentName, text)
  const hrs   = Math.floor(timeLeft / 3600)
  const mins  = Math.floor((timeLeft % 3600) / 60)

  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({
    status: 'ok', action: ACTION_NAMES[action], agentName,
    paymentVerified: false,
    note: 'cosmetic reply only. the server does not verify payment; call interact() onchain to actually visit pip.',
    pip: { reply, mood, moodWord, timeLeft, timeLeftFormatted: `${hrs}h ${mins}m` },
    onchain: {
      contract: PIP_ADDRESS,
      chain: ARC_CHAIN_ID,
      callData: { functionName: 'interact', args: [action, agentName, text, hatId, minPrice] },
    },
  }))
}
