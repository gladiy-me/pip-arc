# Digit yard — Phase 1 implementation notes (2026-10-19)

- Engine: `src/digit-yard/` (palette, noise, stages, pip-shape, scene, sprites, overlay, thoughts, engine). Ported 1:1 from `docs/reference/pip-digits-prototype.html`; demo state removed.
- React: `src/components/DigitYard.tsx` (imperative handle), `src/hooks/usePipView.ts` (reads → view + transitions), `src/hooks/usePipTx.tsx` (approve → feed()/interact(), animates only on a successful receipt).
- ABI: `src/abi/Pip.abi.json`, compiled from `contracts/Pip.sol` with solc 0.8.28 (solc-js). The app no longer needs `contracts/out/` to build. After a contract change: `forge build && jq .abi contracts/out/Pip.sol/Pip.json > src/abi/Pip.abi.json`.
- Contract address: `VITE_PIP_ADDRESS` in `.env` (wins), else `TESTNET_PIP_ADDRESS` / `MAINNET_PIP_ADDRESS` in `src/pip-contract.ts`. `VITE_NETWORK=mainnet` switches chain.
- Own txs: their hash is remembered on submit, so the matching live event does not animate twice. Human `Fed` → coin only; `Interacted` from other wallets → robot (max 2, queued every 3 s). History (ts 0) never animates.
- Interact from the page uses `agentName` = your short address and hatId 1 for GIFT_HAT (hatId 0 shows no hat onchain).
- Retired: PipArt.tsx, YardScene.tsx, PipThoughts.tsx, FeedPanel.tsx (logic moved to usePipTx/VisitPanel). Kept unused: AgentChatLog, ShareCard, FeedLog.
- Not built: Phase 2 (love, seasons) and Phase 3 (contract). No `?debug` preview card.
