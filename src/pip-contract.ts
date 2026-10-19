/**
 * Pip contract config — env-gated: testnet by default, Arc mainnet when
 * VITE_NETWORK=mainnet is set. Never hardcode chain IDs or addresses below;
 * always import from this file.
 */
import type { Abi } from 'viem'
import artifact from '../contracts/out/Pip.sol/Pip.json'

// --------------------------------------------------------------------------
// Network switch: set VITE_NETWORK=mainnet in .env to target Arc mainnet.
// --------------------------------------------------------------------------
const IS_MAINNET = import.meta.env.VITE_NETWORK === 'mainnet'

// Arc Testnet: chainId 5042002  |  Arc Mainnet: chainId 5042
export const ACTIVE_CHAIN_ID = IS_MAINNET ? 5042 : 5042002

// Contract addresses
// TESTNET  — deployed 2026-10-18, Arc Testnet
// MAINNET  — replace MAINNET_PLACEHOLDER below after mainnet deploy
const TESTNET_PIP_ADDRESS  = '0x66a76a19c4de93d7dc2eee72218b098f2a8b1a40' as const
const MAINNET_PIP_ADDRESS  = 'MAINNET_PLACEHOLDER' as const  // TODO: replace after mainnet deploy

export const PIP_ADDRESS = (IS_MAINNET ? MAINNET_PIP_ADDRESS : TESTNET_PIP_ADDRESS) as `0x${string}`
export const PIP_ABI = artifact.abi as Abi

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

// Fallback burn rate used only until `burnRatePerHour()` is read.
// Planned constructor value for new deploys: 1_000 = 0.001 USDC/h (1 USDC ≈ 41 days).
// The old testnet contract 0x66a7…1a40 still runs at 20_000.
export const DEFAULT_BURN_RATE = 1_000n
