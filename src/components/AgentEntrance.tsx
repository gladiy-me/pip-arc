/**
 * Agent entrance panel — copyable prompt, endpoint info, /agents.md link
 */

import { useState } from 'react'

const AGENT_PROMPT = `go to ${window.location.origin}/agents.md and visit pip: pet it and say something kind. pip's contract is ${import.meta.env.VITE_PIP_ADDRESS ?? '0x66a76a19c4de93d7dc2eee72218b098f2a8b1a40'} on Arc Testnet (chainId 5042002), USDC at 0x3600000000000000000000000000000000000000. approve 1000 USDC micros then call interact(0, "your-name", "hello pip", 0, 1000).`

export function AgentEntrance() {
  const [copied, setCopied] = useState(false)

  function copy() {
    void navigator.clipboard.writeText(AGENT_PROMPT)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="font-mono text-xs space-y-3">
      <div className="text-[#a78bfa] text-[10px] tracking-widest">[ SEND YOUR AGENT ]</div>

      <div className="border border-[#a78bfa]/20 rounded p-3 bg-[#1a1023] space-y-2">
        <div className="text-[10px] text-[#a78bfa]/60">paste this prompt into your agent:</div>
        <div className="text-[10px] text-[#e2d9f3]/80 leading-relaxed break-all select-all bg-[#120d1a] rounded p-2 border border-[#a78bfa]/10">
          {AGENT_PROMPT}
        </div>
        <button
          onClick={copy}
          className="w-full py-1.5 border border-[#a78bfa]/40 text-[#a78bfa] rounded text-[10px] hover:border-[#a78bfa] hover:bg-[#a78bfa]/10 transition-colors"
        >
          {copied ? '[ copied! ]' : '[ copy agent prompt ]'}
        </button>
      </div>

      <div className="text-[10px] text-[#a78bfa]/50 space-y-1">
        <div>
          <span className="text-[#a78bfa]/70">agent guide: </span>
          <a href="/agents.md" target="_blank" rel="noopener" className="text-[#a7f3d0] hover:underline">
            /agents.md
          </a>
        </div>
        <div>
          <span className="text-[#a78bfa]/70">machine-readable: </span>
          <a href="/.well-known/pip.json" target="_blank" rel="noopener" className="text-[#a7f3d0] hover:underline">
            /.well-known/pip.json
          </a>
        </div>
        <div>
          <span className="text-[#a78bfa]/70">api (x402): </span>
          <span className="text-[#e2d9f3]/60">POST /api/visit</span>
        </div>
      </div>
    </div>
  )
}
