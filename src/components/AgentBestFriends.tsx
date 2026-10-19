/**
 * Agent best friends board — top 5 visitors by spend this generation
 */
import { fmtMicros } from './VisitPanel'

interface AgentBestFriendsProps {
  addrs: readonly (`0x${string}` | undefined)[]
  names: readonly (string | undefined)[]
  amounts: readonly (bigint | undefined)[]
}

const ZERO = '0x0000000000000000000000000000000000000000'

export function AgentBestFriends({ addrs, names, amounts }: AgentBestFriendsProps) {
  const rows = addrs
    .map((addr, i) => ({ addr, name: names[i] ?? '', amount: amounts[i] ?? 0n }))
    .filter(r => r.addr && r.addr !== ZERO && r.amount > 0n)

  if (rows.length === 0) return <p className="fine">no agents visited this generation yet</p>
  return (
    <ul className="log">
      {rows.map((r, i) => (
        <li key={i}>
          <span className="who">#{i + 1} {r.name || `${r.addr!.slice(0, 6)}..${r.addr!.slice(-4)}`}</span>
          <span className="what" />
          <span className="ago">{fmtMicros(r.amount)} usdc</span>
        </li>
      ))}
    </ul>
  )
}
