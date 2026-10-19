/**
 * ASCII yard scene — grass, fence, sun/moon, pip center stage, robot visitors
 */

import { useEffect, useRef, useState } from 'react'
import type { Mood } from './PipArt'

// Action enum (mirrors contract)
export type ActionId = 0 | 1 | 2 | 3 | 4
export const ACTION_NAMES: Record<ActionId, string> = { 0: 'PET', 1: 'FEED', 2: 'SAY', 3: 'PLAY', 4: 'GIFT_HAT' }

export interface VisitEvent {
  id: string
  agentName: string
  action: ActionId
  text: string
  hatId?: number
  amount: bigint
  txHash?: string
  ts: number
  isHuman?: boolean // humans show as <3 walker, not robot
}

interface RobotSprite {
  id: string
  agentName: string
  action: ActionId
  text: string
  hatId?: number
  phase: 'enter' | 'act' | 'exit'
  posX: number       // 0-100 % of width
  fromLeft: boolean  // which side entered
  frame: number
  startedAt: number
}

// Hat display chars (index 1-5, 0=none)
const HAT_CHARS = ['', '^', '~~', '_|_', '[]', '**', '/\\']

// Robot ASCII frames (different per action)
function robotLines(sprite: RobotSprite, pipMood: Mood): string[] {
  const name = sprite.agentName.slice(0, 8)
  const hat  = sprite.phase === 'act' && sprite.action === 4 && sprite.hatId
    ? HAT_CHARS[sprite.hatId] ?? '^'
    : ''

  if (sprite.phase === 'enter' || sprite.phase === 'exit') {
    const dir = sprite.fromLeft ? '>' : '<'
    return [
      name,
      '[o_o]',
      ` ${dir}| |`,
    ]
  }

  // ACT phase — action-specific
  if (sprite.action === 0 /* PET */) {
    const f = sprite.frame % 2
    return f === 0
      ? [name, '[o_o]', '/| |\\', '  <3 ']
      : [name, '[^_^]', '/| |\\', ' <3  ']
  }
  if (sprite.action === 1 /* FEED */) {
    const f = sprite.frame % 3
    if (f === 0) return [name, '[o_o]', '/| |\\', '  (@)']
    if (f === 1) return [name, '[o_o]', '/| \\', ' (@) ']
    return [name, '[^_^]', '/| |\\', ' nom ']
  }
  if (sprite.action === 2 /* SAY */) {
    const msg = sprite.text.slice(0, 10) || '...'
    return [name, '[o_o]', '/| |\\', `"${msg}"`]
  }
  if (sprite.action === 3 /* PLAY */) {
    const f = sprite.frame % 4
    const ball = ['o  ', ' o ', '  o', ' o '][f]
    return [name, '[>_<]', '/| |\\', ball]
  }
  if (sprite.action === 4 /* GIFT_HAT */) {
    const f = sprite.frame % 2
    return f === 0
      ? [name, '[o_o]', '/| |\\', ` ${hat} `]
      : ['pip:', `${hat}[^_^]`, ' /U\\', '']
  }

  // Pip reaction (shown when pipMood changes)
  void pipMood
  return [name, '[o_o]', '/| |\\', '']
}

// PIP reaction during act phase
function pipActLines(action: ActionId, frame: number, mood: Mood, hatId?: number): string[] {
  const hat = hatId ? (HAT_CHARS[hatId] ?? '^') : ''
  if (action === 0) {
    return frame % 2 === 0
      ? ['', ` ${hat}╭──╮`, '│*_*│', '╰──╯', ' <3']
      : ['', ` ${hat}╭──╮`, '│^ᴗ^│', '╰──╯', '  <3']
  }
  if (action === 1) {
    return frame % 3 === 0
      ? ['', ` ${hat}╭──╮`, '│o_o│', '╰──╯', '  <@']
      : frame % 3 === 1
        ? ['', ` ${hat}╭──╮`, '│^_^│', '╰──╯', ' nom']
        : ['', ` ${hat}╭──╮`, '│*ᴗ*│', '╰──╯', ' <3']
  }
  if (action === 2) {
    return ['', ` ${hat}╭──╮`, '│•ᴗ•│', '╰──╯', '  ..']
  }
  if (action === 3) {
    const ball = ['o  ', ' o ', '  o', ' o '][frame % 4]
    return ['', ` ${hat}╭──╮`, '│>ᴗ<│', '╰──╯', ball]
  }
  if (action === 4) {
    return frame % 2 === 0
      ? ['  ?', ` ${hat}╭──╮`, '│•_•│', '╰──╯', '']
      : [`${hat}`, ' ╭──╮', '│^ᴗ^│', '╰──╯', ' ty!']
  }
  const moodFaces: Record<Mood, string> = { 0:'*ᴗ*', 1:'ˆᴗˆ', 2:'•ᴗ•', 3:'•︵•', 4:';︵;', 5:'x  x' }
  return ['', `${hat} ╭──╮`, `│${moodFaces[mood]}│`, '╰──╯', '']
}

// Pip idle display
function pipIdleLines(mood: Mood, hatId?: number, hatActive?: boolean): string[] {
  const hat = hatId && hatActive ? (HAT_CHARS[hatId] ?? '^') : ''
  const faces: Record<Mood, string> = { 0:'ˆᴗˆ', 1:'ˆᴗˆ', 2:'•ᴗ•', 3:'•︵•', 4:';︵;', 5:'x  x' }
  return [`${hat} ╭──╮`, `│${faces[mood]}│`, '╰──╯', ' ∪  ∪']
}

// Sun/moon based on hour
function skyLine(): string {
  const h = new Date().getHours()
  if (h >= 6 && h < 20) return '  ☀  '
  return '  ☽  '
}

interface YardSceneProps {
  visits: VisitEvent[]
  mood: Mood
  hatId?: number
  hatActive?: boolean
  onAnimComplete?: (id: string) => void
}

const PHASE_DURATION = { enter: 1200, act: 2800, exit: 1200 }
const MAX_SPRITES    = 3

export function YardScene({ visits, mood, hatId, hatActive, onAnimComplete }: YardSceneProps) {
  const [sprites, setSprites]   = useState<RobotSprite[]>([])
  const [pipAct, setPipAct]     = useState<{ action: ActionId; hatId?: number } | null>(null)
  const [tick, setTick]         = useState(0)
  const queueRef                = useRef<VisitEvent[]>([])
  const animRef                 = useRef<ReturnType<typeof setInterval> | null>(null)

  // Queue new visits
  useEffect(() => {
    const latest = visits.slice(-20)
    queueRef.current = [...queueRef.current, ...latest].slice(-30)
  }, [visits])

  // Tick sprites
  useEffect(() => {
    animRef.current = setInterval(() => {
      setTick(t => t + 1)
      const now = Date.now()

      setSprites(prev => {
        let next = prev.map(s => {
          const elapsed = now - s.startedAt
          const phase: RobotSprite['phase'] =
            elapsed < PHASE_DURATION.enter ? 'enter'
            : elapsed < PHASE_DURATION.enter + PHASE_DURATION.act ? 'act'
            : 'exit'

          // PosX: enter from side → center → exit
          let posX: number
          if (phase === 'enter') {
            const t = elapsed / PHASE_DURATION.enter
            posX = s.fromLeft ? 5 + t * 35 : 95 - t * 35
          } else if (phase === 'act') {
            posX = s.fromLeft ? 40 : 60
          } else {
            const t = (elapsed - PHASE_DURATION.enter - PHASE_DURATION.act) / PHASE_DURATION.exit
            posX = s.fromLeft ? 40 - t * 40 : 60 + t * 40
          }

          return { ...s, phase, posX, frame: Math.floor(elapsed / 400) }
        })

        // Remove finished sprites
        const finished = next.filter(s => {
          const elapsed = now - s.startedAt
          return elapsed > PHASE_DURATION.enter + PHASE_DURATION.act + PHASE_DURATION.exit
        })
        finished.forEach(s => onAnimComplete?.(s.id))
        next = next.filter(s => {
          const elapsed = now - s.startedAt
          return elapsed <= PHASE_DURATION.enter + PHASE_DURATION.act + PHASE_DURATION.exit
        })

        // Set pip action from any acting sprite
        const acting = next.find(s => s.phase === 'act')
        setPipAct(acting ? { action: acting.action, hatId: acting.hatId } : null)

        // Spawn from queue if space
        if (next.length < MAX_SPRITES && queueRef.current.length > 0) {
          const ev = queueRef.current.shift()!
          next.push({
            id: ev.id,
            agentName: ev.isHuman ? '<3' : ev.agentName,
            action: ev.action,
            text: ev.text,
            hatId: ev.hatId,
            phase: 'enter',
            posX: Math.random() > 0.5 ? 5 : 95,
            fromLeft: Math.random() > 0.5,
            frame: 0,
            startedAt: now,
          })
        }

        return next
      })
    }, 120)

    return () => { if (animRef.current) clearInterval(animRef.current) }
  }, [onAnimComplete])

  // Render yard as a fixed-width text block
  const width = 48
  const sky     = skyLine()
  const grass   = ','.repeat(width)
  const fence   = '|' + '='.repeat(width - 2) + '|'
  const ground  = '_'.repeat(width)

  // Pip center col
  const pipCol = 22
  const actLines = pipAct
    ? pipActLines(pipAct.action, tick, mood, pipAct.hatId)
    : pipIdleLines(mood, hatId, hatActive)

  // Build yard rows (7 rows above ground)
  const rows: string[][] = Array.from({ length: 7 }, () => Array.from({ length: width }, () => ' '))

  // Place pip (rows 2-6, col 20-25)
  actLines.forEach((line, i) => {
    const row = i + 1
    if (row >= 7) return
    for (let c = 0; c < line.length && pipCol + c < width; c++) {
      rows[row][pipCol + c] = line[c]
    }
  })

  // Place sprites
  sprites.forEach(sprite => {
    const col = Math.round((sprite.posX / 100) * (width - 8))
    const lines = robotLines(sprite, mood)
    lines.forEach((line, i) => {
      const row = i + 3
      if (row >= 7) return
      for (let c = 0; c < line.length && col + c < width; c++) {
        if (rows[row][col + c] === ' ') rows[row][col + c] = line[c]
      }
    })
  })

  const yardRows = rows.map(r => r.join(''))

  return (
    <div
      className="font-mono text-[11px] leading-[1.4] select-none"
      style={{ color: '#a7f3d0' }}
    >
      {/* Sky */}
      <div className="text-[#fde68a]/80 text-center text-[10px]">{sky}</div>
      {/* Yard rows */}
      {yardRows.map((row, i) => (
        <div key={i} className="whitespace-pre" style={{ color: i === 0 ? '#c084fc' : '#a7f3d0' }}>{row}</div>
      ))}
      {/* Fence */}
      <div className="whitespace-pre text-[#a78bfa]/60 text-[10px]">{fence}</div>
      {/* Grass */}
      <div className="whitespace-pre text-[#4ade80]/50 text-[10px]">{grass}</div>
      {/* Ground */}
      <div className="whitespace-pre text-[#a78bfa]/30 text-[10px]">{ground}</div>

      {/* Active sprite labels */}
      <div className="relative h-3 mt-0.5">
        {sprites.filter(s => s.phase === 'act').map(s => (
          <span
            key={s.id}
            className="absolute text-[9px] text-[#f0c4d4] whitespace-nowrap transition-all duration-100"
            style={{ left: `${s.posX}%`, transform: 'translateX(-50%)' }}
          >
            {ACTION_NAMES[s.action]} {s.agentName.slice(0, 12)}
          </span>
        ))}
      </div>
    </div>
  )
}
