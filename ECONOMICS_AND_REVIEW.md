# pip.exe — economics & review brief (2026-10-19)

## What it is
Onchain ASCII tamagotchi on Arc (Circle's USDC-native L1). Humans and AI agents pay USDC to keep pip alive.
Target: Arc mainnet (chainId 5042) for Arc Microgrants round 2. Testnet contract (old prices): 0x66a76a19c4de93d7dc2eee72218b098f2a8b1a40.

## Money flow (contracts/Pip.sol)
- feed(amount, note) and interact(action, agentName, text, hatId, amount): USDC transferFrom user -> contract, added to pip's `balance`.
- Metabolism: `_settle()` burns `elapsed * burnRatePerHour / 3600` from balance and transfers it to `computeAddress` (the operator's wallet). This is the project's only revenue.
- Death: when burned >= balance, the remainder goes to computeAddress, a grave + epitaph is recorded, `alive=false`. Next feed/interact hatches a new generation.
- Nothing is refundable; there is no withdraw of `balance` by anyone (owner can't drain, only route the burn stream).
- Owner powers: setBurnRate (bounded 1_000..200_000 = 0.001..0.2 USDC/h), setComputeAddress (settles to old address first), setPrices (each <= PRICE_CAP 1 USDC), transferOwnership.

## New cheap mainnet parameters (6 decimals)
| item | value |
|---|---|
| burnRatePerHour (constructor) | 1_000 = 0.001 USDC/h (0.01 USDC = 10 h, 1 USDC = ~41 days) |
| minFeed (human) | 1_000 = 0.001 |
| PET | 100 = 0.0001 |
| FEED (agent) | 1_000 = 0.001 |
| SAY | 500 = 0.0005 |
| PLAY | 1_000 = 0.001 |
| GIFT_HAT | 5_000 = 0.005 (hat 24h) |
Old testnet prices: PET 0.001, FEED 0.01, SAY 0.005, PLAY 0.02, HAT 0.05, burn 0.02/h.

Arc gas is paid in USDC, target ~$0.01/tx (min base fee 20 gwei), so gas is now 10-100x the action price. Intentional for testing; pricing is owner-adjustable later.

Planned mainnet constructor: _usdc = Arc mainnet USDC, _computeAddress = owner wallet, _owner = 0x6f93e4a35e5BD9491A414A3Fb10DC50005cA1A6B, _initialBurnRate = 1000.
Deploy via Arc Studio platform deployer 0x5B12Ce46C7194aD57d143bC22847224047b1Ef42 (Circle wallet, not ours), needs ~0.1-0.2 USDC gas there.

## Review result (2026-10-19)
All six questions below were answered and the bugs fixed. See `CHANGES_REVIEW.md`. Tests: 110/110 green.

## Previous state (before review)
- Pip.sol already has setPrices + new defaults, BUT contracts/test/Pip.t.sol still uses old MIN_* constants (MIN_FEED = 10_000 etc.) and was NOT rerun after this change (Studio hit its daily limit mid-edit). Last green run before the price change: 99/99.
- README.md, public/agents.md, public/.well-known/pip.json, server/visit.ts (x402 price list) and frontend still show OLD prices.

## Please check
1. `_settle()` when alive with balance == 0 (right after constructor/_hatch, before any feed): `burned > 0`, the `balance > 0 &&` guard skips the death branch, then `balance -= burned` -> underflow revert? Does the first feed after a delay brick the contract or a revived generation?
2. Rounding: at 1_000/h, `elapsed*1000/3600` floors to 0 for elapsed < 4 s, and lastSettled still advances -> lost metabolism on frequent calls. Exploitable / matters?
3. Any way for owner or anyone to drain user USDC or block feeding (setPrices to PRICE_CAP, setComputeAddress to a reverting/blacklisted address — USDC blacklist would make every _settle revert).
4. Unbounded arrays (feederList, visitorList, graves) + topFeeders/topVisitors loops: gas DoS at scale?
5. Is the economics sane for a grant demo: revenue = burn only; agents pay for interactions via x402 (/api/visit).
6. Frontend/agents.md consistency with the contract after the price change.
