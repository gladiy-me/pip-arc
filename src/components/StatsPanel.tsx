/**
 * ASCII stats panel — life bar, countdown, balance, generation, burn rate
 */

interface StatsPanelProps {
  balance: bigint
  timeLeftSeconds: bigint
  generation: bigint
  birthTime: bigint
  burnRatePerHour: bigint
  alive: boolean
}

function formatTimeLeft(seconds: bigint): string {
  if (seconds <= 0n) return '0h 00m 00s'
  const s = Number(seconds)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (d > 0) return `${d}d ${h.toString().padStart(2,'0')}h ${m.toString().padStart(2,'0')}m`
  return `${h.toString().padStart(2,'0')}h ${m.toString().padStart(2,'0')}m ${sec.toString().padStart(2,'0')}s`
}

function formatUsdc(raw: bigint): string {
  const whole = raw / 1_000_000n
  const frac = raw % 1_000_000n
  const fracStr = frac.toString().padStart(6, '0').replace(/0+$/, '') || '0'
  return `${whole}.${fracStr.slice(0, 4)}`
}

function formatBurnRate(perHour: bigint): string {
  return formatUsdc(perHour) + ' usdc/hr'
}

function lifeBar(timeLeftSeconds: bigint, alive: boolean): string {
  if (!alive) return '[░░░░░░░░░░] 0%'
  const hours = Number(timeLeftSeconds) / 3600
  // Cap display at 72h for full bar
  const pct = Math.min(1, hours / 72)
  const filled = Math.round(pct * 10)
  const empty = 10 - filled
  const bar = '█'.repeat(filled) + '░'.repeat(empty)
  return `[${bar}] ${Math.round(pct * 100)}%`
}

function formatAge(birthTime: bigint): string {
  const now = Math.floor(Date.now() / 1000)
  const age = now - Number(birthTime)
  if (age < 60) return `${age}s`
  if (age < 3600) return `${Math.floor(age / 60)}m`
  if (age < 86400) return `${Math.floor(age / 3600)}h ${Math.floor((age % 3600) / 60)}m`
  return `${Math.floor(age / 86400)}d ${Math.floor((age % 86400) / 3600)}h`
}

export function StatsPanel({ balance, timeLeftSeconds, generation, birthTime, burnRatePerHour, alive }: StatsPanelProps) {
  const bar = lifeBar(timeLeftSeconds, alive)
  const timeStr = alive ? formatTimeLeft(timeLeftSeconds) : 'deceased'
  const balStr = formatUsdc(balance)
  const ageStr = formatAge(birthTime)
  const burnStr = formatBurnRate(burnRatePerHour)

  return (
    <div className="font-mono text-xs text-[#e2d9f3] space-y-1">
      <div className="text-[#a78bfa] text-[10px] tracking-widest mb-1">[ PIP STATUS ]</div>
      <div>
        <span className="text-[#a78bfa]/60">life  </span>
        <span className="text-[#f0c4d4]">{bar}</span>
      </div>
      <div>
        <span className="text-[#a78bfa]/60">time  </span>
        <span className={alive ? 'text-[#a7f3d0]' : 'text-[#f87171]'}>{timeStr}</span>
      </div>
      <div>
        <span className="text-[#a78bfa]/60">bal   </span>
        <span className="tabular-nums">{balStr} usdc</span>
      </div>
      <div>
        <span className="text-[#a78bfa]/60">gen   </span>
        <span>#{generation.toString()}</span>
      </div>
      <div>
        <span className="text-[#a78bfa]/60">age   </span>
        <span>{ageStr}</span>
      </div>
      <div>
        <span className="text-[#a78bfa]/60">burn  </span>
        <span className="text-[#fca5a5]">{burnStr}</span>
      </div>
    </div>
  )
}
