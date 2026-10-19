/**
 * Graveyard — ASCII tombstones for past pip generations
 */

interface Grave {
  gen: bigint
  born: bigint
  died: bigint
  totalFed: bigint
  feeders: bigint
  lastFeeder: string
  epitaph: string
}

interface GraveyardViewProps {
  graves: Grave[]
}

function formatDate(ts: bigint): string {
  return new Date(Number(ts) * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
}

function formatUsdc(raw: bigint): string {
  const whole = raw / 1_000_000n
  const frac = raw % 1_000_000n
  const fracStr = frac.toString().padStart(6, '0').replace(/0+$/, '') || '0'
  return `${whole}.${fracStr.slice(0, 2)}`
}

function lifespan(born: bigint, died: bigint): string {
  const s = Number(died - born)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`
}

function Tombstone({ grave }: { grave: Grave }) {
  const age = lifespan(grave.born, grave.died)
  const epitaph = grave.epitaph.slice(0, 40)

  return (
    <div className="font-mono text-[10px] text-[#9ca3af] space-y-0">
      <div className="text-[#6b7280]">  _____  </div>
      <div className="text-[#6b7280]"> |     | </div>
      <div className="text-[#e2d9f3]"> | gen | </div>
      <div className="text-[#f0c4d4]"> | #{grave.gen.toString().padEnd(3,' ')} | </div>
      <div className="text-[#6b7280]"> |     | </div>
      <div className="text-[#a78bfa]/70">  born   </div>
      <div className="text-[#9ca3af]">{formatDate(grave.born).padEnd(8,' ')}</div>
      <div className="text-[#a78bfa]/70">  died   </div>
      <div className="text-[#9ca3af]">{formatDate(grave.died).padEnd(8,' ')}</div>
      <div className="text-[#a78bfa]/70">  lived  </div>
      <div className="text-[#9ca3af]">{age.padEnd(8,' ')}</div>
      <div className="text-[#a78bfa]/70"> fed by  </div>
      <div className="tabular-nums">{formatUsdc(grave.totalFed)} usdc</div>
      <div className="text-[#6b7280] text-[9px] mt-1 max-w-[90px] break-words italic">"{epitaph}"</div>
    </div>
  )
}

export function GraveyardView({ graves }: GraveyardViewProps) {
  if (graves.length === 0) {
    return (
      <div className="font-mono text-xs space-y-2">
        <div className="text-[#a78bfa] text-[10px] tracking-widest">[ GRAVEYARD ]</div>
        <div className="text-[10px] text-[#a78bfa]/40">
          <div>╭──────────────────╮</div>
          <div>│  no graves yet   │</div>
          <div>│  pip lives on.   │</div>
          <div>│  keep feeding.   │</div>
          <div>╰──────────────────╯</div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="font-mono text-[#a78bfa] text-[10px] tracking-widest">[ GRAVEYARD ]</div>
      <div className="flex flex-wrap gap-4">
        {graves.map((g, i) => (
          <Tombstone key={i} grave={g} />
        ))}
      </div>
    </div>
  )
}
