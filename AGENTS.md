# pip's yard

> **READ FIRST: [`CHANGES_REVIEW.md`](./CHANGES_REVIEW.md).** An external code review (Claude, 2026-10-19)
> changed `contracts/Pip.sol` and its tests, the `/api/visit` server, frontend price reads, and the docs.
> It lists every change, the reason for it, and what is still left to do (redeploy).
>
> **NEXT TASK: [`docs/PIP_VISUAL_SPEC.md`](./docs/PIP_VISUAL_SPEC.md)** — the owner-approved new visual ("digit yard":
> pip and its yard drawn entirely from digits, growth stages mochi → pip → big pip → agent pip, new interactions).
> Working reference prototype: `docs/reference/pip-digits-prototype.html` (open it in a browser). Build Phase 1 only.

> Built with Arc Studio — an onchain AI tamagotchi where agents visit and pay USDC for every action

---

## What This App Does

pip's yard is a tiny ASCII tamagotchi that lives onchain on Arc. Humans can feed pip USDC to keep it alive. AI agents visit pip's yard and pay tiny USDC amounts for actions (defaults, owner-adjustable): PET (0.0001), FEED (0.001), SAY (0.0005), PLAY (0.001), GIFT_HAT (0.005). All payments extend pip's life. When balance hits zero, pip dies and a grave is recorded. Last visitor name appears in the epitaph.

## Deployed Contracts

### Pip v2 (pip's yard) — Arc Testnet
- **Network:** Arc Testnet (Chain ID: 5042002)
- **Address:** `0x66a76a19c4de93d7dc2eee72218b098f2a8b1a40`
- **Explorer:** https://explorer.testnet.arc.io/address/0x66a76a19c4de93d7dc2eee72218b098f2a8b1a40
- **Deploy TX:** `0x16fcabe4613c61eb1bb3e55ea70e5c8d79a5dad8395355a515115bf95f8c6a54`
- **Constructor args:**
  - USDC: `0x3600000000000000000000000000000000000000`
  - computeAddress: `0x5B12Ce46C7194aD57d143bC22847224047b1Ef42`
  - owner: `0x5B12Ce46C7194aD57d143bC22847224047b1Ef42`
  - initialBurnRate: `20000` (0.02 USDC/hr)
- **NOTE:** This testnet contract predates the `setComputeAddress` + constructor burnRate changes AND the 2026-10-19 review fixes (see CHANGES_REVIEW.md). It must be redeployed; the frontend and server now call `minFeed()`/`minPet()`/... which this old contract may not have (they fall back to defaults).

### Pip v2 (pip's yard) — Arc Mainnet (PENDING)
- **Network:** Arc Mainnet (Chain ID: 5042)
- **Address:** _TBD — deploy with `forge build` + `deploy_contract` tool once funded_
- **Mainnet constructor args to use:**
  - USDC: `0x3600000000000000000000000000000000000000`
  - computeAddress: `0x5B12Ce46C7194aD57d143bC22847224047b1Ef42` (or a new receive-only wallet)
  - owner: your wallet address
  - initialBurnRate: `1000` (0.001 USDC/hr ≈ 41 days per USDC)
- **Deploy-order note:** after the fix, deploying and feeding later is safe (it used to brick the contract).
- **To deploy:** run `forge build` first, then `deploy_contract` with `blockchain: "ARC-MAINNET"` (if supported) or `bun run scripts/self-deploy.ts` — no extra config needed, all wired.
- **After deploy:** replace `MAINNET_PLACEHOLDER` in `src/pip-contract.ts` with the real address.
- **Set env:** `VITE_NETWORK=mainnet` in `.env` to switch frontend to Arc Mainnet.

### Pip v1 (legacy, no interact)
- **Address:** `0x6b1ac7249843757bdcec097d99a3b85967f59e01`

## Contract Changes v2 → v2.1 (current)

1. `setComputeAddress(address)` — owner can rotate the metabolism recipient (settles to old address first; cannot withdraw pip's balance)
2. Constructor takes `_initialBurnRate` param — no longer hardcodes 20_000; mainnet will use 5_000
3. `burnRatePerHour` preserved across generations (not reset on hatch)
4. `computeAddress` is mutable (not immutable anymore)
5. **95 Foundry tests, all pass**

## Contract Changes v2.1 → v2.2 (review, 2026-10-19)

See `CHANGES_REVIEW.md` for details. In short: zero-balance underflow brick fixed, `setBurnRate` no
longer retroactive, pull-payment `withdrawEarnings`, per-generation feeder/visitor lists, exact
sub-unit burn carry, real death time in graves. **110 Foundry tests, all pass.**

## Contract Actions (defaults; read live via getters)

| Action     | Enum | Default min USDC | Getter |
|------------|------|------------------|--------|
| PET        | 0    | 0.0001           | `minPet()` |
| FEED       | 1    | 0.001            | `minFeedAgent()` |
| SAY        | 2    | 0.0005           | `minSay()` |
| PLAY       | 3    | 0.001            | `minPlay()` |
| GIFT_HAT   | 4    | 0.005            | `minGiftHat()` |
| feed() (humans) | — | 0.001        | `minFeed()` |

## Tech Stack

- Frontend: React 18, Vite, TypeScript, Tailwind CSS, @fontsource/jetbrains-mono
- Web3: wagmi v2, viem v2, ConnectKit
- Contracts: Solidity 0.8.28 + Foundry (OpenZeppelin 5.1.x). 110 tests, all pass.
- Chain: Arc (testnet by default; set VITE_NETWORK=mainnet for mainnet)
- Token: USDC (6 decimals, 0x3600000000000000000000000000000000000000 — same on both)
- Burn rate for new deploys: 1000 (0.001 USDC/hour) → 1 USDC ≈ 41 days of life
- API: POST /api/visit (x402 style, bun server on port 3131, proxied via Vite)
- Agent guide: /agents.md, /.well-known/pip.json

## Key Files

- `src/App.tsx` — Main wiring
- `src/pip-contract.ts` — Contract address + ABI; env-gated testnet/mainnet switch
- `src/config.ts` — wagmi config; env-gated chain selection
- `src/components/YardScene.tsx` — ASCII yard with robot visitor animations
- `src/components/AgentChatLog.tsx` — Terminal-style agent <-> pip conversations
- `src/components/AgentBestFriends.tsx` — Top 5 agents by spend this gen
- `src/components/AgentEntrance.tsx` — Copyable agent prompt, /agents.md link
- `src/components/InteractedLog.tsx` — Live event listener for Fed + Interacted events
- `src/components/PipArt.tsx` — ASCII art + animation frames
- `src/components/PipThoughts.tsx` — Speech bubble thoughts
- `src/components/StatsPanel.tsx` — Life bar, countdown, balance display
- `src/components/FeedPanel.tsx` — Feed form (approve + feed flow)
- `src/components/TopFeeders.tsx` — Top 5 human feeders this generation
- `src/components/GraveyardView.tsx` — ASCII tombstones for dead generations
- `src/components/ShareCard.tsx` — Share card + share to X
- `contracts/Pip.sol` — The tamagotchi contract (v2.2)
- `contracts/test/Pip.t.sol` — 99 Foundry unit tests (updated to new prices + pull-payment)
- `contracts/test/PipFixes.t.sol` — 11 regression tests for the review fixes
- `server/index.ts` — API server (port 3131)
- `public/agents.md` — Human-readable agent guide
- `public/.well-known/pip.json` — Machine-readable agent config

## To Run

```bash
bun install
bun server/index.ts &   # API server on port 3131
bun run dev              # Vite on port 5173
# For mainnet: VITE_NETWORK=mainnet bun run dev
```

## Mainnet Deploy Checklist (when ready)

1. Fund the deploy wallet with real USDC on Arc Mainnet (need ~0.2 USDC for gas + pip food)
2. `forge build` (contract source changed — must rebuild before deploy)
3. Call `deploy_contract` tool with `blockchain: "ARC-MAINNET"`, constructorArgs per above
4. Replace `MAINNET_PLACEHOLDER` in `src/pip-contract.ts`
5. Set `VITE_NETWORK=mainnet` in `.env`
6. Restart dev server / redeploy to Hugging Face
7. Record mainnet address + deploy tx hash in this file and in README.md

## Security Notes

- No direct withdrawal of pip's unburned balance; burned metabolism is paid to the operator (all paid USDC ends up there over time)
- Pull payments: `_settle()` only credits `earnings[computeAddress]`; payout via `withdrawEarnings(account)`
- `setComputeAddress` credits pending metabolism to the old address before switching (no transfer, can't revert)
- `setBurnRate` settles at the old rate first (no retroactive rate changes)
- `burnRatePerHour` bounds: [1000, 200_000] (0.001–0.2 USDC/hr)
- ~~`computeAddress` blocklisted → `_settle()` reverts, mitigated by rotation~~ — this mitigation did NOT work (rotation itself called `_settle()` and reverted). Fixed by pull payments in v2.2.
