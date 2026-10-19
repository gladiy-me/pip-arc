/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 'mainnet' → Arc Mainnet (5042); anything else → Arc Testnet (5042002) */
  readonly VITE_NETWORK?: string
  /** Overrides the Pip contract address for the active network (also read by server/visit.ts) */
  readonly VITE_PIP_ADDRESS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
