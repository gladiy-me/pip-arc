/**
 * Feed panel — amount buttons, custom input, note field, feed button
 */

import { useState } from 'react'
import {
  useAccount,
  useWriteContract,
  useWaitForTransactionReceipt,
  useSwitchChain,
  useReadContract,
} from 'wagmi'
import { erc20Abi } from 'viem'
import { toast } from 'sonner'
import { USDC_ADDRESS, PIP_ADDRESS, PIP_ABI, ACTIVE_CHAIN_ID, MIN_FEED_AMOUNT } from '../pip-contract'
import { buildTxExplorerUrl } from '@/onchain-facts'

interface FeedPanelProps {
  onFed?: (amount: string) => void
}

const QUICK_AMOUNTS = [
  { label: '0.01', value: 10_000n },
  { label: '0.1', value: 100_000n },
  { label: '1.0', value: 1_000_000n },
]

function parseUsdcInput(s: string): bigint | null {
  if (!s || isNaN(parseFloat(s))) return null
  const f = parseFloat(s)
  if (f <= 0) return null
  return BigInt(Math.round(f * 1_000_000))
}

export function FeedPanel({ onFed }: FeedPanelProps) {
  const { address, chainId, isConnected } = useAccount()
  const { switchChain } = useSwitchChain()

  const [selected, setSelected] = useState<bigint | null>(100_000n)
  const [custom, setCustom] = useState('')
  const [note, setNote] = useState('')
  const [step, setStep] = useState<'idle' | 'approving' | 'feeding' | 'done'>('idle')

  const amount = custom ? (parseUsdcInput(custom) ?? 0n) : (selected ?? 0n)
  const noteBytes = new TextEncoder().encode(note).length
  const noteOk = noteBytes <= 80
  // Read the live minimum from the contract (owner can change it via setPrices)
  const { data: minFeedRaw } = useReadContract({
    address: PIP_ADDRESS,
    abi: PIP_ABI,
    functionName: 'minFeed',
    chainId: ACTIVE_CHAIN_ID,
  })
  const minFeed = (minFeedRaw as bigint | undefined) ?? MIN_FEED_AMOUNT
  const amountOk = amount >= minFeed

  const isWrongChain = isConnected && chainId !== ACTIVE_CHAIN_ID

  // Check USDC allowance
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'allowance',
    args: address ? [address, PIP_ADDRESS] : undefined,
    chainId: ACTIVE_CHAIN_ID,
    query: { enabled: !!address },
  })

  // Approve USDC
  const {
    writeContract: approve,
    data: approveHash,
    isPending: isApprovePending,
  } = useWriteContract()
  const { isLoading: isApproveConfirming, isSuccess: isApproveSuccess } =
    useWaitForTransactionReceipt({ hash: approveHash })

  // Feed pip
  const {
    writeContract: feed,
    data: feedHash,
    isPending: isFeedPending,
  } = useWriteContract()
  const { isLoading: isFeedConfirming, isSuccess: isFeedSuccess } =
    useWaitForTransactionReceipt({ hash: feedHash })

  // Handle approve success
  if (isApproveSuccess && step === 'approving') {
    setStep('feeding')
    void refetchAllowance()
    feed({
      address: PIP_ADDRESS,
      abi: PIP_ABI,
      functionName: 'feed',
      args: [amount, note],
      chainId: ACTIVE_CHAIN_ID,
    })
  }

  // Handle feed success
  if (isFeedSuccess && step === 'feeding') {
    setStep('done')
    const amountStr = (Number(amount) / 1_000_000).toFixed(amount % 1_000_000n === 0n ? 2 : 4)
    onFed?.(amountStr)
    toast.success(`fed pip ${amountStr} usdc!`, {
      description: feedHash ? (
        <a
          href={buildTxExplorerUrl(ACTIVE_CHAIN_ID, feedHash)}
          target="_blank"
          rel="noopener"
          className="underline"
        >
          view on explorer
        </a>
      ) : undefined,
    })
    setNote('')
    setTimeout(() => setStep('idle'), 3000)
  }

  function handleFeed() {
    if (!isConnected) return
    if (isWrongChain) {
      switchChain({ chainId: ACTIVE_CHAIN_ID })
      return
    }
    if (!amountOk || !noteOk) return

    const hasAllowance = (allowance ?? 0n) >= amount

    if (!hasAllowance) {
      setStep('approving')
      approve({
        address: USDC_ADDRESS,
        abi: erc20Abi,
        functionName: 'approve',
        args: [PIP_ADDRESS, amount * 2n], // approve 2x for convenience
        chainId: ACTIVE_CHAIN_ID,
      })
    } else {
      setStep('feeding')
      feed({
        address: PIP_ADDRESS,
        abi: PIP_ABI,
        functionName: 'feed',
        args: [amount, note],
        chainId: ACTIVE_CHAIN_ID,
      })
    }
  }

  const isBusy = isApprovePending || isApproveConfirming || isFeedPending || isFeedConfirming

  function btnLabel() {
    if (!isConnected) return '[ connect wallet to feed ]'
    if (isWrongChain) return '[ switch to arc testnet ]'
    if (isApprovePending) return '[ confirm approval in wallet... ]'
    if (isApproveConfirming) return '[ approving usdc... ]'
    if (isFeedPending) return '[ confirm in wallet... ]'
    if (isFeedConfirming) return '[ feeding pip... ]'
    if (step === 'done') return '[ nom nom nom ]'
    return `[ feed pip ${(Number(amount) / 1_000_000).toFixed(2)} usdc ]`
  }

  return (
    <div className="font-mono text-xs space-y-3">
      <div className="text-[#a78bfa] text-[10px] tracking-widest">[ FEED PIP ]</div>

      {/* Quick amounts */}
      <div className="flex gap-2 flex-wrap">
        {QUICK_AMOUNTS.map(q => (
          <button
            key={q.label}
            onClick={() => { setSelected(q.value); setCustom('') }}
            className={`px-3 py-1 border rounded text-xs transition-colors ${
              !custom && selected === q.value
                ? 'border-[#f0c4d4] text-[#f0c4d4] bg-[#f0c4d4]/10'
                : 'border-[#a78bfa]/30 text-[#a78bfa]/70 hover:border-[#a78bfa] hover:text-[#a78bfa]'
            }`}
          >
            {q.label} usdc
          </button>
        ))}
        <div className="flex items-center gap-1">
          <input
            type="number"
            min={Number(minFeed) / 1_000_000}
            step="0.001"
            placeholder="custom"
            value={custom}
            onChange={e => { setCustom(e.target.value); setSelected(null) }}
            className="w-20 px-2 py-1 border border-[#a78bfa]/30 rounded bg-transparent text-[#e2d9f3] placeholder:text-[#a78bfa]/30 text-xs focus:outline-none focus:border-[#a78bfa]"
          />
        </div>
      </div>

      {/* Note field */}
      <div className="space-y-1">
        <div className="flex justify-between text-[10px] text-[#a78bfa]/50">
          <span>leave a note (optional)</span>
          <span className={noteBytes > 80 ? 'text-[#f87171]' : ''}>{noteBytes}/80</span>
        </div>
        <input
          type="text"
          maxLength={120}
          placeholder="stay alive buddy..."
          value={note}
          onChange={e => setNote(e.target.value)}
          className="w-full px-2 py-1 border border-[#a78bfa]/30 rounded bg-transparent text-[#e2d9f3] placeholder:text-[#a78bfa]/30 text-xs focus:outline-none focus:border-[#a78bfa]"
        />
        {!noteOk && <div className="text-[#f87171] text-[10px]">note too long (max 80 bytes)</div>}
      </div>

      {/* Feed button */}
      <button
        onClick={handleFeed}
        disabled={isBusy || step === 'done' || (!isConnected && false) || (isConnected && (!amountOk || !noteOk))}
        className={`w-full px-3 py-2 border rounded text-xs transition-all ${
          step === 'done'
            ? 'border-[#a7f3d0] text-[#a7f3d0] bg-[#a7f3d0]/10'
            : isBusy
            ? 'border-[#a78bfa]/40 text-[#a78bfa]/50 cursor-wait'
            : isWrongChain
            ? 'border-[#fde68a] text-[#fde68a] hover:bg-[#fde68a]/10'
            : 'border-[#f0c4d4] text-[#f0c4d4] hover:bg-[#f0c4d4]/10 active:scale-95'
        }`}
      >
        {btnLabel()}
      </button>

      {!isConnected && (
        <div className="text-[10px] text-[#a78bfa]/40 text-center">
          connect wallet above to feed pip
        </div>
      )}
    </div>
  )
}
