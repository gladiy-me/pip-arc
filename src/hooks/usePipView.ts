/**
 * usePipView — contract reads → digit-yard view model.
 * Pushes the view into <DigitYard /> and detects transitions (skipped on first load):
 *   stage up → evolve(), generation up → hatched(), alive true→false → died().
 */
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useReadContracts } from 'wagmi'
import { PIP_ADDRESS, PIP_ABI, DEFAULT_BURN_RATE, ACTIVE_CHAIN_ID } from '../pip-contract'
import { STAGES, STAGE_THRESHOLDS, stageOf, type Stage, type Mood } from '../digit-yard'
import type { DigitYardHandle } from '../components/DigitYard'

const PIP = { address: PIP_ADDRESS, abi: PIP_ABI, chainId: ACTIVE_CHAIN_ID } as const

export interface NextStage {
  name: string
  /** fed this generation (micros) */
  fed: bigint
  /** fed needed for the next form (micros) */
  need: bigint
  /** fed threshold of the current form (micros), for the progress bar */
  from: bigint
  visitors: bigint
  needVisitors: bigint
}

export interface PipView {
  loaded: boolean
  mood: Mood
  alive: boolean
  stage: Stage
  stageName: string
  hatActive: boolean
  timeLeftSeconds: bigint
  /** Date.now() when timeLeftSeconds was read (for a local countdown) */
  readAt: number
  balance: bigint
  burnRatePerHour: bigint
  generation: bigint
  birthTime: bigint
  totalFedThisGen: bigint
  feederCount: bigint
  visitorCount: bigint
  nextStage: NextStage | null
  refetch: () => void
}

function useReducedMotion(): boolean {
  const [rm, setRm] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!mq) return
    const on = () => setRm(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return rm
}

export function usePipView(
  yard: RefObject<DigitYardHandle | null>,
  opts: { onEvolve?: (stageName: string) => void } = {},
): PipView {
  const { data, refetch, isSuccess, dataUpdatedAt } = useReadContracts({
    contracts: [
      { ...PIP, functionName: 'generation' },
      { ...PIP, functionName: 'birthTime' },
      { ...PIP, functionName: 'balance' },
      { ...PIP, functionName: 'burnRatePerHour' },
      { ...PIP, functionName: 'totalFedThisGen' },
      { ...PIP, functionName: 'feederCount' },
      { ...PIP, functionName: 'visitorCount' },
      { ...PIP, functionName: 'isAlive' },
      { ...PIP, functionName: 'timeLeft' },
      { ...PIP, functionName: 'mood' },
      { ...PIP, functionName: 'currentHat' },
    ],
    query: { refetchInterval: 10_000 },
  })
  const reducedMotion = useReducedMotion()

  const generation      = (data?.[0]?.result as bigint | undefined) ?? 1n
  const birthTime       = (data?.[1]?.result as bigint | undefined) ?? 0n
  const balance         = (data?.[2]?.result as bigint | undefined) ?? 0n
  const burnRatePerHour = (data?.[3]?.result as bigint | undefined) ?? DEFAULT_BURN_RATE
  const totalFedThisGen = (data?.[4]?.result as bigint | undefined) ?? 0n
  const feederCount     = (data?.[5]?.result as bigint | undefined) ?? 0n
  const visitorCount    = (data?.[6]?.result as bigint | undefined) ?? 0n
  const alive           = (data?.[7]?.result as boolean | undefined) ?? true
  const timeLeftSeconds = (data?.[8]?.result as bigint | undefined) ?? 0n
  const moodRaw         = Number((data?.[9]?.result as number | undefined) ?? 1)
  const hatRaw          = data?.[10]?.result as readonly [number, bigint, boolean] | undefined
  const hatActive       = Boolean(hatRaw?.[2] ?? false)
  // "loaded" = the core reads came back (an old contract without e.g. visitorCount still loads)
  const loaded = isSuccess && data?.[0]?.status === 'success'

  const mood = (alive ? Math.min(4, Math.max(0, moodRaw)) : 5) as Mood
  const stage = stageOf(totalFedThisGen, visitorCount, alive)

  const nextStage = useMemo<NextStage | null>(() => {
    if (stage >= 3) return null
    const t = STAGE_THRESHOLDS[stage as 0 | 1 | 2]
    return {
      name: STAGES[stage + 1].name,
      fed: totalFedThisGen,
      need: t.fed,
      from: stage > 0 ? STAGE_THRESHOLDS[(stage - 1) as 0 | 1].fed : 0n,
      visitors: visitorCount,
      needVisitors: t.visitors,
    }
  }, [stage, totalFedThisGen, visitorCount])

  // push view + detect transitions
  const prev = useRef<{ gen: bigint; stage: Stage; alive: boolean } | null>(null)
  const onEvolveRef = useRef(opts.onEvolve)
  onEvolveRef.current = opts.onEvolve
  useEffect(() => {
    if (!loaded) return
    const y = yard.current
    const p = prev.current
    const view = { mood, stage, alive, hat: hatActive, reducedMotion, generation: Number(generation) }
    if (!y) return
    if (!p) {                                            // first load: no transitions
      y.setView(view)
      prev.current = { gen: generation, stage, alive }
      return
    }
    if (generation > p.gen) {
      y.hatched(Number(generation))
      y.setView(view)
      if (alive && stage > 0) {                          // a big first feed can skip mochi straight away
        setTimeout(() => { yard.current?.evolve(); onEvolveRef.current?.(STAGES[stage].name) }, 1200)
      }
    } else {
      if (p.alive && !alive) y.died(Number(generation))
      y.setView(view)
      if (alive && p.alive && stage > p.stage) { y.evolve(); onEvolveRef.current?.(STAGES[stage].name) }
    }
    prev.current = { gen: generation, stage, alive }
  }, [loaded, dataUpdatedAt, mood, stage, alive, hatActive, reducedMotion, generation, yard])

  return {
    loaded,
    mood, alive, stage,
    stageName: alive ? STAGES[stage].name : 'ghost',
    hatActive,
    timeLeftSeconds,
    readAt: dataUpdatedAt || Date.now(),
    balance, burnRatePerHour, generation, birthTime, totalFedThisGen, feederCount, visitorCount,
    nextStage,
    refetch: () => { void refetch() },
  }
}
