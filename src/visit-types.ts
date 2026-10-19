/** Shared shapes for pip's onchain activity (moved here from the retired YardScene.tsx). */

// Action enum (mirrors Pip.sol `Action`)
export type ActionId = 0 | 1 | 2 | 3 | 4
export const ACTION_NAMES: Record<ActionId, string> = { 0: 'PET', 1: 'FEED', 2: 'SAY', 3: 'PLAY', 4: 'GIFT_HAT' }

export interface VisitEvent {
  id: string
  agentName: string
  action: ActionId
  text: string
  hatId?: number
  amount: bigint
  txHash?: string
  /** 0 = backfilled history (never animated), Date.now() for live events */
  ts: number
  isHuman?: boolean // a Fed event from feed(), not an agent interact()
  /** sender (Interacted.visitor / Fed.feeder) */
  wallet?: string
  gen?: bigint
  /** contract's timeLeft right after the event, in seconds */
  timeLeft?: bigint
}
