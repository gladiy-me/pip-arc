/**
 * Event listener (renders nothing): backfills Interacted / Fed history (ts: 0, never animated)
 * and watches live Interacted, Fed, Died, Hatched events.
 */

import { useEffect, useRef } from 'react'
import { usePublicClient, useWatchContractEvent } from 'wagmi'
import { PIP_ADDRESS, PIP_ABI, ACTIVE_CHAIN_ID } from '../pip-contract'
import type { VisitEvent, ActionId } from '../visit-types'

interface InteractedLogProps {
  onVisit: (v: VisitEvent) => void
  /** called when a Fed event happens so the existing FeedLog can handle it too */
  onFed?: (feeder: string, amount: bigint, note: string, txHash?: string) => void
  /** live only */
  onDied?: (gen: bigint) => void
  /** live only */
  onHatched?: (gen: bigint) => void
}

type RawLog = { args?: Record<string, unknown>; transactionHash?: string | null }

let counter = 0

function interactedToVisit(log: RawLog, live: boolean): VisitEvent {
  const a = log.args ?? {}
  return {
    id: `${live ? 'live' : 'hist'}-${counter++}`,
    agentName: (a['agentName'] as string | undefined) ?? '?',
    action: (Number(a['action'] ?? 0) as ActionId),
    text: (a['text'] as string | undefined) ?? '',
    hatId: Number(a['hatId'] ?? 0),
    amount: (a['amount'] as bigint | undefined) ?? 0n,
    txHash: log.transactionHash ?? undefined,
    ts: live ? Date.now() : 0,
    wallet: a['visitor'] as string | undefined,
    gen: a['gen'] as bigint | undefined,
    timeLeft: a['timeLeft'] as bigint | undefined,
  }
}

function fedToVisit(log: RawLog, live: boolean): VisitEvent {
  const a = log.args ?? {}
  return {
    id: `fed-${live ? 'live' : 'hist'}-${counter++}`,
    agentName: (a['feeder'] as string | undefined) ?? '0x',
    action: 1,
    text: (a['note'] as string | undefined) ?? '',
    amount: (a['amount'] as bigint | undefined) ?? 0n,
    txHash: log.transactionHash ?? undefined,
    ts: live ? Date.now() : 0,
    isHuman: true,
    wallet: a['feeder'] as string | undefined,
    gen: a['gen'] as bigint | undefined,
    timeLeft: a['timeLeftSeconds'] as bigint | undefined,
  }
}

export function InteractedLog({ onVisit, onFed, onDied, onHatched }: InteractedLogProps) {
  const publicClient = usePublicClient({ chainId: ACTIVE_CHAIN_ID })
  const loaded = useRef(false)

  // Load historical Interacted + Fed events on mount (ts: 0 → never animated)
  useEffect(() => {
    if (!publicClient || loaded.current) return
    loaded.current = true

    void publicClient.getContractEvents({
      address: PIP_ADDRESS,
      abi: PIP_ABI,
      eventName: 'Interacted',
      fromBlock: 'earliest',
    }).then(events => {
      for (const ev of events as RawLog[]) onVisit(interactedToVisit(ev, false))
    }).catch(() => {/* ignore */})

    void publicClient.getContractEvents({
      address: PIP_ADDRESS,
      abi: PIP_ABI,
      eventName: 'Fed',
      fromBlock: 'earliest',
    }).then(events => {
      for (const ev of events as RawLog[]) {
        const v = fedToVisit(ev, false)
        onFed?.(v.agentName, v.amount, v.text, v.txHash)
        onVisit(v)
      }
    }).catch(() => {/* ignore */})
  }, [publicClient, onVisit, onFed])

  useWatchContractEvent({
    address: PIP_ADDRESS,
    abi: PIP_ABI,
    eventName: 'Interacted',
    chainId: ACTIVE_CHAIN_ID,
    onLogs(logs) {
      for (const log of logs as RawLog[]) onVisit(interactedToVisit(log, true))
    },
  })

  useWatchContractEvent({
    address: PIP_ADDRESS,
    abi: PIP_ABI,
    eventName: 'Fed',
    chainId: ACTIVE_CHAIN_ID,
    onLogs(logs) {
      for (const log of logs as RawLog[]) {
        const v = fedToVisit(log, true)
        onFed?.(v.agentName, v.amount, v.text, v.txHash)
        onVisit(v)
      }
    },
  })

  useWatchContractEvent({
    address: PIP_ADDRESS,
    abi: PIP_ABI,
    eventName: 'Died',
    chainId: ACTIVE_CHAIN_ID,
    onLogs(logs) {
      for (const log of logs as RawLog[]) onDied?.((log.args?.['gen'] as bigint | undefined) ?? 0n)
    },
  })

  useWatchContractEvent({
    address: PIP_ADDRESS,
    abi: PIP_ABI,
    eventName: 'Hatched',
    chainId: ACTIVE_CHAIN_ID,
    onLogs(logs) {
      for (const log of logs as RawLog[]) onHatched?.((log.args?.['gen'] as bigint | undefined) ?? 0n)
    },
  })

  return null
}
