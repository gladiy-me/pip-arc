/**
 * PipWorld contract config. Addresses come from env so the same build works on
 * Arc testnet, Arc mainnet and a local anvil chain:
 *   VITE_NETWORK=testnet|mainnet|local
 *   VITE_WORLD_ADDRESS=0x...   (PipWorld)
 *   VITE_USDC_ADDRESS=0x...    (optional; defaults to Arc's USDC 0x3600…)
 */
import type { Abi } from 'viem'
import worldArtifact from '../../contracts/out/PipWorld.sol/PipWorld.json'
import vaultArtifact from '../../contracts/out/PipWorldVault.sol/PipWorldVault.json'

export const NETWORK = (import.meta.env.VITE_NETWORK ?? 'testnet') as 'testnet' | 'mainnet' | 'local'
export const CHAIN_ID = NETWORK === 'mainnet' ? 5042 : NETWORK === 'local' ? 31337 : 5042002
export const CHAIN_LABEL = NETWORK === 'mainnet' ? 'Arc · 5042' : NETWORK === 'local' ? 'local · 31337' : 'Arc Testnet · 5042002'

export const WORLD_ADDRESS = (import.meta.env.VITE_WORLD_ADDRESS ?? '0x0000000000000000000000000000000000000000') as `0x${string}`
export const USDC_ADDRESS = (import.meta.env.VITE_USDC_ADDRESS ?? '0x3600000000000000000000000000000000000000') as `0x${string}`
export const WORLD_ABI = worldArtifact.abi as Abi
export const VAULT_ABI = vaultArtifact.abi as Abi
export const IS_CONFIGURED = WORLD_ADDRESS !== '0x0000000000000000000000000000000000000000'

export const EXPLORER = NETWORK === 'mainnet' ? 'https://explorer.arc.io' : NETWORK === 'local' ? '' : 'https://explorer.testnet.arc.io'
export const explorerAddr = (a: string) => (EXPLORER ? `${EXPLORER}/address/${a}` : '')
export const explorerTx = (h: string) => (EXPLORER ? `${EXPLORER}/tx/${h}` : '')

export const STAGE_NAMES = ['mochi', 'pip', 'big pip', 'radiant pip'] as const
export const STATUS_NAMES = ['alive', 'dead', 'retired'] as const
export const MOODS = ['ecstatic', 'happy', 'okay', 'hungry', 'starving', 'dead'] as const

/** Mirrors PipWorld.growthReq (season-0 values). Kept here only for labels; the chain is the source of truth. */
export const GROWTH = [
  { meals: 6, minAgeDays: 2, visitors: 0 },
  { meals: 18, minAgeDays: 10, visitors: 3 },
  { meals: 45, minAgeDays: 28, visitors: 8 },
] as const

export type Pet = {
  name: string
  season: bigint
  bornAt: bigint
  lastSettled: bigint
  balance: bigint
  carry: bigint
  meals: bigint
  lastMealAt: bigint
  visitors: bigint
  stage: number
  status: number
  endedAt: bigint
  parentId: bigint
  lineDepth: bigint
  trait: bigint
  totalFed: bigint
  hatId: number
  hatExpiresAt: bigint
}

export type PetView = {
  id: bigint
  pet: Pet
  owner: `0x${string}`
  liveStatus: number
  liveBalance: bigint
  timeLeft: bigint
  nextMealAt: bigint
  mealSize: bigint
}

export function moodFromSeconds(alive: boolean, timeLeft: number): 0 | 1 | 2 | 3 | 4 | 5 {
  if (!alive) return 5
  const h = timeLeft / 3600
  return h > 72 ? 0 : h > 24 ? 1 : h > 6 ? 2 : h > 1 ? 3 : 4
}

export function fmtUsdc(v: bigint | number, digits = 4): string {
  const n = typeof v === 'bigint' ? Number(v) / 1e6 : v
  if (n === 0) return '0'
  if (n >= 1) return n.toFixed(2).replace(/\.?0+$/, '')
  return n.toFixed(digits).replace(/0+$/, '').replace(/\.$/, '')
}

export function fmtDur(sec: number): string {
  if (sec <= 0) return '0m'
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60)
  if (d) return `${d}d ${h}h`
  if (h) return `${h}h ${String(m).padStart(2, '0')}m`
  return `${m}m ${String(s).padStart(2, '0')}s`
}

export const short = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '')
