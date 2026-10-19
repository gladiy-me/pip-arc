/**
 * Top 5 feeders this generation — pip's best friends
 */

interface TopFeedersProps {
  feeders: readonly (`0x${string}` | undefined)[]
  amounts: readonly (bigint | undefined)[]
}

function shortAddr(addr: string): string {
  if (!addr || addr === '0x0000000000000000000000000000000000000000') return null as unknown as string
  return addr.slice(0, 6) + '..' + addr.slice(-4)
}

function formatUsdc(raw: bigint): string {
  const whole = raw / 1_000_000n
  const frac = raw % 1_000_000n
  const fracStr = frac.toString().padStart(6, '0').replace(/0+$/, '') || '0'
  return `${whole}.${fracStr.slice(0, 4)}`
}

const MEDALS = ['#1', '#2', '#3', '#4', '#5']

export function TopFeeders({ feeders, amounts }: TopFeedersProps) {
  const pairs = feeders
    .map((addr, i) => ({ addr, amount: amounts[i] ?? 0n }))
    .filter(p => p.addr && p.addr !== '0x0000000000000000000000000000000000000000' && p.amount > 0n)

  if (pairs.length === 0) {
    return (
      <div className="font-mono text-xs space-y-1">
        <div className="text-[#a78bfa] text-[10px] tracking-widest">[ BEST FRIENDS ]</div>
        <div className="text-[10px] text-[#a78bfa]/40">no feeders yet this generation</div>
      </div>
    )
  }

  return (
    <div className="font-mono text-xs space-y-1">
      <div className="text-[#a78bfa] text-[10px] tracking-widest">[ BEST FRIENDS ]</div>
      {pairs.map((p, i) => (
        <div key={i} className="flex justify-between text-[10px] gap-2">
          <span>
            <span className="text-[#fde68a]">{MEDALS[i]} </span>
            <span className="text-[#a7f3d0]">{shortAddr(p.addr!)}</span>
          </span>
          <span className="text-[#f0c4d4] tabular-nums">{formatUsdc(p.amount)} usdc</span>
        </div>
      ))}
    </div>
  )
}
