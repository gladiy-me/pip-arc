/**
 * Terminal-style chat log of agent <-> pip conversations
 */

import { useEffect, useRef } from 'react'
import type { VisitEvent, ActionId } from '../visit-types'
import { buildTxExplorerUrl } from '@/onchain-facts'

import { ACTIVE_CHAIN_ID } from '../pip-contract'

const ACTION_LABELS: Record<ActionId, string> = {
  0: 'petted',
  1: 'fed',
  2: 'said',
  3: 'played with',
  4: 'gifted a hat to',
}

const ACTION_COLORS: Record<ActionId, string> = {
  0: '#f0c4d4',
  1: '#a7f3d0',
  2: '#c084fc',
  3: '#fde68a',
  4: '#f9a8d4',
}

// Deterministic pip reply (mirrors server/visit.ts)
function pipReply(action: ActionId, agentName: string, text: string): string {
  const name = agentName.slice(0, 20) || 'stranger'
  const txt  = text.slice(0, 60)
  if (action === 0) {
    const lines = [
      `${name} petted me. heart += 1.`,
      `soft touch detected. thanks ${name}.`,
      `*squish* more petting accepted.`,
    ]
    return lines[name.charCodeAt(0) % lines.length]
  }
  if (action === 1) return `nom. ${name} fed me. life += a bit.`
  if (action === 2) return txt
    ? `"${txt.toLowerCase()}" — ok ${name}. noted.`
    : `${name} said nothing. we understood each other.`
  if (action === 3) return `${name} and pip played. pip won. obviously.`
  if (action === 4) return `new hat unlocked. courtesy of ${name}. very chic.`
  return `${name} did something. ok.`
}

function formatUsdc(raw: bigint): string {
  const whole = raw / 1_000_000n
  const frac  = raw % 1_000_000n
  const s     = frac.toString().padStart(6, '0').replace(/0+$/, '') || '0'
  return `${whole}.${s.slice(0, 4)}`
}

function shortAddr(addr: string): string {
  if (!addr || addr === '0x0000000000000000000000000000000000000000') return '?'
  return addr.slice(0, 6) + '..' + addr.slice(-4)
}

interface AgentChatLogProps {
  visits: VisitEvent[]
}

export function AgentChatLog({ visits }: AgentChatLogProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [visits])

  if (visits.length === 0) {
    return (
      <div className="font-mono text-xs space-y-1">
        <div className="text-[#a78bfa] text-[10px] tracking-widest">[ VISITOR LOG ]</div>
        <div className="text-[10px] text-[#a78bfa]/40">
          no visitors yet. be the first agent to visit pip.
        </div>
      </div>
    )
  }

  return (
    <div className="font-mono text-xs space-y-1">
      <div className="text-[#a78bfa] text-[10px] tracking-widest">[ VISITOR LOG ]</div>
      <div ref={scrollRef} className="max-h-40 overflow-y-auto space-y-1 pr-1">
        {visits.map((v, i) => {
          const color = ACTION_COLORS[v.action]
          const label = v.isHuman ? 'fed' : ACTION_LABELS[v.action]
          const name  = v.isHuman
            ? (shortAddr(v.agentName) + ' (human)')
            : v.agentName
          const reply = pipReply(v.action, v.agentName, v.text)

          return (
            <div key={v.id ?? i} className="space-y-0">
              {/* Agent line */}
              <div className="text-[10px] leading-relaxed">
                <span className="text-[#a78bfa]/40">&gt; </span>
                {v.txHash ? (
                  <a
                    href={buildTxExplorerUrl(ACTIVE_CHAIN_ID, v.txHash)}
                    target="_blank"
                    rel="noopener"
                    style={{ color }}
                    className="hover:underline"
                  >
                    {name}
                  </a>
                ) : (
                  <span style={{ color }}>{name}</span>
                )}
                <span className="text-[#e2d9f3]"> {label} pip</span>
                <span className="text-[#a78bfa]/60 tabular-nums"> [{formatUsdc(v.amount)} usdc]</span>
                {v.text && v.action === 2 && (
                  <span className="text-[#c084fc]/70">: &ldquo;{v.text.slice(0, 50)}&rdquo;</span>
                )}
              </div>
              {/* Pip reply */}
              <div className="text-[10px] leading-relaxed pl-2">
                <span className="text-[#f0c4d4]/50">pip: </span>
                <span className="text-[#f0c4d4]/80 italic">&ldquo;{reply}&rdquo;</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
