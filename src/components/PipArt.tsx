/**
 * ASCII art for pip at each mood state, with 2-3 frame animations
 */

import { useEffect, useState } from 'react'

export type Mood = 0 | 1 | 2 | 3 | 4 | 5

// Each mood has 2-3 animation frames
const PIP_FRAMES: Record<Mood, string[][]> = {
  // 0: ecstatic (>72h) — bouncing with sparkles
  0: [
    [
      '    * . * . *   ',
      '  .  ╭──────╮  .',
      '    │ ˆ ᴗ ˆ  │  ',
      '    │  (U)   │  ',
      '  ╰────────╯  ',
      '    ∪     ∪   ',
    ],
    [
      '  * . * . * . *',
      '  ╭──────╮     ',
      '  │ ˆ ᴗ ˆ│ *  ',
      '  │  (U) │    ',
      '  ╰──────╯    ',
      '   ∪     ∪    ',
    ],
    [
      '    . * . * .  ',
      '  ╭──────╮  .  ',
      '  │ ˆ ᴗ ˆ│    ',
      '  │  (U) │  * ',
      '  ╰──────╯    ',
      '    ∪   ∪     ',
    ],
  ],
  // 1: happy (>24h)
  1: [
    [
      '               ',
      '  ╭──────╮     ',
      '  │ ˆ ᴗ ˆ│    ',
      '  │  (U) │    ',
      '  ╰──────╯    ',
      '   ∪     ∪    ',
    ],
    [
      '               ',
      '  ╭──────╮     ',
      '  │ ^ ᴗ ^│    ',
      '  │  (U) │    ',
      '  ╰──────╯    ',
      '   ∪     ∪    ',
    ],
  ],
  // 2: ok (>6h)
  2: [
    [
      '               ',
      '  ╭──────╮     ',
      '  │ • ᴗ •│    ',
      '  │  (U) │    ',
      '  ╰──────╯    ',
      '   ∪     ∪    ',
    ],
    [
      '               ',
      '  ╭──────╮     ',
      '  │ - ᴗ -│    ',
      '  │  (U) │    ',
      '  ╰──────╯    ',
      '   ∪     ∪    ',
    ],
  ],
  // 3: hungry (>1h)
  3: [
    [
      '  ╭─────────╮  ',
      '  │ a lil   │  ',
      '  │ hungry  │  ',
      '  ╰──╮      │  ',
      '  ╭──────╮     ',
      '  │ • ︵ •│    ',
      '  │  (U) │    ',
      '  ╰──────╯    ',
      '   ∪     ∪    ',
    ],
    [
      '  ╭─────────╮  ',
      '  │ a lil   │  ',
      '  │ hungry~ │  ',
      '  ╰──╮      │  ',
      '  ╭──────╮     ',
      '  │ . ︵ .│    ',
      '  │  (U) │    ',
      '  ╰──────╯    ',
      '   ∪     ∪    ',
    ],
  ],
  // 4: starving (<1h)
  4: [
    [
      '  ╭──────────╮ ',
      '  │ pls...   │ ',
      '  │ 0.01 usdc│ ',
      '  ╰──╮       │ ',
      '  ╭──────╮     ',
      '  │ ; ︵ ;│    ',
      '  │  (U) │    ',
      '  ╰──────╯    ',
      '   ∪     ∪    ',
    ],
    [
      '  ╭──────────╮ ',
      '  │ pls...   │ ',
      '  │ 0.01 usdc│ ',
      '  ╰──╮       │ ',
      '  ╭──────╮     ',
      '  │ ;  ; │    ',
      '  │  ︵  │    ',
      '  ╰──────╯    ',
      '  ∪       ∪   ',
    ],
  ],
  // 5: dead
  5: [
    [
      '    ░░░░░░░░   ',
      '   ░ ╭────╮ ░  ',
      '   ░ │x  x│ ░  ',
      '   ░ │  — │ ░  ',
      '   ░ ╰────╯ ░  ',
      '  ░░░░░░░░░░░  ',
      '  █ R . I . P█ ',
    ],
    [
      '   ░░░░░░░░░   ',
      '  ░ ╭────╮  ░  ',
      '  ░ │x  x│  ░  ',
      '  ░ │  — │  ░  ',
      '  ░ ╰────╯  ░  ',
      '  ░░░░░░░░░░░  ',
      '   █ R.I.P █   ',
    ],
  ],
}

// Eating animation frames (shown briefly after feeding)
export const EATING_FRAMES = [
  [
    '    ~ nom ~    ',
    '  ╭──────╮     ',
    '  │ ˆ ᴗ ˆ│  < ',
    '  │  (U) │    ',
    '  ╰──────╯    ',
    '   ∪     ∪    ',
  ],
  [
    '  ~ nom nom ~  ',
    '  ╭──────╮     ',
    '  │ ^ ᴗ ^│ <3 ',
    '  │  (U) │    ',
    '  ╰──────╯    ',
    '   ∪     ∪    ',
  ],
  [
    '  * <3 * <3 *  ',
    '  ╭──────╮     ',
    '  │ ˆ ᴗ ˆ│    ',
    '  │  (U) │    ',
    '  ╰──────╯    ',
    '    ∪   ∪     ',
  ],
]

interface PipArtProps {
  mood: Mood
  eating?: boolean
}

export function PipArt({ mood, eating = false }: PipArtProps) {
  const [frame, setFrame] = useState(0)

  const frames = eating ? EATING_FRAMES : PIP_FRAMES[mood]

  useEffect(() => {
    // reset frame when mood/eating changes (avoid lint warning by using key prop on parent)
    const interval = setInterval(() => {
      setFrame(f => (f + 1) % frames.length)
    }, eating ? 400 : 900)
    return () => {
      clearInterval(interval)
      setFrame(0)
    }
  }, [mood, eating, frames.length])

  const lines = frames[frame] ?? frames[0]

  const moodColors: Record<Mood, string> = {
    0: 'text-[#f0c4d4]', // ecstatic — pink sparkles
    1: 'text-[#a7f3d0]', // happy — mint
    2: 'text-[#fde68a]', // ok — warm yellow
    3: 'text-[#fca5a5]', // hungry — soft red
    4: 'text-[#f87171]', // starving — red
    5: 'text-[#9ca3af]', // dead — grey
  }

  return (
    <div
      className={`font-mono text-sm leading-snug select-none whitespace-pre transition-all duration-300 ${moodColors[mood]}`}
      aria-label={`pip the tamagotchi, mood: ${['ecstatic','happy','ok','hungry','starving','dead'][mood]}`}
    >
      {lines.map((line, i) => (
        <div key={i}>{line}</div>
      ))}
    </div>
  )
}
