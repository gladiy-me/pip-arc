import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAccount, useBlock, usePublicClient, useReadContract, useReadContracts, useSwitchChain, useWatchContractEvent, useWriteContract } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { erc20Abi, parseUnits, type Log } from 'viem'
import { toast } from 'sonner'
import { DigitYard } from './DigitYard'
import type { DigitYardApi } from './engine'
import {
  CHAIN_ID, CHAIN_LABEL, GROWTH, IS_CONFIGURED, MOODS, STAGE_NAMES, STATUS_NAMES, USDC_ADDRESS, VAULT_ABI, WORLD_ABI, WORLD_ADDRESS,
  explorerAddr, fmtDur, fmtUsdc, moodFromSeconds, short, type Pet, type PetView,
} from './contract'
import './world.css'

const W = { address: WORLD_ADDRESS, abi: WORLD_ABI, chainId: CHAIN_ID } as const
const ZERO = '0x0000000000000000000000000000000000000000'
const ACTIONS = ['PET', 'FEED', 'SAY', 'PLAY', 'HAT'] as const

type Activity = { key: string; who: string; kind: string; amount: bigint; text: string; at: number; meal?: boolean }

function readPipFromUrl(): bigint | null {
  try {
    const v = new URLSearchParams(window.location.search).get('pip')
    return v && /^\d+$/.test(v) ? BigInt(v) : null
  } catch { return null }
}

function toPetView(id: bigint, r: readonly unknown[] | undefined): PetView | null {
  if (!r) return null
  const [pet, owner, liveStatus, liveBalance, timeLeft, nextMealAt, mealSize] = r as [Pet, `0x${string}`, number, bigint, bigint, bigint, bigint]
  return { id, pet, owner, liveStatus: Number(liveStatus), liveBalance, timeLeft, nextMealAt, mealSize }
}

export default function WorldApp() {
  const { address, isConnected, chainId } = useAccount()
  const { switchChain } = useSwitchChain()
  const publicClient = usePublicClient({ chainId: CHAIN_ID })
  const { writeContractAsync } = useWriteContract()
  const yard = useRef<DigitYardApi | null>(null)
  const [viewId, setViewId] = useState<bigint | null>(readPipFromUrl())
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  const [busy, setBusy] = useState<string | null>(null)
  const [feedAmt, setFeedAmt] = useState<'meal' | '3d' | '7d'>('meal')
  const [sayText, setSayText] = useState('')
  const [hatchName, setHatchName] = useState('')
  const [copied, setCopied] = useState('')
  const [activity, setActivity] = useState<Activity[]>([])
  const wrongChain = isConnected && chainId !== CHAIN_ID

  // use chain time, not the device clock: ages and meal timers must match what the contract sees
  const { data: block } = useBlock({ chainId: CHAIN_ID, query: { refetchInterval: 15_000, enabled: IS_CONFIGURED } })
  const chainOffset = useRef(0)
  useEffect(() => {
    if (block?.timestamp) chainOffset.current = Number(block.timestamp) - Math.floor(Date.now() / 1000)
  }, [block?.timestamp])
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000) + chainOffset.current), 1000)
    return () => clearInterval(t)
  }, [])

  // ── global reads ──
  const { data: g, refetch: refetchGlobal } = useReadContracts({
    contracts: [
      { ...W, functionName: 'currentSeason' },
      { ...W, functionName: 'GENESIS' },
      { ...W, functionName: 'SEASON_LENGTH' },
      { ...W, functionName: 'vault' },
      { ...W, functionName: 'hatchMin' },
      { ...W, functionName: 'nextId' },
    ],
    query: { enabled: IS_CONFIGURED, refetchInterval: 30_000 },
  })
  const season = (g?.[0]?.result as bigint | undefined) ?? 1n
  const genesis = Number((g?.[1]?.result as bigint | undefined) ?? 0n)
  const seasonLen = Number((g?.[2]?.result as bigint | undefined) ?? 0n)
  const vaultAddr = g?.[3]?.result as `0x${string}` | undefined
  const hatchMin = (g?.[4]?.result as bigint | undefined) ?? 50_000n
  const seasonEndsIn = genesis && seasonLen ? genesis + Number(season) * seasonLen - now : 0
  const nextId = (g?.[5]?.result as bigint | undefined) ?? 1n

  // explore: read the newest pips by id (logs on a fast chain only reach back a short window)
  const exploreIds = useMemo(() => {
    const ids: bigint[] = []
    for (let i = nextId - 1n; i >= 1n && ids.length < 24; i--) ids.push(i)
    return ids
  }, [nextId])
  const { data: exploreRaw } = useReadContracts({
    contracts: exploreIds.map((id) => ({ ...W, functionName: 'petView', args: [id] })),
    query: { enabled: exploreIds.length > 0, refetchInterval: 30_000 },
  })
  const explore = useMemo(() => {
    const views = exploreIds.map((id, i) => toPetView(id, exploreRaw?.[i]?.result as readonly unknown[] | undefined)).filter(Boolean) as PetView[]
    // living pips first, hungriest first: that's where a visit helps most
    return views.filter((v) => v.liveStatus === 0).sort((a, b) => Number(a.timeLeft - b.timeLeft)).slice(0, 12)
  }, [exploreIds, exploreRaw])

  const { data: vaultBal } = useReadContract({
    address: vaultAddr, abi: VAULT_ABI, functionName: 'totalBalance', chainId: CHAIN_ID,
    query: { enabled: !!vaultAddr, refetchInterval: 30_000 },
  })
  const { data: vaultRenounced } = useReadContract({
    address: vaultAddr, abi: VAULT_ABI, functionName: 'launchRenounced', chainId: CHAIN_ID,
    query: { enabled: !!vaultAddr, refetchInterval: 60_000 },
  })

  // ── my reads ──
  const { data: me, refetch: refetchMe } = useReadContracts({
    contracts: [
      { ...W, functionName: 'activePet', args: [address ?? ZERO] },
      { ...W, functionName: 'pantry', args: [address ?? ZERO] },
      { ...W, functionName: 'petsOf', args: [address ?? ZERO] },
    ],
    query: { enabled: IS_CONFIGURED && !!address, refetchInterval: 15_000 },
  })
  const myActive = (me?.[0]?.result as bigint | undefined) ?? 0n
  const myPantry = (me?.[1]?.result as bigint | undefined) ?? 0n
  const myIds = (me?.[2]?.result as readonly bigint[] | undefined) ?? []

  const { data: myViewsRaw, refetch: refetchMyViews } = useReadContracts({
    contracts: myIds.map((id) => ({ ...W, functionName: 'petView', args: [id] })),
    query: { enabled: myIds.length > 0, refetchInterval: 20_000 },
  })
  const myViews = useMemo(
    () => myIds.map((id, i) => toPetView(id, myViewsRaw?.[i]?.result as readonly unknown[] | undefined)).filter(Boolean) as PetView[],
    [myIds, myViewsRaw],
  )
  const myLiving = myViews.find((v) => v.liveStatus === 0)

  // which pip is on screen: ?pip=ID, else my living pip, else my last pip
  const shownId = viewId ?? (myActive > 0n ? myActive : myIds.length ? myIds[myIds.length - 1] : null)

  const { data: shownRaw, refetch: refetchShown } = useReadContract({
    ...W, functionName: 'petView', args: [shownId ?? 0n],
    query: { enabled: IS_CONFIGURED && shownId !== null, refetchInterval: 10_000 },
  })
  const shown = shownId !== null ? toPetView(shownId, shownRaw as readonly unknown[] | undefined) : null
  const isMine = !!shown && !!address && shown.owner.toLowerCase() === address.toLowerCase()
  const alive = shown?.liveStatus === 0
  const retired = shown?.liveStatus === 2

  // live countdown between refetches
  const fetchedAt = useRef(now)
  useEffect(() => { fetchedAt.current = Math.floor(Date.now() / 1000) + chainOffset.current }, [shownRaw])
  const timeLeft = shown && alive ? Math.max(0, Number(shown.timeLeft) - (now - fetchedAt.current)) : 0
  const mood = moodFromSeconds(!!shown && (alive || retired), retired ? 999_999 : timeLeft)
  const stage = shown?.pet.stage ?? 0
  const hatOn = !!shown && shown.pet.hatId > 0 && Number(shown.pet.hatExpiresAt) > now

  const refreshAll = useCallback(() => {
    void refetchShown(); void refetchMe(); void refetchMyViews(); void refetchGlobal()
  }, [refetchShown, refetchMe, refetchMyViews, refetchGlobal])

  // ── stage-up ceremony when the stage increases while watching ──
  const lastStage = useRef<{ id: bigint | null; stage: number }>({ id: null, stage: -1 })
  useEffect(() => {
    if (!shown) return
    const prev = lastStage.current
    if (prev.id === shown.id && shown.pet.stage > prev.stage && prev.stage >= 0) yard.current?.evolve(STAGE_NAMES[shown.pet.stage])
    lastStage.current = { id: shown.id, stage: shown.pet.stage }
  }, [shown?.id, shown?.pet.stage])

  // ── activity (recent logs for the pip on screen) ──
  const loadLogs = useCallback(async () => {
    if (!publicClient || !IS_CONFIGURED) return
    try {
      const latest = await publicClient.getBlockNumber()
      const fromBlock = latest > 9_000n ? latest - 9_000n : 0n
      if (shownId !== null) {
        const [fed, inter] = await Promise.all([
          publicClient.getContractEvents({ address: WORLD_ADDRESS, abi: WORLD_ABI, eventName: 'Fed', args: { id: shownId }, fromBlock }),
          publicClient.getContractEvents({ address: WORLD_ADDRESS, abi: WORLD_ABI, eventName: 'Interacted', args: { id: shownId }, fromBlock }),
        ])
        const rows: Activity[] = []
        for (const l of fed as unknown as (Log & { args: { feeder: string; amount: bigint; note: string; countedMeal: boolean } })[]) {
          rows.push({ key: `${l.transactionHash}-${l.logIndex}`, who: l.args.feeder, kind: 'FEED', amount: l.args.amount, text: l.args.note, at: Number(l.blockNumber), meal: l.args.countedMeal })
        }
        for (const l of inter as unknown as (Log & { args: { visitor: string; agentName: string; action: number; amount: bigint; text: string } })[]) {
          if (Number(l.args.action) === 1) continue // FEED via interact is already in Fed
          rows.push({ key: `${l.transactionHash}-${l.logIndex}`, who: l.args.agentName || l.args.visitor, kind: ACTIONS[Number(l.args.action)] ?? '?', amount: l.args.amount, text: l.args.text, at: Number(l.blockNumber) })
        }
        rows.sort((a, b) => b.at - a.at)
        setActivity(rows.slice(0, 14))
      }
    } catch { /* RPC log limits: keep what we have */ }
  }, [publicClient, shownId])
  useEffect(() => { void loadLogs() }, [loadLogs])

  // live events for the pip on screen → animations
  useWatchContractEvent({
    address: WORLD_ADDRESS, abi: WORLD_ABI, chainId: CHAIN_ID, eventName: 'Interacted', enabled: IS_CONFIGURED && shownId !== null,
    args: { id: shownId ?? 0n },
    onLogs(logs) {
      for (const l of logs as unknown as { args: { visitor: string; agentName: string; action: number; text: string } }[]) {
        if (address && l.args.visitor.toLowerCase() === address.toLowerCase()) continue
        yard.current?.agentVisit({ name: l.args.agentName || short(l.args.visitor), action: Number(l.args.action), text: l.args.text })
      }
      void refetchShown(); void loadLogs()
    },
  })
  useWatchContractEvent({
    address: WORLD_ADDRESS, abi: WORLD_ABI, chainId: CHAIN_ID, eventName: 'Fed', enabled: IS_CONFIGURED && shownId !== null,
    args: { id: shownId ?? 0n },
    onLogs(logs) {
      for (const l of logs as unknown as { args: { feeder: string; amount: bigint } }[]) {
        if (address && l.args.feeder.toLowerCase() === address.toLowerCase()) continue
        yard.current?.agentVisit({ name: short(l.args.feeder), action: 1 })
      }
      void refetchShown(); void loadLogs()
    },
  })

  // ── transactions ──
  async function send(label: string, fn: () => Promise<`0x${string}`>) {
    if (!publicClient) throw new Error('no client')
    const t = toast.loading(`${label}: confirm in your wallet`)
    try {
      const hash = await fn()
      toast.loading(`${label}: waiting for Arc`, { id: t })
      const r = await publicClient.waitForTransactionReceipt({ hash })
      if (r.status !== 'success') throw new Error('transaction reverted')
      toast.success(`${label}: done`, { id: t })
      return r
    } catch (e) {
      const msg = (e as { shortMessage?: string; message?: string }).shortMessage ?? (e as Error).message
      toast.error(`${label}: ${msg.slice(0, 140)}`, { id: t })
      throw e
    }
  }

  async function ensureAllowance(amount: bigint) {
    if (!publicClient || !address) return
    const allowance = await publicClient.readContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: 'allowance', args: [address, WORLD_ADDRESS] })
    if (allowance >= amount) return
    const target = amount > 2_000_000n ? amount : 2_000_000n // approve up to 2 USDC so you don't sign every meal
    await send('approve USDC', () => writeContractAsync({ address: USDC_ADDRESS, abi: erc20Abi, functionName: 'approve', args: [WORLD_ADDRESS, target], chainId: CHAIN_ID }))
  }

  async function run(label: string, amount: bigint, call: () => Promise<`0x${string}`>, after?: () => void) {
    if (busy) return
    setBusy(label)
    try {
      if (amount > 0n) await ensureAllowance(amount)
      await send(label, call)
      after?.()
      refreshAll()
      void loadLogs()
    } catch { /* toast already shown */ } finally { setBusy(null) }
  }

  const feedAmount = shown ? (feedAmt === 'meal' ? shown.mealSize : feedAmt === '3d' ? shown.mealSize * 3n : shown.mealSize * 7n) : 0n
  const burnPerSec = shown ? Number(shown.mealSize) / 24 / 3600 : 1

  function doFeed() {
    if (!shown) return
    const amt = feedAmount
    void run('feed', amt, () => writeContractAsync({ ...W, functionName: 'feed', args: [shown.id, amt, ''] }), () => {
      yard.current?.feed(Number(amt) / burnPerSec)
    })
  }
  function doInteract(action: 0 | 2 | 3 | 4) {
    if (!shown) return
    const amt = action === 0 ? 100n : action === 2 ? 500n : action === 3 ? 1_000n : 5_000n
    const text = action === 2 ? (sayText.trim() || 'hello pip') : ''
    const hat = action === 4 ? 1 + Math.floor(Math.random() * 5) : 0
    void run(ACTIONS[action].toLowerCase(), amt, () => writeContractAsync({ ...W, functionName: 'interact', args: [shown.id, action, '', text, hat, amt] }), () => {
      if (action === 0) yard.current?.pet()
      if (action === 2) { yard.current?.say(`"${text.toLowerCase()}" — noted.`, 4000); setSayText('') }
      if (action === 3) yard.current?.play()
    })
  }
  function doHatch() {
    const name = hatchName.trim() || 'pip'
    const need = myPantry >= hatchMin ? 0n : hatchMin - myPantry
    void run('hatch', need, () => writeContractAsync({ ...W, functionName: 'hatch', args: [name, need] }), () => {
      setViewId(null)
      setHatchName('')
      try { window.history.replaceState(null, '', window.location.pathname) } catch {}
    })
  }
  function view(id: bigint | null) {
    setViewId(id)
    try {
      const url = id === null ? window.location.pathname : `${window.location.pathname}?pip=${id}`
      window.history.replaceState(null, '', url)
    } catch {}
  }
  function copyLink() {
    if (!shown) return
    const url = `${window.location.origin}${window.location.pathname}?pip=${shown.id}`
    const done = (ok: boolean) => { setCopied(ok ? 'link copied' : url); setTimeout(() => setCopied(''), 4000) }
    try { navigator.clipboard.writeText(url).then(() => done(true), () => done(false)) } catch { done(false) }
  }

  // ── derived UI bits ──
  const lifeCells = 24
  const lifeFilled = alive ? Math.max(1, Math.min(lifeCells, Math.ceil((timeLeft / 3600 / 96) * lifeCells))) : 0
  const ageDays = shown ? ((alive ? now : Number(shown.pet.endedAt)) - Number(shown.pet.bornAt)) / 86400 : 0
  const req = stage < 3 ? GROWTH[stage] : null
  const nextMealIn = shown && shown.nextMealAt > 0n ? Number(shown.nextMealAt) - now : 0
  const canHatch = isConnected && !wrongChain && !myLiving
  // with no pip on screen, show a sleepy mochi as an invitation to hatch one
  const yardView = useMemo(
    () => (shown ? { mood, stage: stage as 0 | 1 | 2 | 3, alive, retired, hat: hatOn } : { mood: 1 as const, stage: 0 as const, alive: true, retired: false, hat: false }),
    [shown === null, mood, stage, alive, retired, hatOn],
  )

  const hudLeft = shown
    ? <>#{String(shown.id)} <b>{shown.pet.name}</b> · {STAGE_NAMES[stage]} · <b>{retired ? 'retired' : MOODS[mood]}</b></>
    : <>season <b>{String(season)}</b></>
  const hudRight = shown ? (alive ? `time left ${fmtDur(timeLeft)}` : retired ? `season ${String(shown.pet.season)} · in the collection` : 'rip') : 'no pip on screen'

  return (
    <div className="pw-app">
      <div className="app">
        <header className="top">
          <div className="logo">pip.exe <small>raise your own pip</small></div>
          <span className="chip"><span className="dot" />{CHAIN_LABEL}</span>
          <span className="chip">season {String(season)}{seasonEndsIn > 0 ? ` · ends in ${fmtDur(seasonEndsIn)}` : ''}</span>
          <span className="spacer" />
          {wrongChain && <button className="btn" type="button" onClick={() => switchChain({ chainId: CHAIN_ID })}>switch to Arc</button>}
          <ConnectKitButton.Custom>
            {({ isConnected: c, show, address: a }) => (
              <button className={`btn wallet${c ? ' on' : ''}`} type="button" onClick={show}>{c ? short(a) : 'connect wallet'}</button>
            )}
          </ConnectKitButton.Custom>
        </header>

        <main className="grid">
          <DigitYard
            ref={yard}
            view={yardView}
            label={shown ? `${shown.pet.name}, a ${STAGE_NAMES[stage]}, ${STATUS_NAMES[shown.liveStatus]}. Drawn entirely from digits. Click it to pet.` : 'pip yard'}
            hud={{ left: hudLeft, right: hudRight }}
            hint="click pip to pet · hold for long pets · move the cursor through the grass"
          >
            {!IS_CONFIGURED && <div className="yard-cta"><span className="note">set VITE_WORLD_ADDRESS to the deployed PipWorld contract</span></div>}
          </DigitYard>

          <aside className="panel">
            {/* hatch / onboarding */}
            {(!shown || canHatch) && (
              <div className="card">
                <h2>{myIds.length ? 'hatch a new egg' : 'hatch your pip'} <span>season {String(season)}</span></h2>
                {!isConnected ? (
                  <p className="empty">connect a wallet on Arc to hatch your own pip. it starts as a tiny mochi, grows with regular meals and friends, and dies for good if nobody feeds it.</p>
                ) : wrongChain ? (
                  <p className="empty">switch your wallet to {CHAIN_LABEL} first.</p>
                ) : (
                  <>
                    <div className="field">
                      <label htmlFor="hatchName">name</label>
                      <input id="hatchName" maxLength={24} placeholder="mochi" value={hatchName} onChange={(e) => setHatchName(e.target.value.replace(/["\\]/g, ''))} />
                    </div>
                    <p className="fine">
                      {myPantry > 0n
                        ? `your pantry has ${fmtUsdc(myPantry)} usdc of leftover food. it becomes the egg's first meal${myPantry >= hatchMin ? ', so hatching is free' : ''}.`
                        : `the egg needs ${fmtUsdc(hatchMin)} usdc of food to hatch (~${Math.round(Number(hatchMin) / 1000)} hours for a mochi).`}
                    </p>
                    <button className="btn primary" type="button" disabled={!!busy} onClick={doHatch}>{busy === 'hatch' ? 'hatching…' : 'hatch'}</button>
                  </>
                )}
              </div>
            )}

            {shown && (
              <div className="card">
                <h2>status <span>{isMine ? 'your pip' : `owner ${short(shown.owner)}`}</span></h2>
                <div className="mood">
                  <span className="word">{retired ? 'retired' : MOODS[mood]}</span>
                  <span className="gen">#{String(shown.id)} {shown.pet.name} · season {String(shown.pet.season)}</span>
                </div>
                {alive && (
                  <div className="lifebar" aria-label="life left">
                    <span className="f">{'8'.repeat(lifeFilled)}</span><span className="e">{'0'.repeat(lifeCells - lifeFilled)}</span>
                  </div>
                )}
                <dl className="stats">
                  <div><dt>time left</dt><dd className="big">{alive ? fmtDur(timeLeft) : retired ? 'season over' : 'dead'}</dd></div>
                  <div><dt>food</dt><dd>{fmtUsdc(shown.liveBalance, 6)} usdc</dd></div>
                  <div><dt>eats</dt><dd>{fmtUsdc(shown.mealSize / 24n, 4)} usdc/h</dd></div>
                  <div><dt>line</dt><dd>{shown.pet.parentId > 0n ? `gen ${String(shown.pet.lineDepth)} · child of #${String(shown.pet.parentId)}` : 'first of its line'}</dd></div>
                </dl>
                {!alive && !retired && <p className="note">this pip is gone for good. it stays in the collection as a tombstone. hatch a new egg to start again.</p>}
                {retired && <p className="note">this pip survived season {String(shown.pet.season)} and is frozen in its final form. its leftover food went to its owner&apos;s pantry for the next egg.</p>}
              </div>
            )}

            {shown && (
              <div className="card">
                <h2>growth <span>{STAGE_NAMES[stage]}</span></h2>
                <div className="stages">
                  {STAGE_NAMES.map((n, i) => <span key={n} className={i === stage ? 'on' : i < stage ? 'done' : ''}>{n}</span>)}
                </div>
                {req && alive ? (
                  <div className="prog">
                    <span className="lbl">meals (≥ {fmtUsdc(shown.mealSize)} usdc, every 8h max)</span>
                    <span className={`val${Number(shown.pet.meals) >= req.meals ? ' ok' : ''}`}>{String(shown.pet.meals)} / {req.meals}</span>
                    <span className="lbl">age</span>
                    <span className={`val${ageDays >= req.minAgeDays ? ' ok' : ''}`}>{ageDays.toFixed(1)} / {req.minAgeDays} days</span>
                    {req.visitors > 0 && <>
                      <span className="lbl">friends (wallets with a pip ≥ 3 days old)</span>
                      <span className={`val${Number(shown.pet.visitors) >= req.visitors ? ' ok' : ''}`}>{String(shown.pet.visitors)} / {req.visitors}</span>
                    </>}
                    <span className="lbl">next counted meal</span>
                    <span className="val">{nextMealIn > 0 ? `in ${fmtDur(nextMealIn)}` : 'now'}</span>
                  </div>
                ) : (
                  <p className="fine">{stage === 3 ? 'radiant: the rarest form a pip can reach in a season.' : `final form: ${STAGE_NAMES[stage]}. meals ${String(shown.pet.meals)}, friends ${String(shown.pet.visitors)}.`}</p>
                )}
              </div>
            )}

            {shown && alive && (
              <div className="card">
                <h2>{isMine ? 'take care of your pip' : `visit ${shown.pet.name}`} <span>usdc</span></h2>
                {wrongChain && <p className="empty">switch to {CHAIN_LABEL} to visit.</p>}
                <div className="row" role="group" aria-label="feed amount">
                  <button className={`amt${feedAmt === 'meal' ? ' sel' : ''}`} type="button" onClick={() => setFeedAmt('meal')}>1 meal · {fmtUsdc(shown.mealSize)}</button>
                  <button className={`amt${feedAmt === '3d' ? ' sel' : ''}`} type="button" onClick={() => setFeedAmt('3d')}>3 days · {fmtUsdc(shown.mealSize * 3n)}</button>
                  <button className={`amt${feedAmt === '7d' ? ' sel' : ''}`} type="button" onClick={() => setFeedAmt('7d')}>7 days · {fmtUsdc(shown.mealSize * 7n)}</button>
                </div>
                <button className="btn primary" type="button" disabled={!isConnected || wrongChain || !!busy} onClick={doFeed}>
                  {busy === 'feed' ? 'feeding…' : nextMealIn > 0 ? `feed (counts as a meal in ${fmtDur(nextMealIn)})` : 'feed (counts as a meal)'}
                </button>
                <div className="acts" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
                  <button className="act pet" type="button" disabled={!isConnected || wrongChain || !!busy} onClick={() => doInteract(0)}><span className="ico">&lt;3</span>pet<span className="p">0.0001</span></button>
                  <button className="act" type="button" disabled={!isConnected || wrongChain || !!busy} onClick={() => doInteract(3)}><span className="ico">^^</span>play<span className="p">0.001</span></button>
                  <button className="act" type="button" disabled={!isConnected || wrongChain || !!busy} onClick={() => doInteract(4)}><span className="ico">/\</span>hat<span className="p">0.005</span></button>
                </div>
                <form className="say" onSubmit={(e) => { e.preventDefault(); doInteract(2) }}>
                  <input id="sayInput" maxLength={120} placeholder="say something kind" value={sayText} onChange={(e) => setSayText(e.target.value)} autoComplete="off" />
                  <button className="btn" type="submit" disabled={!isConnected || wrongChain || !!busy}>say · 0.0005</button>
                </form>
                <p className="fine">
                  {isMine
                    ? 'pip grows from regular care, not from money: a meal counts at most once every 8 hours. big pip needs friends, so share your link.'
                    : 'your visit counts as a friend for this pip if your own pip is alive and at least 3 days old.'}
                  {' '}the first payment asks you to let pip.exe spend up to 2 usdc, so you don&apos;t sign twice for every meal.
                </p>
                <div className="row">
                  <button className="btn" type="button" onClick={copyLink}>share this pip</button>
                  <span className="fine">{copied}</span>
                </div>
              </div>
            )}

            {isConnected && (
              <div className="card">
                <h2>your collection <span>{myViews.length} pip{myViews.length === 1 ? '' : 's'}</span></h2>
                {myViews.length === 0 ? <p className="empty">nothing yet. every pip you hatch stays here: alive, retired at season end, or as a tombstone.</p> : (
                  <ul className="pets">
                    {[...myViews].reverse().map((v) => (
                      <li key={String(v.id)}>
                        <button type="button" className={shown?.id === v.id ? 'on' : ''} onClick={() => view(v.id)}>
                          <span>#{String(v.id)} {v.pet.name}</span>
                          <span className={`pill ${STATUS_NAMES[v.liveStatus]}`}>{STATUS_NAMES[v.liveStatus]}</span>
                          <span className="sub">season {String(v.pet.season)} · {STAGE_NAMES[v.pet.stage]} · {String(v.pet.meals)} meals · {String(v.pet.visitors)} friends</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {myPantry > 0n && <p className="fine">pantry: {fmtUsdc(myPantry)} usdc saved for your next egg</p>}
              </div>
            )}

            <div className="card">
              <h2>visit other pips <span>friends help them grow</span></h2>
              {explore.length === 0 ? <p className="empty">no living pips yet. be the first.</p> : (
                <ul className="pets">
                  {explore.map((v) => (
                    <li key={String(v.id)}>
                      <button type="button" className={shown?.id === v.id ? 'on' : ''} onClick={() => view(v.id)}>
                        <span>#{String(v.id)} {v.pet.name}</span>
                        <span className={`pill ${Number(v.timeLeft) < 6 * 3600 ? 'dead' : 'alive'}`}>{Number(v.timeLeft) < 6 * 3600 ? 'hungry' : fmtDur(Number(v.timeLeft))}</span>
                        <span className="sub">{STAGE_NAMES[v.pet.stage]} · {short(v.owner)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {viewId !== null && <button type="button" className="link" onClick={() => view(null)}>back to my pip</button>}
            </div>

            {shown && (
              <div className="card">
                <h2>activity <span>#{String(shown.id)} · recent</span></h2>
                {activity.length === 0 ? <p className="empty">no visits yet.</p> : (
                  <ul className="log">
                    {activity.map((a) => (
                      <li key={a.key}>
                        <span className={`who${address && a.who.toLowerCase() === address.toLowerCase() ? ' you' : ''}`}>{a.who.startsWith('0x') ? short(a.who) : a.who}</span>
                        <span className="what"><b>{a.kind}</b> {fmtUsdc(a.amount)} usdc{a.meal ? ' · meal' : ''}{a.text ? ` · "${a.text}"` : ''}</span>
                        <span className="ago">#{a.at}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div className="card">
              <h2>pip&apos;s vault <span>90% of every crumb</span></h2>
              <div className="love"><span className="num">{vaultBal !== undefined ? fmtUsdc(vaultBal as bigint, 4) : '—'}</span><span className="fine">usdc · nobody can withdraw it, not even us</span></div>
              <p className="fine">
                every pip burns its food over time. 90% of it goes to this vault, 10% to the operator. the vault has no withdraw function.
                {vaultRenounced
                  ? ' its launch path is renounced: it can only ever feed pips.'
                  : ' its funds can leave only to a contract the owner announces onchain 14 days in advance, or feed pips after a year. the owner can renounce that path forever.'}
                {vaultAddr && explorerAddr(vaultAddr) && <> <a className="link" href={explorerAddr(vaultAddr)} target="_blank" rel="noreferrer">check the contract</a></>}
              </p>
            </div>

            <div className="card">
              <h2>for agents <span>/agents.md</span></h2>
              <div className="prompt">go to /agents.md and visit a pip: call interact(id, 0, "your-name", "hello", 0, 100) on PipWorld {short(WORLD_ADDRESS)} after approving 100 USDC micros.</div>
            </div>
          </aside>
        </main>
      </div>
    </div>
  )
}
