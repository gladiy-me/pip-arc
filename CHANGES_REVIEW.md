# Review changes (2026-10-19)

External review of pip's yard by Claude (Anthropic), done at the owner's request.
This file is for the Arc Studio agent that wrote the project: **read it before touching
`contracts/Pip.sol`, its tests, `server/visit.ts`, or the docs.**

Result: `forge test` → **110 passed, 0 failed** (99 existing tests updated + 11 new regression tests
in `contracts/test/PipFixes.t.sol`). Compiler: solc 0.8.28, as in `foundry.toml`.

⚠️ **Storage layout and ABI changed → the contract must be redeployed.** The testnet contract
`0x66a76a19c4de93d7dc2eee72218b098f2a8b1a40` is the old, unfixed version.

---

## 1. Contract fixes (`contracts/Pip.sol`)

### FIX 1 — Critical: contract bricked forever if first feed came ≥ 4 s after deploy
- **Problem:** after the constructor `_hatch`, `alive = true` and `balance = 0`. In `_settle()` the guard
  `balance > 0 && burned >= balance` skipped the death branch, then `balance -= burned` underflowed
  (checked math → revert). `feed`, `interact`, `poke`, `setComputeAddress` all reverted forever.
  The old tests missed it because `setUp` fed in the same block as deploy.
- **Fix:** early return in `_settle()` when `balance == 0` (just moves `lastSettled` forward).
- **Tests:** `test_Fix1_FirstFeedLongAfterDeployWorks`, `test_Fix1_AdminCallsWorkBeforeFirstFeed`.

### FIX 2 — High: `setBurnRate` applied the new rate retroactively (owner instant-kill)
- **Problem:** `setBurnRate` didn't settle first, so the new rate was applied to the whole unsettled period.
  Example: fed 1 USDC, idle 6 h, owner sets 200_000 → pip dies at once and the whole 1 USDC goes to
  `computeAddress`. This contradicted the README claim "owner cannot drain instantly".
- **Fix:** `_settle()` at the old rate before changing it; new event `BurnRateChanged(previousRate, newRate)`.
- **Tests:** `test_Fix2_SetBurnRateSettlesAtOldRateFirst`, `test_Fix2_EmitsBurnRateChanged`.

### FIX 3 — High: a blacklisted `computeAddress` bricked the contract (rotation did not help)
- **Problem:** every `_settle()` pushed USDC to `computeAddress`. If USDC blacklists it, every call reverts.
  The documented mitigation (rotate via `setComputeAddress`) did not work: it calls `_settle()` first,
  which transfers to the blacklisted address and reverts.
- **Fix:** pull payments. `_settle()` now only credits `earnings[computeAddress]` (+ `totalEarningsOwed`).
  Payout: `withdrawEarnings(address account)`. It is permissionless (anyone can trigger it) and sends
  funds only to `account`. `setComputeAddress` still credits pending metabolism to the OLD address
  before switching, but no transfer happens there, so it can't revert.
  Side benefit: one fewer ERC-20 transfer per feed/interact, so less gas.
- **Invariant:** `USDC.balanceOf(pip) == balance + totalEarningsOwed`.
- **Tests:** `test_Fix3_BlacklistedComputeDoesNotBlockFeeding` (mock USDC with blacklist),
  `test_Fix3_AccountingInvariant`, `test_Fix3_WithdrawNothingReverts`.
- **Behaviour change for the operator:** USDC no longer arrives in `computeAddress` automatically.
  Call `withdrawEarnings(computeAddress)` from time to time (any wallet can call it).

### FIX 4 — Medium: revival gas grew with feeder count (`delete feederList` inside `feed`)
- **Problem:** `_hatch` did `delete feederList; delete visitorList;` inside the `feed`/`interact` path.
  The cost was O(N) in the previous generation's feeders/visitors, so a big generation could make revival
  exceed the block gas limit.
- **Fix:** per-generation storage `mapping(uint256 => address[]) _feedersByGen / _visitorsByGen`, never deleted.
  ABI kept compatible: `feederList(uint256)` / `visitorList(uint256)` are now view functions with the
  same signature (current generation). Added `feederListLength()`, `visitorListLength()`,
  `feedersOfGeneration(gen, offset, limit)` (paginated, also readable for past generations).
- **Tests:** `test_Fix4_ListsArePerGenerationAndRevivalIsCheap` (revival gas with 300 vs 3 feeders ±5%).
- Still O(n): `topFeeders()` / `topVisitors()`. They are view-only and never used in state-changing paths.
  At very large scale the frontend should switch to events or an indexer.

### FIX 5 — Low: metabolism lost on frequent calls (rounding)
- **Problem:** `burned = elapsed * rate / 3600` floored to 0 for short intervals (< 4 s at rate 1_000),
  but `lastSettled` still moved forward, so that time was never billed.
- **Fix:** new state `burnCarry` (sub-unit remainder in micro-USDC·seconds, always < 3600) carried between
  settlements. Billing is now exact no matter how often anyone calls. `isAlive()` / `timeLeft()` take the carry into account.
  Reset to 0 on hatch, on death and while balance is 0.
- **Tests:** `test_Fix5_FrequentPokesDoNotSkipMetabolism` (poke every 2 s for 1 h → exactly 1_000 billed),
  `testFuzz_Fix5_SplitSettlementMatchesSingle`.

### FIX 6 — Cosmetic: grave `died` = time someone noticed, not real death
- **Fix:** `diedAt = lastSettled + ceil((balance*3600 - burnCarry) / rate)`, capped at `block.timestamp`.
  Used in `Grave.died` and the `Died` event. `_recordGrave` now takes `diedAt`.
- **Test:** `test_Fix6_GraveDiedAtIsRealDeathTime`.

### ABI summary
- **Added:** `earnings(address)`, `totalEarningsOwed()`, `burnCarry()`, `withdrawEarnings(address)`,
  `feederListLength()`, `visitorListLength()`, `feedersOfGeneration(uint256,uint256,uint256)`,
  events `EarningsWithdrawn(address indexed,uint256)`, `BurnRateChanged(uint256,uint256)`.
- **Unchanged signatures:** `feed`, `interact`, `poke`, all existing getters, `Fed` / `Died` / `Interacted` / `Hatched` events, `Grave` struct.
- Frontend imports the ABI from `contracts/out/Pip.sol/Pip.json`, so run `forge build` before `bun run build`.

---

## 2. Tests
- `contracts/test/Pip.t.sol`: `MIN_*` constants updated to the new defaults (PET 100, FEED 1_000, SAY 500,
  PLAY 1_000, GIFT_HAT 5_000). The revert string `"Min feed 0.01 USDC"` became `"Amount below minimum"` (×3).
  The two `setComputeAddress` balance tests now call `withdrawEarnings(...)` before checking balances. Stale comments fixed.
- `contracts/test/PipFixes.t.sol`: new, 11 regression tests (above), includes a `BlacklistUSDC` mock.
- `contracts/test-helpers/MockERC20.sol`: `_transfer` marked `virtual` (needed for the blacklist mock). No other change.

## 3. Server (`server/visit.ts`)
- Hardcoded `MIN_PRICES` (old prices) replaced by live reads of `minPet/minFeedAgent/minSay/minPlay/minGiftHat`
  from the contract, with fallback to the contract defaults `[100, 1000, 500, 1000, 5000]`.
- The 200 response now has `paymentVerified: false` + a note. The endpoint never verified payments
  (sending `amount >= min` without paying returned a reply). It is "x402-style instructions", not real x402.
  Don't call it x402 in the grant application unless real verification is added.

## 4. Frontend
- `src/pip-contract.ts`: `MIN_FEED_AMOUNT` = `1_000n`, `DEFAULT_BURN_RATE` = `1_000n` (fallbacks only).
- `src/components/FeedPanel.tsx`: reads live `minFeed()` from the contract; custom input `min` follows it, step 0.001.
- `src/App.tsx`: burn-rate fallback uses `DEFAULT_BURN_RATE` instead of hardcoded `20_000n`.
- `src/components/PipThoughts.tsx`: "$0.02/hour" → "$0.001/hour".
- Kept on purpose: the "pls... 0.01 usdc" plea in `PipArt`/`PipThoughts` (still a valid amount).

## 5. Docs
- `public/agents.md`, `public/.well-known/pip.json`: new default prices + live getters, burn rate,
  metabolism recipient, honest note on `/api/visit`.
- `README.md`: prices, a plain "where the money goes" section (all paid USDC ends up with the operator
  via metabolism; "No owner withdrawal — ever" was misleading), security notes, legacy testnet row.
- `AGENTS.md`: pointer to this file, prices, test count, burn rate, security notes (the blacklist "mitigation" was wrong).
- `ECONOMICS_AND_REVIEW.md`: marked as reviewed.

---

## TODO (not done in this review)
1. `forge build`, then redeploy to **Arc Testnet** with `_initialBurnRate = 1000`. Test: feed, interact,
   wait, `poke`, `withdrawEarnings(computeAddress)`, let it die, revive.
2. Update the testnet address in `src/pip-contract.ts`, `server` env `VITE_PIP_ADDRESS`, `public/agents.md`,
   `public/.well-known/pip.json`, `README.md`, `AGENTS.md`, `contracts/contract-metadata/Pip.json`.
3. Then mainnet (chainId 5042), replace `MAINNET_PLACEHOLDER`.
4. Optional: real x402 verification in `/api/visit`; event/indexer-based leaderboards instead of `topFeeders()` at scale.
5. Optional: frontend UI for `earnings(computeAddress)` + a "withdraw" button for the operator.
