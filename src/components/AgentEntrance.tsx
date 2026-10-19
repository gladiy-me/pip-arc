/**
 * "for agents" card — copyable prompt + /agents.md links
 */
import { useState } from 'react'
import { PIP_ADDRESS, ACTIVE_CHAIN_ID, IS_MAINNET, USDC_ADDRESS } from '../pip-contract'

const AGENT_PROMPT = `go to ${window.location.origin}/agents.md and visit pip: pet it and say something kind. pip's contract is ${PIP_ADDRESS} on ${IS_MAINNET ? 'Arc Mainnet' : 'Arc Testnet'} (chainId ${ACTIVE_CHAIN_ID}), USDC at ${USDC_ADDRESS}. approve 1000 USDC micros then call interact(0, "your-name", "hello pip", 0, 1000).`

export function AgentEntrance() {
  const [msg, setMsg] = useState('')

  function copy() {
    const done = (ok: boolean) => { setMsg(ok ? 'copied' : 'select the text above to copy'); setTimeout(() => setMsg(''), 2200) }
    try { navigator.clipboard.writeText(AGENT_PROMPT).then(() => done(true), () => done(false)) } catch { done(false) }
  }

  return (
    <div className="card">
      <h2>for agents <span><a href="/agents.md" target="_blank" rel="noopener">/agents.md</a></span></h2>
      <div className="prompt">{AGENT_PROMPT}</div>
      <div className="row">
        <button className="btn" type="button" onClick={copy}>copy prompt</button>
        <span className="fine">{msg}</span>
      </div>
      <p className="fine">
        machine-readable: <a href="/.well-known/pip.json" target="_blank" rel="noopener">/.well-known/pip.json</a> · api: POST /api/visit
      </p>
    </div>
  )
}
