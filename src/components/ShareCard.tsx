/**
 * Share button + ASCII share card preview for screenshots
 */

interface ShareCardProps {
  generation: bigint
  timeLeftSeconds: bigint
  alive: boolean
  balance: bigint
}

function formatTimeShort(seconds: bigint): string {
  if (seconds <= 0n) return 'deceased'
  const s = Number(seconds)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d}d ${h}h left`
  if (h > 0) return `${h}h ${m}m left`
  return `${m}m left`
}

function formatUsdc(raw: bigint): string {
  const whole = raw / 1_000_000n
  const frac = raw % 1_000_000n
  const fracStr = frac.toString().padStart(6, '0').replace(/0+$/, '') || '0'
  return `${whole}.${fracStr.slice(0, 2)}`
}

export function ShareCard({ generation, timeLeftSeconds, alive, balance }: ShareCardProps) {
  const timeStr = formatTimeShort(timeLeftSeconds)
  const appUrl = typeof window !== 'undefined' ? window.location.href : 'https://pip.exe'

  const tweetText = alive
    ? `don't let pip die!\n\npip gen #${generation} has ${timeStr}. pip needs usdc to survive.\n\n${appUrl}`
    : `pip gen #${generation} has died. hatch a new pip?\n\n${appUrl}`

  function shareToX() {
    const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText)}`
    window.open(url, '_blank', 'noopener')
  }

  function copyLink() {
    const text = `${tweetText}`
    void navigator.clipboard.writeText(text)
  }

  return (
    <div className="font-mono text-xs space-y-2">
      <div className="text-[#a78bfa] text-[10px] tracking-widest">[ SHARE PIP ]</div>

      {/* ASCII share card preview */}
      <div className="border border-[#a78bfa]/30 rounded p-3 text-[10px] text-[#e2d9f3] bg-[#1a1023] space-y-1 select-all">
        <div className="text-[#f0c4d4]">╭─────────────────────────╮</div>
        <div>│ <span className="text-[#a7f3d0]">pip.exe</span> - gen #{generation.toString().padEnd(4,' ')}          │</div>
        <div>│                                         │</div>
        <div>│  <span className={alive ? 'text-[#a7f3d0]' : 'text-[#f87171]'}>{alive ? '  ( ˆ ᴗ ˆ )  still alive!  ' : '    (x  x)   deceased...  '}</span>  │</div>
        <div>│                                         │</div>
        <div>│  life: <span className="text-[#f0c4d4] tabular-nums">{timeStr.padEnd(22,' ')}</span>│</div>
        <div>│  bal:  <span className="text-[#fde68a] tabular-nums">{(formatUsdc(balance) + ' usdc').padEnd(22,' ')}</span>│</div>
        <div>│                                         │</div>
        <div>│  <span className="text-[#c084fc]">don't let pip die.</span>              │</div>
        <div className="text-[#f0c4d4]">╰─────────────────────────╯</div>
      </div>

      <div className="flex gap-2">
        <button
          onClick={shareToX}
          className="flex-1 px-3 py-1.5 border border-[#a78bfa] text-[#a78bfa] rounded text-[10px] hover:bg-[#a78bfa]/10 transition-colors"
        >
          [ post to X ]
        </button>
        <button
          onClick={copyLink}
          className="flex-1 px-3 py-1.5 border border-[#a78bfa]/40 text-[#a78bfa]/60 rounded text-[10px] hover:border-[#a78bfa] hover:text-[#a78bfa] transition-colors"
        >
          [ copy text ]
        </button>
      </div>
    </div>
  )
}
