/**
 * Top 5 feeders this generation — pip's best friends
 */
import { fmtMicros } from './VisitPanel'

interface TopFeedersProps {
  feeders: readonly (`0x${string}` | undefined)[]
  amounts: readonly (bigint | undefined)[]
}

const ZERO = '0x0000000000000000000000000000000000000000'

export function TopFeeders({ feeders, amounts }: TopFeedersProps) {
  const pairs = feeders
    .map((addr, i) => ({ addr, amount: amounts[i] ?? 0n }))
    .filter(p => p.addr && p.addr !== ZERO && p.amount > 0n)

  if (pairs.length === 0) return <p className="fine">no feeders yet this generation</p>
  return (
    <ul className="log">
      {pairs.map((p, i) => (
        <li key={i}>
          <span className="who">#{i + 1} {p.addr!.slice(0, 6)}..{p.addr!.slice(-4)}</span>
          <span className="what" />
          <span className="ago">{fmtMicros(p.amount)} usdc</span>
        </li>
      ))}
    </ul>
  )
}
