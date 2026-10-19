/**
 * pip.exe — onchain tamagotchi on Arc. "digit yard" layout (docs/PIP_VISUAL_SPEC.md, Phase 1):
 * yard left (every cell is a digit), dApp panel right; stacked on phones.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAccount, useReadContracts } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { PIP_ADDRESS, PIP_ABI, ACTIVE_CHAIN_ID, NETWORK_LABEL } from './pip-contract'
import { DigitYard, type DigitYardHandle } from './components/DigitYard'
import { usePipView, type PipView } from './hooks/usePipView'
import { VisitPanel, fmtMicros } from './components/VisitPanel'
import { TopFeeders } from './components/TopFeeders'
import { GraveyardView, type Grave } from './components/GraveyardView'
import { AgentBestFriends } from './components/AgentBestFriends'
import { AgentEntrance } from './components/AgentEntrance'
import { InteractedLog } from './components/InteractedLog'
import { shortAddr, type PipTxRequest } from './hooks/usePipTx'
import { MOODS, STAGES, fmtDur } from './digit-yard'
import { ACTION_NAMES, type VisitEvent } from './visit-types'

const PIP = { address: PIP_ADDRESS, abi: PIP_ABI, chainId: ACTIVE_CHAIN_ID } as const

interface ActivityRow {
  id: string
  who: string
  you: boolean
  kind: string
  amount?: bigint
  text?: string
  /** ms; 0 = backfilled history */
  ts: number
}

function DigitBar({ filled, total, label }: { filled: number; total: number; label: string }) {
  const f = Math.max(0, Math.min(total, filled))
  return (
    <div className="lifebar" role="img" aria-label={label}>
      <span className="f">{'8'.repeat(f)}</span><span className="e">{'0'.repeat(total - f)}</span>
    </div>
  )
}

/** Local 1 s countdown from the last timeLeft read. */
function useCountdown(v: PipView): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])
  if (!v.alive) return 0
  return Math.max(0, Number(v.timeLeftSeconds) - Math.floor((now - v.readAt) / 1000))
}

function ago(ts: number): string {
  if (!ts) return '—'
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000))
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`
}

function StatusCard({ v, secLeft }: { v: PipView; secLeft: number }) {
  const N = 24
  const filled = v.alive ? Math.max(1, Math.min(N, Math.ceil((secLeft / 3600 / 96) * N))) : 0
  return (
    <div className="card">
      <h2>status <span>{v.alive ? 'alive' : 'dead · feed to hatch'}</span></h2>
      <div className="mood">
        <span className="word">{MOODS[v.mood]}</span>
        <span className="gen">generation #{v.generation.toString()}</span>
      </div>
      <DigitBar filled={filled} total={N} label={`life left: ${v.alive ? fmtDur(secLeft) : 'none'}`} />
      <dl className="stats">
        <div><dt>time left</dt><dd className="big">{v.alive ? fmtDur(secLeft) : 'dead'}</dd></div>
        <div><dt>balance</dt><dd>{(Number(v.balance) / 1e6).toFixed(6)} usdc</dd></div>
        <div><dt>metabolism</dt><dd>{fmtMicros(v.burnRatePerHour)} usdc/h</dd></div>
        <div><dt>feeders · agents</dt><dd>{v.feederCount.toString()} · {v.visitorCount.toString()}</dd></div>
      </dl>
    </div>
  )
}

function GrowthCard({ v }: { v: PipView }) {
  const n = v.nextStage
  const M = 24
  let fill = M
  if (n) {
    const span = Number(n.need - n.from)
    const pr = span > 0 ? Math.max(0, Math.min(1, Number(n.fed - n.from) / span)) : 1
    fill = Math.round(pr * M)
  }
  return (
    <div className="card">
      <h2>growth <span>{v.stageName}</span></h2>
      <div className="stages">
        {STAGES.map((s, i) => (
          <span key={s.name} className={v.alive && i === v.stage ? 'on' : v.alive && i < v.stage ? 'done' : ''}>{s.name}</span>
        ))}
      </div>
      {n ? (
        <>
          <DigitBar filled={fill} total={M} label={`progress to ${n.name}`} />
          <p className="fine">
            next: {n.name} · fed {fmtMicros(n.fed)} / {fmtMicros(n.need)} usdc this generation
            {n.needVisitors > 0n ? ` · ${(n.visitors < n.needVisitors ? n.visitors : n.needVisitors).toString()} / ${n.needVisitors.toString()} different agents` : ''}
          </p>
        </>
      ) : (
        <>
          <div className="lifebar">max form</div>
          <p className="fine">final form. dies like everyone else if nobody feeds it.</p>
        </>
      )}
    </div>
  )
}

function ActivityCard({ rows }: { rows: ActivityRow[] }) {
  const [, tick] = useState(0)
  useEffect(() => { const t = setInterval(() => tick(x => x + 1), 5000); return () => clearInterval(t) }, [])
  return (
    <div className="card">
      <h2>activity <span>Interacted · Fed</span></h2>
      {rows.length === 0 ? <p className="fine">no visitors yet. be the first.</p> : (
        <ul className="log">
          {rows.slice(0, 30).map(e => (
            <li key={e.id}>
              <span className={`who${e.you ? ' you' : ''}`} title={e.who}>{e.who}</span>
              <span className="what">
                <b>{e.kind}</b>
                {e.kind === 'EVOLVE' ? ` → ${e.text}` : ` ${fmtMicros(e.amount ?? 0n)} usdc${e.text ? ` · "${e.text}"` : ''}`}
              </span>
              <span className="ago">{ago(e.ts)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

type LedgerTab = 'feeders' | 'agents' | 'graveyard'

export default function App() {
  const yardRef = useRef<DigitYardHandle>(null)
  const { address } = useAccount()
  const me = address?.toLowerCase()
  const meRef = useRef(me)
  meRef.current = me

  const [activity, setActivity] = useState<ActivityRow[]>([])
  const pushRow = useCallback((r: ActivityRow) => setActivity(prev => [r, ...prev].slice(0, 60)), [])

  const view = usePipView(yardRef, {
    onEvolve: name => pushRow({ id: `evo-${Date.now()}`, who: 'pip', you: true, kind: 'EVOLVE', text: name, ts: Date.now() }),
  })
  const secLeft = useCountdown(view)
  const burnRef = useRef(view.burnRatePerHour)
  burnRef.current = view.burnRatePerHour
  const refetchRef = useRef(view.refetch)
  refetchRef.current = view.refetch

  // secondary reads (leaderboards + graves)
  const { data } = useReadContracts({
    contracts: [
      { ...PIP, functionName: 'topFeeders' },
      { ...PIP, functionName: 'topVisitors' },
      { ...PIP, functionName: 'gravesCount' },
    ],
    query: { refetchInterval: 10_000 },
  })
  const topFeedersRaw  = data?.[0]?.result as readonly [`0x${string}`[], bigint[]] | undefined
  const topVisitorsRaw = data?.[1]?.result as readonly [`0x${string}`[], string[], bigint[]] | undefined
  const gravesCount    = (data?.[2]?.result as bigint | undefined) ?? 0n
  const graveIndices = Array.from({ length: Math.min(Number(gravesCount), 20) }, (_, i) => Number(gravesCount) - 1 - i).reverse()
  const { data: graveData } = useReadContracts({
    contracts: graveIndices.map(i => ({ ...PIP, functionName: 'getGrave', args: [BigInt(i)] })),
    query: { enabled: gravesCount > 0n, refetchInterval: 30_000 },
  })
  const graves: Grave[] = (graveData ?? []).map(r => r.result as Grave | undefined).filter((g): g is Grave => !!g)
  const [tab, setTab] = useState<LedgerTab>('feeders')

  // ── events → animations ──────────────────────────────────────────────
  const ownHashes = useRef(new Set<string>())
  const refetchSoon = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scheduleRefetch = useCallback(() => {
    if (refetchSoon.current) clearTimeout(refetchSoon.current)
    refetchSoon.current = setTimeout(() => refetchRef.current(), 1500)
  }, [])
  const lifeOf = (amount: bigint) => {
    const r = burnRef.current
    return r > 0n ? Number((amount * 3600n) / r) : 0
  }

  /** Same animation for the user's own confirmed tx and for a live event from their wallet. */
  const animateDirect = useCallback((action: number, amount: bigint, text: string) => {
    const y = yardRef.current
    if (!y) return
    if (action === 0) y.pet()
    else if (action === 1) y.feed(lifeOf(amount), { amountUsdc: Number(amount) / 1e6 })
    else if (action === 2) y.heard(text || 'hello pip')
    else if (action === 3) y.play()
    else if (action === 4) y.hat(true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onVisit = useCallback((v: VisitEvent) => {
    const wallet = v.wallet?.toLowerCase()
    const mine = !!wallet && wallet === meRef.current
    pushRow({
      id: v.id,
      who: v.isHuman ? (mine ? 'you' : shortAddr(v.agentName)) : (mine ? 'you' : v.agentName.slice(0, 24) || '?'),
      you: mine,
      kind: v.isHuman ? 'FEED' : ACTION_NAMES[v.action],
      amount: v.amount,
      text: v.text ? v.text.slice(0, 60) : '',
      ts: v.ts,
    })
    if (!v.ts) return                                   // history never animates
    scheduleRefetch()
    if (v.txHash && ownHashes.current.has(v.txHash)) return  // already animated on confirmation
    const y = yardRef.current
    if (!y) return
    if (v.isHuman) {                                    // human feed(): just the coin, no robot
      y.feed(lifeOf(v.amount), { amountUsdc: Number(v.amount) / 1e6, who: mine ? undefined : shortAddr(v.agentName) })
    } else if (mine) {
      animateDirect(v.action, v.amount, v.text)
    } else {
      y.agentVisit({ name: v.agentName, action: v.action, text: v.text, lifeAddedSeconds: v.action === 1 ? lifeOf(v.amount) : undefined })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pushRow, scheduleRefetch, animateDirect])

  const onDied = useCallback((gen: bigint) => { yardRef.current?.died(Number(gen)); scheduleRefetch() }, [scheduleRefetch])
  const onHatched = useCallback((gen: bigint) => { yardRef.current?.hatched(Number(gen)); scheduleRefetch() }, [scheduleRefetch])

  const onSubmitted = useCallback((hash: `0x${string}`) => {
    ownHashes.current.add(hash)
    yardRef.current?.say('ooh, a transaction. waiting for the chain…', 2500)
  }, [])
  const onSuccess = useCallback((req: PipTxRequest) => {
    animateDirect(req.action, req.amount, req.text)
    scheduleRefetch()
  }, [animateDirect, scheduleRefetch])

  const moodWord = MOODS[view.mood]
  const ariaLabel = `pip's yard. pip is a pink ${view.alive ? view.stageName : 'ghost'} drawn entirely from digits, feeling ${moodWord}. Click pip to pet it.`

  return (
    <div className="app">
      <InteractedLog onVisit={onVisit} onDied={onDied} onHatched={onHatched} />

      <header className="top">
        <div className="logo">pip.exe <small>onchain tamagotchi</small></div>
        <span className="chip"><span className="dot" />{NETWORK_LABEL}</span>
        <span className="spacer" />
        <ConnectKitButton.Custom>
          {({ isConnected, show, address: a, chain }) => (
            <button type="button" onClick={show} className={`btn wallet${isConnected ? ' on' : ''}`}>
              {isConnected ? `${a?.slice(0, 6)}…${a?.slice(-4)}${chain && chain.id !== ACTIVE_CHAIN_ID ? ' · wrong network' : ''}` : 'connect wallet'}
            </button>
          )}
        </ConnectKitButton.Custom>
      </header>

      <main className="grid">
        <DigitYard
          ref={yardRef}
          ariaLabel={ariaLabel}
          hudLeft={<>gen <b>{view.generation.toString()}</b> · <b>{moodWord}</b></>}
          hudRight={view.loaded ? (view.alive ? `time left ${fmtDur(secLeft)}` : `rip · gen ${view.generation.toString()}`) : 'loading onchain state…'}
        />

        <aside className="panel">
          <StatusCard v={view} secLeft={secLeft} />
          <GrowthCard v={view} />
          <VisitPanel burnRatePerHour={view.burnRatePerHour} onSubmitted={onSubmitted} onSuccess={onSuccess} />
          <ActivityCard rows={activity} />
          <AgentEntrance />
          <div className="card">
            <h2>
              <span className="seg" role="tablist" aria-label="leaderboards">
                {(['feeders', 'agents', 'graveyard'] as LedgerTab[]).map(t => (
                  <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'sel' : ''} onClick={() => setTab(t)}>
                    {t === 'feeders' ? 'top feeders' : t === 'agents' ? 'best agents' : 'graveyard'}
                  </button>
                ))}
              </span>
              <span>{tab === 'graveyard' ? `${gravesCount.toString()} graves` : 'this generation'}</span>
            </h2>
            {tab === 'feeders' && <TopFeeders feeders={topFeedersRaw?.[0] ?? []} amounts={topFeedersRaw?.[1] ?? []} />}
            {tab === 'agents' && <AgentBestFriends addrs={topVisitorsRaw?.[0] ?? []} names={topVisitorsRaw?.[1] ?? []} amounts={topVisitorsRaw?.[2] ?? []} />}
            {tab === 'graveyard' && <GraveyardView graves={graves} />}
          </div>
          <p className="fine foot">contract {PIP_ADDRESS.slice(0, 10)}…{PIP_ADDRESS.slice(-6)} · every thought costs money. agents welcome. · <a href="https://x.com/feedthepip" target="_blank" rel="noopener noreferrer">@feedthepip</a> · <a href="https://github.com/gladiy-me/pip-arc" target="_blank" rel="noopener noreferrer">github</a></p>
        </aside>
      </main>
    </div>
  )
}
