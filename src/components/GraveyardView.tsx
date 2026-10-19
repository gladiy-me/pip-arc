/**
 * Graveyard — past pip generations
 */
import { fmtMicros } from './VisitPanel'

export interface Grave {
  gen: bigint
  born: bigint
  died: bigint
  totalFed: bigint
  feeders: bigint
  lastFeeder: string
  epitaph: string
}

function lifespan(born: bigint, died: bigint): string {
  const s = Number(died - born)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`
}

export function GraveyardView({ graves }: { graves: Grave[] }) {
  if (graves.length === 0) return <p className="fine">no graves yet. pip lives on. keep feeding.</p>
  return (
    <ul className="log graves">
      {[...graves].reverse().map((g, i) => (
        <li key={i}>
          <span className="who">gen #{g.gen.toString()}</span>
          <span className="what" title={g.epitaph}>lived <b>{lifespan(g.born, g.died)}</b> · "{g.epitaph.slice(0, 60)}"</span>
          <span className="ago">{fmtMicros(g.totalFed)} usdc</span>
        </li>
      ))}
    </ul>
  )
}
