/**
 * wagmi configuration
 * Built with Arc Studio — https://studio.arc.io
 *
 * Set VITE_NETWORK=mainnet in .env to point the app at Arc Mainnet (chainId 5042).
 * Default: Arc Testnet (chainId 5042002).
 */

import { http, createConfig } from 'wagmi'
import { mainnet } from 'wagmi/chains'
import { arcTestnet } from 'viem/chains'
import { defineChain } from 'viem'
import { injected } from 'wagmi/connectors'
import { registerChain } from './tracing'

const IS_MAINNET = import.meta.env.VITE_NETWORK === 'mainnet'

// Arc Mainnet chain definition (viem doesn't export this yet)
const arcMainnet = defineChain({
  id: 5042,
  name: 'Arc',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.mainnet.arc.io'] } },
  blockExplorers: { default: { name: 'Arc Explorer', url: 'https://explorer.arc.io' } },
})

const activeChain = IS_MAINNET ? arcMainnet : arcTestnet

// Pre-register chain RPC URLs so trace events show correct chain names immediately
registerChain(arcTestnet.id, arcTestnet.rpcUrls.default.http[0])
if (IS_MAINNET) registerChain(arcMainnet.id, arcMainnet.rpcUrls.default.http[0])

// Build transports object typed to cover all possible chain IDs at compile time.
// We must include both Arc chain IDs so TypeScript is satisfied regardless of VITE_NETWORK.
const transports = {
  [arcMainnet.id]: http(),
  [arcTestnet.id]: http(),
  [mainnet.id]: http(),
} as const

export const config = createConfig({
  chains: [activeChain, mainnet], // mainnet still needed for ENS resolution
  connectors: [injected()],
  transports,
})
