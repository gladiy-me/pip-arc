/**
 * Scrolling feed log — shows Fed and Died events
 */

import { useEffect, useRef, useState } from 'react'
import { usePublicClient, useWatchContractEvent } from 'wagmi'
import { PIP_ADDRESS, PIP_ABI, ACTIVE_CHAIN_ID } from '../pip-contract'
import { buildTxExplorerUrl } from '@/onchain-facts'

interface LogEntry {
  type: 'fed' | 'died'
  feeder?: string
  amount?: bigint
  note?: string
  gen?: bigint
  txHash?: string
  ts: number
}

function shortAddr(addr: string): string {
  return addr.slice(0, 6) + '..' + addr.slice(-4)
}

function formatUsdc(raw: bigint): string {
  const whole = raw / 1_000_000n
  const frac = raw % 1_000_000n
  const fracStr = frac.toString().padStart(6, '0').replace(/0+$/, '') || '0'
  return `${whole}.${fracStr.slice(0, 4)}`
}

interface FeedLogProps {
  contractAddress?: string
}

export function FeedLog({ contractAddress }: FeedLogProps) {
  const [entries, setEntries] = useState<LogEntry[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)
  const publicClient = usePublicClient({ chainId: ACTIVE_CHAIN_ID })

  // Load historical events on mount
  useEffect(() => {
    if (!publicClient || !contractAddress) return

    const addr = contractAddress as `0x${string}`

    const loadFed = publicClient.getContractEvents({
      address: addr,
      abi: PIP_ABI,
      eventName: 'Fed',
      fromBlock: 'earliest',
    }).catch(() => [] as unknown[])

    const loadDied = publicClient.getContractEvents({
      address: addr,
      abi: PIP_ABI,
      eventName: 'Died',
      fromBlock: 'earliest',
    }).catch(() => [] as unknown[])

    void Promise.all([loadFed, loadDied]).then(([fedEvents, diedEvents]) => {
      const all: LogEntry[] = []

      for (const ev of fedEvents as { args?: Record<string, unknown>; transactionHash?: string }[]) {
        const a = ev.args ?? {}
        all.push({
          type: 'fed',
          feeder: a['feeder'] as string | undefined,
          amount: a['amount'] as bigint | undefined,
          note: a['note'] as string | undefined,
          gen: a['gen'] as bigint | undefined,
          txHash: ev.transactionHash ?? undefined,
          ts: 0,
        })
      }
      for (const ev of diedEvents as { args?: Record<string, unknown>; transactionHash?: string }[]) {
        const a = ev.args ?? {}
        all.push({
          type: 'died',
          feeder: a['lastFeeder'] as string | undefined,
          amount: a['totalFed'] as bigint | undefined,
          gen: a['gen'] as bigint | undefined,
          txHash: ev.transactionHash ?? undefined,
          ts: 0,
        })
      }

      setEntries(all.slice(-50))
    })
  }, [publicClient, contractAddress])

  // Watch live events
  useWatchContractEvent({
    address: PIP_ADDRESS,
    abi: PIP_ABI,
    eventName: 'Fed',
    chainId: ACTIVE_CHAIN_ID,
    onLogs(logs) {
      for (const log of logs as { args?: Record<string, unknown>; transactionHash?: string }[]) {
        const a = log.args ?? {}
        setEntries(prev => [...prev.slice(-49), {
          type: 'fed',
          feeder: a['feeder'] as string | undefined,
          amount: a['amount'] as bigint | undefined,
          note: a['note'] as string | undefined,
          gen: a['gen'] as bigint | undefined,
          txHash: log.transactionHash ?? undefined,
          ts: Date.now(),
        }])
      }
    },
  })

  useWatchContractEvent({
    address: PIP_ADDRESS,
    abi: PIP_ABI,
    eventName: 'Died',
    chainId: ACTIVE_CHAIN_ID,
    onLogs(logs) {
      for (const log of logs as { args?: Record<string, unknown>; transactionHash?: string }[]) {
        const a = log.args ?? {}
        setEntries(prev => [...prev.slice(-49), {
          type: 'died',
          feeder: a['lastFeeder'] as string | undefined,
          gen: a['gen'] as bigint | undefined,
          ts: Date.now(),
        }])
      }
    },
  })

  // Auto-scroll on new entries
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [entries])

  if (entries.length === 0) {
    return (
      <div className="font-mono text-xs text-[#a78bfa]/40 space-y-1">
        <div className="text-[#a78bfa] text-[10px] tracking-widest">[ FEED LOG ]</div>
        <div className="text-[10px]">no feeding events yet. be the first!</div>
      </div>
    )
  }

  return (
    <div className="font-mono text-xs space-y-1">
      <div className="text-[#a78bfa] text-[10px] tracking-widest">[ FEED LOG ]</div>
      <div ref={scrollRef} className="max-h-32 overflow-y-auto space-y-0.5 pr-1">
        {entries.map((e, i) => (
          <div key={i} className="text-[10px] leading-relaxed">
            {e.type === 'fed' && (
              <span>
                <span className="text-[#a78bfa]/50">&gt; </span>
                {e.txHash ? (
                  <a
                    href={buildTxExplorerUrl(ACTIVE_CHAIN_ID, e.txHash)}
                    target="_blank"
                    rel="noopener"
                    className="text-[#a7f3d0] hover:underline"
                  >
                    {shortAddr(e.feeder ?? '0x0000000000000000000000000000000000000000')}
                  </a>
                ) : (
                  <span className="text-[#a7f3d0]">{shortAddr(e.feeder ?? '0x0000000000000000000000000000000000000000')}</span>
                )}
                <span className="text-[#e2d9f3]"> fed </span>
                <span className="text-[#f0c4d4] tabular-nums">{formatUsdc(e.amount ?? 0n)} usdc</span>
                {e.note && e.note.length > 0 && (
                  <span className="text-[#a78bfa]/70">: &quot;{e.note.slice(0, 50)}&quot;</span>
                )}
              </span>
            )}
            {e.type === 'died' && (
              <span>
                <span className="text-[#a78bfa]/50">&gt; </span>
                <span className="text-[#f87171]">pip gen #{e.gen?.toString()} has died. rip.</span>
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
