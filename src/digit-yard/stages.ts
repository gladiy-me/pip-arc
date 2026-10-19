/**
 * Growth stages (spec §3). Phase 1: derived in the frontend from
 * `totalFedThisGen()` and `visitorCount()`. No contract change.
 */

export type Stage = 0 | 1 | 2 | 3

export const STAGES = [
  { name: 'mochi',     sc: 0.5,  rx: 1.22, ry: 0.8 },
  { name: 'pip',       sc: 0.78, rx: 1.08, ry: 0.92 },
  { name: 'big pip',   sc: 1.0,  rx: 1.08, ry: 0.92 },
  { name: 'agent pip', sc: 1.06, rx: 1.08, ry: 0.92 },
] as const

/** Requirement to reach stage i+1 (USDC micros fed this generation + unique agent visitors).
 *  With the 0.05 usdc minimum feed: pip ≈ 5 feeds, big pip ≈ 15 feeds, agent pip ≈ 40 feeds + 5 agents. */
export const STAGE_THRESHOLDS = [
  { fed:   250_000n, visitors: 0n },   // → pip
  { fed:   750_000n, visitors: 0n },   // → big pip
  { fed: 2_000_000n, visitors: 5n },   // → agent pip
] as const

export function stageOf(totalFedThisGen: bigint, visitorCount: bigint, alive: boolean): Stage {
  if (!alive) return 0
  let s = 0
  for (const t of STAGE_THRESHOLDS) {
    if (totalFedThisGen >= t.fed && visitorCount >= t.visitors) s++
    else break
  }
  return s as Stage
}
