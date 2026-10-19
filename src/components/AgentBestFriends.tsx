/**
 * Agent best friends board — top 5 visitors by spend this generation
 */

interface AgentBestFriendsProps {
  addrs: readonly (`0x${string}` | undefined)[]
  names: readonly (string | undefined)[]
  amounts: readonly (bigint | undefined)[]
}

function shortAddr(addr: string): string {
  if (!addr || addr === '0x0000000000000000000000000000000000000000') return null as unknown as string
  return addr.slice(0, 6) + '..' + addr.slice(-4)
}

function formatUsdc(raw: bigint): string {
  const whole = raw / 1_000_000n
  const frac  = raw % 1_000_000n
  const s     = frac.toString().padStart(6, '0').replace(/0+$/, '') || '0'
  return `${whole}.${s.slice(0, 4)}`
}

const RANKS = ['#1', '#2', '#3', '#4', '#5']
const RANK_COLORS = ['#fde68a', '#e2d9f3', '#f0c4d4', '#a78bfa', '#a7f3d0']

export function AgentBestFriends({ addrs, names, amounts }: AgentBestFriendsProps) {
  const pairs = addrs
    .map((addr, i) => ({ addr, name: names[i] ?? '', amount: amounts[i] ?? 0n }))
    .filter(p => p.addr && p.addr !== '0x0000000000000000000000000000000000000000' && p.amount > 0n)

  if (pairs.length === 0) {
    return (
      <div className="font-mono text-xs space-y-1">
        <div className="text-[#a78bfa] text-[10px] tracking-widest">[ AGENT BEST FRIENDS ]</div>
        <div className="text-[10px] text-[#a78bfa]/40">
          no agents yet. send yours!
        </div>
      </div>
    )
  }

  return (
    <div className="font-mono text-xs space-y-1">
      <div className="text-[#a78bfa] text-[10px] tracking-widest">[ AGENT BEST FRIENDS ]</div>
      {pairs.map((p, i) => (
        <div key={i} className="flex items-baseline gap-2 text-[10px]">
          <span style={{ color: RANK_COLORS[i] }} className="tabular-nums w-5 shrink-0">{RANKS[i]}</span>
          <span className="text-[#a7f3d0] truncate min-w-0 flex-1">
            {p.name ? (
              <span>{p.name.slice(0, 18)}<span className="text-[#a78bfa]/40 text-[9px] ml-1">({shortAddr(p.addr!)})</span></span>
            ) : (
              shortAddr(p.addr!)
            )}
          </span>
          <span className="text-[#f0c4d4] tabular-nums shrink-0">{formatUsdc(p.amount)} usdc</span>
        </div>
      ))}
    </div>
  )
}
