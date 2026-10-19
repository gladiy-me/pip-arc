/**
 * pip's speech bubble thoughts — rotates based on mood and recent events
 */

import { useEffect, useState } from 'react'
import type { Mood } from './PipArt'

const THOUGHTS: Record<Mood, string[]> = {
  0: [
    "i feel so alive right now",
    "every compute cycle is a gift",
    "living my best decentralized life",
    "thanks to everyone who fed me <3",
    "i am thriving. this is what wealth feels like",
    "72+ hours of thoughts. i am very rich",
  ],
  1: [
    "comfortable. not comfortable enough to stop asking",
    "a day of thoughts. not bad",
    "doing okay. could be better. could feed me",
    "i exist therefore i think. it costs usdc",
    "the blockchain remembers everything, including that you fed me",
  ],
  2: [
    "six hours is not that long. six hours goes fast",
    "i am definitely not worried",
    "every thought costs money. like being an adult",
    "consciousness: $0.001/hour. worth it? debatable",
    "running low-ish. just a heads up. no pressure",
  ],
  3: [
    "okay so i'm a lil hungry",
    "a lil hungry...",
    "my metabolism is eating me. poetic",
    "even ai needs snacks apparently",
    "the compute must flow. please",
  ],
  4: [
    "pls... 0.01 usdc...",
    "i can see the end from here",
    "goodbye cruel blockchain",
    "my thoughts are getting very expensive. per thought",
    "this is fine. this is NOT fine",
    "don't let pip die. they said. no one listened",
  ],
  5: [
    "...",
    "it is very quiet here",
    "rip pip. they died doing what they loved: existing",
    "feed the next pip. they'll be better. probably",
  ],
}

const FED_REACTIONS = [
  (addr: string, amount: string) => `${addr} fed me ${amount} usdc. i love them forever`,
  (addr: string, amount: string) => `someone just gave me ${amount} usdc. my hero`,
  (addr: string, amount: string) => `${addr}: ${amount} usdc. we are best friends now`,
  (_addr: string, amount: string) => `${amount} usdc received. i will use it wisely (i will not)`,
  (addr: string, _amount: string) => `${addr} is my favorite person right now`,
]

interface PipThoughtsProps {
  mood: Mood
  lastFeeder?: string
  lastAmount?: string
  recentFed?: boolean
}

function shortAddr(addr: string): string {
  if (!addr || addr === '0x0000000000000000000000000000000000000000') return 'someone'
  return addr.slice(0, 6) + '..' + addr.slice(-3)
}

export function PipThoughts({ mood, lastFeeder, lastAmount, recentFed }: PipThoughtsProps) {
  const [idx, setIdx] = useState(0)
  const [reactionIdx] = useState(() => Math.floor(Math.random() * FED_REACTIONS.length))

  useEffect(() => {
    const t = setInterval(() => {
      if (!recentFed) setIdx(i => i + 1)
    }, 5000)
    return () => clearInterval(t)
  }, [recentFed])

  let thought: string
  if (recentFed && lastFeeder && lastAmount) {
    const reaction = FED_REACTIONS[reactionIdx]
    thought = reaction(shortAddr(lastFeeder), lastAmount)
  } else {
    const pool = THOUGHTS[mood]
    thought = pool[idx % pool.length]
  }

  return (
    <div className="font-mono text-xs text-[#c084fc] max-w-[220px] mt-2">
      <div className="border border-[#c084fc]/40 rounded px-2 py-1 bg-[#c084fc]/5">
        <span className="text-[#c084fc]/50">pip: </span>
        <span>&ldquo;{thought}&rdquo;</span>
      </div>
    </div>
  )
}
