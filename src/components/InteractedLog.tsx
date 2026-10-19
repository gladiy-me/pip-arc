/**
 * Live event listener for Interacted events — feeds the visit queue
 */

import { useEffect, useRef } from 'react'
import { usePublicClient, useWatchContractEvent } from 'wagmi'
import { PIP_ADDRESS, PIP_ABI, ACTIVE_CHAIN_ID } from '../pip-contract'
import type { VisitEvent, ActionId } from './YardScene'

interface InteractedLogProps {
  onVisit: (v: VisitEvent) => void
  /** called when a Fed event happens so the existing FeedLog can handle it too */
  onFed?: (feeder: string, amount: bigint, note: string, txHash?: string) => void
}

let counter = 0

export function InteractedLog({ onVisit, onFed }: InteractedLogProps) {
  const publicClient = usePublicClient({ chainId: ACTIVE_CHAIN_ID })
  const loaded = useRef(false)

  // Load historical Interacted events on mount
  useEffect(() => {
    if (!publicClient || loaded.current) return
    loaded.current = true

    void publicClient.getContractEvents({
      address: PIP_ADDRESS,
      abi: PIP_ABI,
      eventName: 'Interacted',
      fromBlock: 'earliest',
    }).then(events => {
      for (const ev of events as { args?: Record<string, unknown>; transactionHash?: string }[]) {
        const a = ev.args ?? {}
        onVisit({
          id: `hist-${counter++}`,
          agentName: (a['agentName'] as string | undefined) ?? '?',
          action: (Number(a['action'] ?? 0) as ActionId),
          text: (a['text'] as string | undefined) ?? '',
          hatId: Number(a['hatId'] ?? 0),
          amount: (a['amount'] as bigint | undefined) ?? 0n,
          txHash: ev.transactionHash ?? undefined,
          ts: 0,
        })
      }
    }).catch(() => {/* ignore */})

    // Also load historical Fed events (human feeds)
    void publicClient.getContractEvents({
      address: PIP_ADDRESS,
      abi: PIP_ABI,
      eventName: 'Fed',
      fromBlock: 'earliest',
    }).then(events => {
      for (const ev of events as { args?: Record<string, unknown>; transactionHash?: string }[]) {
        const a = ev.args ?? {}
        onFed?.(
          (a['feeder'] as string | undefined) ?? '0x',
          (a['amount'] as bigint | undefined) ?? 0n,
          (a['note'] as string | undefined) ?? '',
          ev.transactionHash ?? undefined,
        )
        // Also emit as a visit so it appears in the yard
        onVisit({
          id: `fed-hist-${counter++}`,
          agentName: (a['feeder'] as string | undefined) ?? '0x',
          action: 1,
          text: (a['note'] as string | undefined) ?? '',
          amount: (a['amount'] as bigint | undefined) ?? 0n,
          txHash: ev.transactionHash ?? undefined,
          ts: 0,
          isHuman: true,
        })
      }
    }).catch(() => {/* ignore */})
  }, [publicClient, onVisit, onFed])

  // Watch live Interacted events
  useWatchContractEvent({
    address: PIP_ADDRESS,
    abi: PIP_ABI,
    eventName: 'Interacted',
    chainId: ACTIVE_CHAIN_ID,
    onLogs(logs) {
      for (const log of logs as { args?: Record<string, unknown>; transactionHash?: string }[]) {
        const a = log.args ?? {}
        onVisit({
          id: `live-${counter++}`,
          agentName: (a['agentName'] as string | undefined) ?? '?',
          action: (Number(a['action'] ?? 0) as ActionId),
          text: (a['text'] as string | undefined) ?? '',
          hatId: Number(a['hatId'] ?? 0),
          amount: (a['amount'] as bigint | undefined) ?? 0n,
          txHash: log.transactionHash ?? undefined,
          ts: Date.now(),
        })
      }
    },
  })

  // Watch live Fed events
  useWatchContractEvent({
    address: PIP_ADDRESS,
    abi: PIP_ABI,
    eventName: 'Fed',
    chainId: ACTIVE_CHAIN_ID,
    onLogs(logs) {
      for (const log of logs as { args?: Record<string, unknown>; transactionHash?: string }[]) {
        const a = log.args ?? {}
        const feeder = (a['feeder'] as string | undefined) ?? '0x'
        const amount = (a['amount'] as bigint | undefined) ?? 0n
        const note   = (a['note'] as string | undefined) ?? ''
        onFed?.(feeder, amount, note, log.transactionHash ?? undefined)
        onVisit({
          id: `fed-live-${counter++}`,
          agentName: feeder,
          action: 1,
          text: note,
          amount,
          txHash: log.transactionHash ?? undefined,
          ts: Date.now(),
          isHuman: true,
        })
      }
    },
  })

  return null
}
