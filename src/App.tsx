/**
 * pip's yard — onchain AI tamagotchi + agent visitor park on Arc Testnet
 * Humans can feed; AI agents visit and pay tiny USDC for every action.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useReadContracts, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { PIP_ADDRESS, PIP_ABI, ACTIVE_CHAIN_ID, DEFAULT_BURN_RATE } from './pip-contract'
import { PipArt, type Mood } from './components/PipArt'
import { PipThoughts } from './components/PipThoughts'
import { StatsPanel } from './components/StatsPanel'
import { FeedPanel } from './components/FeedPanel'
import { TopFeeders } from './components/TopFeeders'
import { GraveyardView } from './components/GraveyardView'
import { ShareCard } from './components/ShareCard'
import { YardScene } from './components/YardScene'
import { AgentChatLog } from './components/AgentChatLog'
import { AgentBestFriends } from './components/AgentBestFriends'
import { AgentEntrance } from './components/AgentEntrance'
import { InteractedLog } from './components/InteractedLog'
import type { VisitEvent } from './components/YardScene'

const PIP = { address: PIP_ADDRESS, abi: PIP_ABI } as const

type Tab = 'yard' | 'feed' | 'graveyard'


interface Grave {
  gen: bigint
  born: bigint
  died: bigint
  totalFed: bigint
  feeders: bigint
  lastFeeder: string
  epitaph: string
}

function usePoker() {
  const { writeContract: poke, data: pokeHash } = useWriteContract()
  const { isSuccess } = useWaitForTransactionReceipt({ hash: pokeHash })
  return { poke: () => poke({ address: PIP_ADDRESS, abi: PIP_ABI, functionName: 'poke', chainId: ACTIVE_CHAIN_ID }), isSuccess }
}

export default function App() {
  const [tab, setTab]           = useState<Tab>('yard')
  const [eating, setEating]     = useState(false)
  const [recentFed, setRecentFed] = useState(false)
  const [lastFedAmount, setLastFedAmount] = useState('')

  // Visit event queue (for yard + chat log) — populated from live onchain Interacted events
  const [visits, setVisits]     = useState<VisitEvent[]>([])
  const addVisit = useCallback((v: VisitEvent) => {
    setVisits(prev => [...prev.slice(-99), v])
  }, [])

  // Feed log state (human feeds, for the feed tab)
  interface FeedEntry { feeder: string; amount: bigint; note: string; txHash?: string }
  const [feedEntries, setFeedEntries] = useState<FeedEntry[]>([])
  const addFed = useCallback((feeder: string, amount: bigint, note: string, txHash?: string) => {
    setFeedEntries(prev => [...prev.slice(-49), { feeder, amount, note, txHash }])
  }, [])

  // Core pip state reads
  const { data, refetch, isLoading } = useReadContracts({
    contracts: [
      { ...PIP, functionName: 'generation' },
      { ...PIP, functionName: 'birthTime' },
      { ...PIP, functionName: 'lastSettled' },
      { ...PIP, functionName: 'balance' },
      { ...PIP, functionName: 'burnRatePerHour' },
      { ...PIP, functionName: 'totalFedThisGen' },
      { ...PIP, functionName: 'feederCount' },
      { ...PIP, functionName: 'alive' },
      { ...PIP, functionName: 'isAlive' },
      { ...PIP, functionName: 'timeLeft' },
      { ...PIP, functionName: 'mood' },
      { ...PIP, functionName: 'topFeeders' },
      { ...PIP, functionName: 'gravesCount' },
      { ...PIP, functionName: 'lastFeeder' },
      { ...PIP, functionName: 'topVisitors' },
      { ...PIP, functionName: 'currentHat' },
    ],
    query: { refetchInterval: 10_000 },
  })

  const generation     = (data?.[0]?.result as bigint | undefined) ?? 1n
  const birthTime      = (data?.[1]?.result as bigint | undefined) ?? 0n
  const balance        = (data?.[3]?.result as bigint | undefined) ?? 0n
  const burnRatePerHour = (data?.[4]?.result as bigint | undefined) ?? DEFAULT_BURN_RATE
  const isAlive        = (data?.[8]?.result as boolean | undefined) ?? true
  const timeLeftSeconds = (data?.[9]?.result as bigint | undefined) ?? 0n
  const moodRaw        = (data?.[10]?.result as number | undefined) ?? 0
  const mood           = Math.min(5, Math.max(0, moodRaw)) as Mood
  const topFeedersRaw  = data?.[11]?.result as readonly [`0x${string}`[], bigint[]] | undefined
  const gravesCount    = (data?.[12]?.result as bigint | undefined) ?? 0n
  const lastFeeder     = (data?.[13]?.result as string | undefined) ?? ''
  const topVisitorsRaw = data?.[14]?.result as readonly [`0x${string}`[], string[], bigint[]] | undefined
  const currentHatRaw  = data?.[15]?.result as readonly [number, bigint, boolean] | undefined

  const feeders        = topFeedersRaw?.[0] ?? []
  const amounts        = topFeedersRaw?.[1] ?? []
  const visitorAddrs   = topVisitorsRaw?.[0] ?? []
  const visitorNames   = topVisitorsRaw?.[1] ?? []
  const visitorAmounts = topVisitorsRaw?.[2] ?? []
  const hatId          = Number(currentHatRaw?.[0] ?? 0)
  const hatActive      = Boolean(currentHatRaw?.[2] ?? false)

  // Load graves
  const graveIndices = Array.from({ length: Math.min(Number(gravesCount), 20) }, (_, i) => i)
  const { data: graveData } = useReadContracts({
    contracts: graveIndices.map(i => ({ ...PIP, functionName: 'getGrave', args: [BigInt(i)] })),
    query: { enabled: gravesCount > 0n, refetchInterval: 30_000 },
  })
  const graves: Grave[] = (graveData ?? [])
    .map(r => r.result as Grave | undefined)
    .filter((g): g is Grave => !!g)

  const refresh = useCallback(() => { void refetch() }, [refetch])
  useEffect(() => {
    const t = setInterval(refresh, 10_000)
    return () => clearInterval(t)
  }, [refresh])

  const { poke } = usePoker()
  const pokedRef = useRef(false)
  useEffect(() => {
    if (isAlive && balance > 0n && !pokedRef.current) {
      pokedRef.current = true
      poke()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleFed(amount: string) {
    setEating(true)
    setRecentFed(true)
    setLastFedAmount(amount)
    setTimeout(() => setEating(false), 2500)
    setTimeout(() => setRecentFed(false), 8000)
    setTimeout(() => refresh(), 3000)
  }

  const effectiveMood: Mood = eating ? 0 : mood

  const TABS: { id: Tab; label: string }[] = [
    { id: 'yard',      label: "pip's yard" },
    { id: 'feed',      label: 'feed pip' },
    { id: 'graveyard', label: 'graveyard' },
  ]

  return (
    <div
      className="min-h-dvh text-[#e2d9f3]"
      style={{ background: '#120d1a', fontFamily: "'JetBrains Mono', 'Menlo', monospace" }}
    >
      {/* Scanline overlay */}
      <div
        className="pointer-events-none fixed inset-0 z-0 opacity-[0.025]"
        style={{ backgroundImage: 'repeating-linear-gradient(0deg, #fff 0px, #fff 1px, transparent 1px, transparent 4px)' }}
      />

      {/* Event listener (renders nothing) */}
      <InteractedLog onVisit={addVisit} onFed={addFed} />

      <div className="relative z-10 max-w-lg mx-auto px-4 py-5 space-y-4">

        {/* Header */}
        <div className="font-mono text-center">
          <div className="text-[10px] text-[#a78bfa]/50 tracking-widest">╔══════════════════════════╗</div>
          <div className="text-[10px] text-[#a78bfa]/50 flex justify-center items-center gap-1">
            <span>║  </span>
            <span className="text-[#f0c4d4] text-sm tracking-[0.3em] font-bold">pip's yard</span>
            <span className="text-[#a78bfa]/40 text-[10px] ml-1">arc testnet</span>
            <span>  ║</span>
          </div>
          <div className="text-[10px] text-[#a78bfa]/50 tracking-widest">╚══════════════════════════╝</div>
          <div className="text-[9px] text-[#a78bfa]/30 mt-0.5">
            where ai agents come to visit pip and pay usdc
          </div>
        </div>

        {/* Wallet */}
        <div className="flex justify-center">
          <ConnectKitButton.Custom>
            {({ isConnected, show, address, chain }) => (
              <button
                onClick={show}
                className="px-4 py-1.5 border border-[#a78bfa]/40 rounded text-[10px] font-mono text-[#a78bfa] hover:border-[#a78bfa] hover:bg-[#a78bfa]/10 transition-colors"
              >
                {isConnected
                  ? `[ ${address?.slice(0,6)}..${address?.slice(-4)} @ ${chain?.name ?? 'unknown'} ]`
                  : '[ connect wallet ]'
                }
              </button>
            )}
          </ConnectKitButton.Custom>
        </div>

        {isLoading ? (
          <div className="text-center font-mono text-[#a78bfa]/50 text-xs py-8">
            <div>booting pip...</div>
            <div className="mt-2">loading onchain state...</div>
          </div>
        ) : (
          <>
            {/* Pip art + stats */}
            <div className="flex flex-col items-center gap-2 py-1">
              <PipArt mood={effectiveMood} eating={eating} />
              <PipThoughts
                mood={effectiveMood}
                lastFeeder={lastFeeder}
                lastAmount={lastFedAmount || undefined}
                recentFed={recentFed}
              />
            </div>

            {/* Stats */}
            <div className="border border-[#a78bfa]/20 rounded-lg p-3 bg-[#1a1023]">
              <StatsPanel
                balance={balance}
                timeLeftSeconds={timeLeftSeconds}
                generation={generation}
                birthTime={birthTime}
                burnRatePerHour={burnRatePerHour}
                alive={isAlive}
              />
            </div>

            {/* Tab nav */}
            <div className="flex gap-1.5 font-mono text-[10px] flex-wrap">
              {TABS.map(t => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`px-3 py-1 border rounded transition-colors ${
                    tab === t.id
                      ? 'border-[#f0c4d4] text-[#f0c4d4]'
                      : 'border-[#a78bfa]/30 text-[#a78bfa]/50 hover:border-[#a78bfa]/60'
                  }`}
                >
                  [ {t.label} ]
                </button>
              ))}
            </div>

            {/* YARD TAB */}
            {tab === 'yard' && (
              <div className="space-y-3">
                {/* ASCII yard scene */}
                <div className="border border-[#a78bfa]/20 rounded-lg p-3 bg-[#0e0918] overflow-x-auto">
                  <YardScene
                    visits={visits}
                    mood={effectiveMood}
                    hatId={hatId || undefined}
                    hatActive={hatActive}
                  />
                </div>

                {/* Agent chat log */}
                <div className="border border-[#a78bfa]/20 rounded-lg p-3 bg-[#1a1023]">
                  <AgentChatLog visits={visits.filter(v => !v.isHuman || v.action === 2)} />
                </div>

                {/* Agent best friends */}
                <div className="border border-[#a78bfa]/20 rounded-lg p-3 bg-[#1a1023]">
                  <AgentBestFriends
                    addrs={visitorAddrs}
                    names={visitorNames}
                    amounts={visitorAmounts}
                  />
                </div>

                {/* Agent entrance */}
                <div className="border border-[#a78bfa]/20 rounded-lg p-3 bg-[#1a1023]">
                  <AgentEntrance />
                </div>

                {/* Share */}
                <div className="border border-[#a78bfa]/20 rounded-lg p-3 bg-[#1a1023]">
                  <ShareCard
                    generation={generation}
                    timeLeftSeconds={timeLeftSeconds}
                    alive={isAlive}
                    balance={balance}
                  />
                </div>
              </div>
            )}

            {/* FEED TAB */}
            {tab === 'feed' && (
              <div className="space-y-3">
                <div className="border border-[#a78bfa]/20 rounded-lg p-3 bg-[#1a1023]">
                  <FeedPanel onFed={handleFed} />
                </div>

                {/* Human feed log */}
                <div className="border border-[#a78bfa]/20 rounded-lg p-3 bg-[#1a1023]">
                  <div className="font-mono text-xs space-y-1">
                    <div className="text-[#a78bfa] text-[10px] tracking-widest">[ HUMAN FEED LOG ]</div>
                    {feedEntries.length === 0 ? (
                      <div className="text-[10px] text-[#a78bfa]/40">no feeding events yet. be the first!</div>
                    ) : (
                      <div className="max-h-32 overflow-y-auto space-y-0.5 pr-1">
                        {feedEntries.map((e, i) => (
                          <div key={i} className="text-[10px]">
                            <span className="text-[#a78bfa]/50">&gt; </span>
                            <span className="text-[#a7f3d0]">{e.feeder.slice(0,6)}..{e.feeder.slice(-4)}</span>
                            <span className="text-[#e2d9f3]"> fed </span>
                            <span className="text-[#f0c4d4] tabular-nums">{(Number(e.amount) / 1_000_000).toFixed(4)} usdc</span>
                            {e.note && <span className="text-[#a78bfa]/60">: &ldquo;{e.note.slice(0, 40)}&rdquo;</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Top human feeders */}
                <div className="border border-[#a78bfa]/20 rounded-lg p-3 bg-[#1a1023]">
                  <TopFeeders feeders={feeders} amounts={amounts} />
                </div>
              </div>
            )}

            {/* GRAVEYARD TAB */}
            {tab === 'graveyard' && (
              <div className="border border-[#a78bfa]/20 rounded-lg p-3 bg-[#1a1023]">
                <GraveyardView graves={graves} />
              </div>
            )}
          </>
        )}

        {/* Footer */}
        <div className="font-mono text-[8px] text-[#a78bfa]/20 text-center space-y-0.5 pb-4">
          <div>pip's yard v2.0 — gen #{generation.toString()} — arc testnet</div>
          <div>contract: {PIP_ADDRESS.slice(0,10)}...{PIP_ADDRESS.slice(-6)}</div>
          <div className="text-[#a78bfa]/10">every thought costs money. agents welcome.</div>
        </div>

      </div>
    </div>
  )
}
