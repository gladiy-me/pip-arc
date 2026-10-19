/**
 * Approve → feed() / interact() flow (generalised from the old FeedPanel).
 * Calls onSuccess only after the receipt confirms with status "success";
 * a rejected or reverted tx never animates.
 */
import { useCallback, useRef, useState } from 'react'
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi'
import { erc20Abi } from 'viem'
import { toast } from 'sonner'
import { ACTIVE_CHAIN_ID, PIP_ABI, PIP_ADDRESS, USDC_ADDRESS } from '../pip-contract'
import { buildTxExplorerUrl } from '@/onchain-facts'
import type { ActionId } from '../visit-types'

export type TxStep = 'idle' | 'switching' | 'approve-sign' | 'approving' | 'sign' | 'confirming'

export interface PipTxRequest {
  /** 'feed' = human feed(amount, note); otherwise interact(action, …) */
  kind: 'feed' | 'interact'
  action: ActionId
  amount: bigint
  text: string
  hatId?: number
}

export interface PipTxCallbacks {
  /** tx hash known (before confirmation): lets the page ignore its own live event */
  onSubmitted?: (hash: `0x${string}`, req: PipTxRequest) => void
  onSuccess?: (req: PipTxRequest, hash: `0x${string}`) => void
}

export function shortAddr(a?: string): string {
  if (!a) return '?'
  return a.slice(0, 6) + '..' + a.slice(-4)
}

function errMsg(e: unknown): string {
  const m = (e as { shortMessage?: string; message?: string })?.shortMessage ?? (e as Error)?.message ?? 'transaction failed'
  if (/user rejected|denied/i.test(m)) return 'cancelled in wallet'
  return m.slice(0, 140)
}

export function usePipTx(cb: PipTxCallbacks) {
  const { address, chainId, isConnected } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const { writeContractAsync } = useWriteContract()
  const publicClient = usePublicClient({ chainId: ACTIVE_CHAIN_ID })
  const [step, setStep] = useState<TxStep>('idle')
  const cbRef = useRef(cb)
  cbRef.current = cb

  const run = useCallback(async (req: PipTxRequest) => {
    if (!isConnected || !address || !publicClient) return
    try {
      if (chainId !== ACTIVE_CHAIN_ID) {
        setStep('switching')
        await switchChainAsync({ chainId: ACTIVE_CHAIN_ID })
      }
      const allowance = await publicClient.readContract({
        address: USDC_ADDRESS, abi: erc20Abi, functionName: 'allowance', args: [address, PIP_ADDRESS],
      })
      if (allowance < req.amount) {
        setStep('approve-sign')
        const ah = await writeContractAsync({
          address: USDC_ADDRESS, abi: erc20Abi, functionName: 'approve',
          args: [PIP_ADDRESS, req.amount * 2n], // approve 2x for convenience (as before)
          chainId: ACTIVE_CHAIN_ID,
        })
        setStep('approving')
        const ar = await publicClient.waitForTransactionReceipt({ hash: ah })
        if (ar.status !== 'success') throw new Error('approval reverted')
      }
      setStep('sign')
      const hash = req.kind === 'feed'
        ? await writeContractAsync({
            address: PIP_ADDRESS, abi: PIP_ABI, functionName: 'feed',
            args: [req.amount, req.text], chainId: ACTIVE_CHAIN_ID,
          })
        : await writeContractAsync({
            address: PIP_ADDRESS, abi: PIP_ABI, functionName: 'interact',
            args: [req.action, shortAddr(address), req.text, req.hatId ?? 0, req.amount], chainId: ACTIVE_CHAIN_ID,
          })
      cbRef.current.onSubmitted?.(hash, req)
      setStep('confirming')
      const r = await publicClient.waitForTransactionReceipt({ hash })
      if (r.status !== 'success') throw new Error('transaction reverted')
      cbRef.current.onSuccess?.(req, hash)
      toast.success('confirmed onchain', {
        description: (
          <a href={buildTxExplorerUrl(ACTIVE_CHAIN_ID, hash)} target="_blank" rel="noopener" className="underline">
            view on explorer
          </a>
        ),
      })
    } catch (e) {
      toast.error(errMsg(e))
    } finally {
      setStep('idle')
    }
  }, [isConnected, address, publicClient, chainId, switchChainAsync, writeContractAsync])

  return { run, step, busy: step !== 'idle', isConnected, address, wrongChain: isConnected && chainId !== ACTIVE_CHAIN_ID }
}
