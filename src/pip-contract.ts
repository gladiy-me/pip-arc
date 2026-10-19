/**
 * Pip contract config — env-gated: testnet by default, Arc mainnet when
 * VITE_NETWORK=mainnet is set. Never hardcode chain IDs or addresses elsewhere;
 * always import from this file.
 *
 * ┌─ WHERE THE CONTRACT ADDRESS IS SET ───────────────────────────────────────┐
 * │ 1. `VITE_PIP_ADDRESS=0x…` in .env (wins over everything; the same var is   │
 * │    already read by server/visit.ts), or                                    │
 * │ 2. the TESTNET_PIP_ADDRESS / MAINNET_PIP_ADDRESS constants below.          │
 * └────────────────────────────────────────────────────────────────────────────┘
 */
import type { Abi } from 'viem'
// ABI generated from contracts/Pip.sol (v2.2, after the 2026-10-19 review) with solc 0.8.28.
// Regenerate after any contract change: `forge build` then
//   jq .abi contracts/out/Pip.sol/Pip.json > src/abi/Pip.abi.json
import pipAbi from './abi/Pip.abi.json'

// --------------------------------------------------------------------------
// Network switch: set VITE_NETWORK=mainnet in .env to target Arc mainnet.
// --------------------------------------------------------------------------
export const IS_MAINNET = import.meta.env.VITE_NETWORK === 'mainnet'

// Arc Testnet: chainId 5042002  |  Arc Mainnet: chainId 5042
export const ACTIVE_CHAIN_ID = IS_MAINNET ? 5042 : 5042002
export const NETWORK_LABEL = IS_MAINNET ? 'Arc Mainnet · 5042' : 'Arc Testnet · 5042002'

// Contract addresses
// TESTNET  — 0x66a7…1a40 is the OLD (pre-review) contract; redeploy and replace (see CHANGES_REVIEW.md)
// MAINNET  — replace MAINNET_PLACEHOLDER after mainnet deploy (or set VITE_PIP_ADDRESS)
const TESTNET_PIP_ADDRESS  = '0x66a76a19c4de93d7dc2eee72218b098f2a8b1a40' as const
const MAINNET_PIP_ADDRESS  = 'MAINNET_PLACEHOLDER' as const  // TODO: replace after mainnet deploy

const ENV_PIP_ADDRESS = import.meta.env.VITE_PIP_ADDRESS?.trim()

export const PIP_ADDRESS = (
  ENV_PIP_ADDRESS && /^0x[0-9a-fA-F]{40}$/.test(ENV_PIP_ADDRESS)
    ? ENV_PIP_ADDRESS
    : IS_MAINNET ? MAINNET_PIP_ADDRESS : TESTNET_PIP_ADDRESS
) as `0x${string}`

if (!/^0x[0-9a-fA-F]{40}$/.test(PIP_ADDRESS)) {
  console.warn('[pip] PIP_ADDRESS is not set for this network. Set VITE_PIP_ADDRESS or edit src/pip-contract.ts.')
}

export const PIP_ABI = pipAbi as Abi

// USDC ERC-20 address is identical on Arc testnet and mainnet
export const USDC_ADDRESS = '0x3600000000000000000000000000000000000000' as `0x${string}`
export const USDC_DECIMALS = 6

// Explorer base
export const EXPLORER_BASE = IS_MAINNET
  ? 'https://explorer.arc.io'
  : 'https://explorer.testnet.arc.io'

export function explorerTx(hash: string)  { return `${EXPLORER_BASE}/tx/${hash}` }
export function explorerAddr(addr: string) { return `${EXPLORER_BASE}/address/${addr}` }

// Fallback minimum feed (USDC, 6 decimals) used only until the live `minFeed()`
// is read from the contract. Contract default: 1_000 = 0.001 USDC.
export const MIN_FEED_AMOUNT = 1_000n

// Fallback interact() minimums [PET, FEED, SAY, PLAY, GIFT_HAT] until live getters load.
export const DEFAULT_MIN_PRICES = [100n, 1_000n, 500n, 1_000n, 5_000n] as const

// Fallback burn rate used only until `burnRatePerHour()` is read.
// Planned constructor value for new deploys: 1_000 = 0.001 USDC/h (1 USDC ≈ 41 days).
// The old testnet contract 0x66a7…1a40 still runs at 20_000.
export const DEFAULT_BURN_RATE = 1_000n
