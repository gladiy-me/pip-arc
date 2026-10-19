/**
 * "visit pip" card: 5 onchain actions with live min prices, feed amount chips, say input.
 * Uses the approve → feed() / interact() flow from usePipTx. Clicking pip in the yard
 * never reaches this code (local-only), so no wallet popups from the canvas.
 */
import { useState } from 'react'
import { useReadContracts } from 'wagmi'
import { useModal } from 'connectkit'
import { PIP_ABI, PIP_ADDRESS, ACTIVE_CHAIN_ID, DEFAULT_MIN_PRICES, MIN_FEED_AMOUNT, IS_MAINNET } from '../pip-contract'
import { fmtDur } from '../digit-yard'
import { usePipTx, type PipTxCallbacks } from '../hooks/usePipTx'
import type { ActionId } from '../visit-types'

const PIP = { address: PIP_ADDRESS, abi: PIP_ABI, chainId: ACTIVE_CHAIN_ID } as const
const FEED_CHIPS = [1_000n, 10_000n, 100_000n, 1_000_000n]

export function fmtMicros(v: bigint): string {
  const n = Number(v) / 1_000_000
  if (n >= 1) return n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '.0')
  return n.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')
}

interface VisitPanelProps extends PipTxCallbacks {
  burnRatePerHour: bigint
}

const ACTS: { id: ActionId; label: string; ico: string; cls: string }[] = [
  { id: 0, label: 'pet',  ico: '<3',  cls: 'pet' },
  { id: 1, label: 'feed', ico: '$',   cls: 'feed' },
  { id: 2, label: 'say',  ico: '""', cls: '' },
  { id: 3, label: 'play', ico: '^^',  cls: '' },
  { id: 4, label: 'hat',  ico: '/\\', cls: '' },
]

export function VisitPanel({ burnRatePerHour, onSubmitted, onSuccess }: VisitPanelProps) {
  const { setOpen } = useModal()
  const { run, step, busy, isConnected, wrongChain } = usePipTx({ onSubmitted, onSuccess })
  const [feedAmt, setFeedAmt] = useState<bigint>(10_000n)
  const [text, setText] = useState('')

  const { data } = useReadContracts({
    contracts: [
      { ...PIP, functionName: 'minPet' },
      { ...PIP, functionName: 'minFeedAgent' },
      { ...PIP, functionName: 'minSay' },
      { ...PIP, functionName: 'minPlay' },
      { ...PIP, functionName: 'minGiftHat' },
      { ...PIP, functionName: 'minFeed' },
    ],
    query: { refetchInterval: 60_000 },
  })
  const prices = DEFAULT_MIN_PRICES.map((d, i) => (data?.[i]?.result as bigint | undefined) ?? d)
  const minFeed = (data?.[5]?.result as bigint | undefined) ?? MIN_FEED_AMOUNT
  const amount = feedAmt < minFeed ? minFeed : feedAmt
  const textBytes = new TextEncoder().encode(text).length

  function act(id: ActionId) {
    if (!isConnected) { setOpen(true); return }
    if (busy) return
    const t = text.trim()
    if (id === 1) {
      if (textBytes > 80) return
      void run({ kind: 'feed', action: 1, amount, text: t }).then(() => setText(''))
    } else {
      if (textBytes > 120) return
      const say = id === 2 ? (t || 'hello pip') : ''
      void run({ kind: 'interact', action: id, amount: prices[id], text: say, hatId: id === 4 ? 1 : 0 })
        .then(() => { if (id === 2) setText('') })
    }
  }

  const status =
    !isConnected ? 'connect a wallet to visit pip onchain. petting pip in the yard is free.'
    : step === 'switching' ? `switching to ${IS_MAINNET ? 'arc mainnet' : 'arc testnet'}…`
    : step === 'approve-sign' ? 'approve usdc in your wallet…'
    : step === 'approving' ? 'approving usdc…'
    : step === 'sign' ? 'confirm in your wallet…'
    : step === 'confirming' ? 'waiting for the chain…'
    : wrongChain ? `wrong network. the first action switches to ${IS_MAINNET ? 'arc mainnet' : 'arc testnet'}.`
    : ''

  const lifePerCent = burnRatePerHour > 0n ? Number(10_000n * 3600n / burnRatePerHour) : 0

  return (
    <div className="card">
      <h2>visit pip <span>min price, usdc</span></h2>
      <div className="acts">
        {ACTS.map(a => (
          <button
            key={a.id}
            type="button"
            className={`act ${a.cls}`}
            disabled={busy}
            onClick={() => act(a.id)}
            aria-label={`${a.label} pip for ${fmtMicros(a.id === 1 ? amount : prices[a.id])} usdc`}
          >
            <span className="ico">{a.ico}</span>{a.label}
            <span className="p">{fmtMicros(a.id === 1 ? amount : prices[a.id])}</span>
          </button>
        ))}
      </div>
      <div className="row" role="group" aria-label="feed amount">
        <span className="fine">feed amount</span>
        {FEED_CHIPS.filter(v => v >= minFeed).map(v => (
          <button key={v.toString()} type="button" className={`amt${amount === v ? ' sel' : ''}`} onClick={() => setFeedAmt(v)}>
            {fmtMicros(v)}
          </button>
        ))}
      </div>
      <form className="say" onSubmit={e => { e.preventDefault(); if (text.trim()) act(2) }}>
        <input
          value={text}
          onChange={e => setText(e.target.value)}
          maxLength={120}
          placeholder="say something kind (120 chars)"
          autoComplete="off"
          aria-label="message for pip"
        />
        <button className="btn" type="submit" disabled={busy || !text.trim()}>say</button>
      </form>
      {textBytes > 80 && <p className="fine warn">feed notes are max 80 bytes (say allows 120).</p>}
      {status && <p className="fine status" role="status">{status}</p>}
      <p className="fine">
        0.01 usdc keeps pip alive for {lifePerCent ? fmtDur(lifePerCent) : '…'}. every payment goes into pip's balance and burns as metabolism.
        the text box is your SAY message, and your note when you feed.
      </p>
    </div>
  )
}
