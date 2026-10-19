/**
 * wagmi configuration
 * Built with Arc Studio — https://studio.arc.io
 *
 * Set VITE_NETWORK=mainnet in .env to point the app at Arc Mainnet (chainId 5042).
 * Default: Arc Testnet (chainId 5042002).
 */

import { http, createConfig } from 'wagmi'
import { mainnet } from 'wagmi/chains'
import { arc as arcMainnet, arcTestnet, foundry } from 'viem/chains'
import { injected } from 'wagmi/connectors'
import { registerChain } from './tracing'

const IS_MAINNET = import.meta.env.VITE_NETWORK === 'mainnet'
const IS_LOCAL = import.meta.env.VITE_NETWORK === 'local' // anvil on 127.0.0.1:8545 for end-to-end checks

// Arc Mainnet: viem's own definition (RPC, explorer and multicall3 for batched reads)

const activeChain = IS_LOCAL ? foundry : IS_MAINNET ? arcMainnet : arcTestnet

// Pre-register chain RPC URLs so trace events show correct chain names immediately
registerChain(arcTestnet.id, arcTestnet.rpcUrls.default.http[0])
if (IS_MAINNET) registerChain(arcMainnet.id, arcMainnet.rpcUrls.default.http[0])

// Build transports object typed to cover all possible chain IDs at compile time.
// We must include both Arc chain IDs so TypeScript is satisfied regardless of VITE_NETWORK.
const transports = {
  [arcMainnet.id]: http(),
  [arcTestnet.id]: http(),
  [mainnet.id]: http(),
  [foundry.id]: http(),
} as const

export const config = createConfig({
  chains: [activeChain, mainnet], // mainnet still needed for ENS resolution
  connectors: [injected()],
  transports,
})
