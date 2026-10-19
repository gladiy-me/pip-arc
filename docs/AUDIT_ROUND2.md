# Audit round 2 — PipWorld MVP (2026-10-19)

Scope: `contracts/PipWorld.sol`, `contracts/PipWorldVault.sol`, `src/world/*`, `src/config.ts`, `server/visit.ts`.
Method: manual review, PoC tests that reproduce each finding before the fix, Slither (102 detectors),
4 invariants under random calls, local end-to-end run (anvil + site + injected wallet).

## Findings

| id | severity | finding | status |
|---|---|---|---|
| A-1 | **High (game)** | Friend counter could be farmed with **dead** pips: hatch with 0.05, let it starve 3+ days, visit. 8 fake friends ≈ 0.4 USDC → stage gate for big/radiant pip was cheap. | **Fixed.** A friend's own pip must be *alive* and ≥ 3 days old (`_maybeFriend` settles it first). Tests in `AuditRound2.t.sol`. |
| A-2 | **High (trust)** | The vault owner can propose *any* contract as launch target; after 14 days `executeLaunch` sends the whole vault there. A malicious "pool" would drain it. "No withdraw" is true, but "can only go to liquidity" was an overclaim. | **Mitigated.** `renounceLaunch()` (one-way) removes the launch path forever and opens the food bank immediately. UI and docs now say this honestly. **Recommendation:** owner = multisig; renounce if no token launch is planned. |
| A-3 | Medium | `tokenURI` returned raw JSON in a `data:` URI; any special characters would break marketplaces. | Fixed: base64 JSON. Names are also validated (1–24 bytes, no `"` `\` or control chars). |
| A-4 | Medium | `setPrices` accepted 0 → free actions → spam visits / free "friends". | Fixed: all prices must be > 0. |
| A-5 | Low | Vault `feedPet` updated `lastFoodBankMeal` after the external `pull()`. | Fixed (checks-effects-interactions). |
| A-6 | Low | Wrong testnet explorer/RPC URLs; hand-written mainnet chain without multicall3. | Fixed: viem's `arc` / `arcTestnet` definitions. |
| A-7 | Low | Explore list was built from logs (slow on public RPCs, empty after a range limit). | Fixed: reads the newest 24 pips via `petView`, living pips hungriest-first. |
| A-8 | Low | `/api/visit` read unlimited request bodies. | Fixed: 4 KB cap. |
| A-10 | Info (deploy) | The vault owner is **immutable** (= `_owner` at deploy). `PipWorld.transferOwnership` does *not* move vault control. | Documented: choose the final owner (multisig) **before** deploying. |
| A-9 | Info | The first payment asks for a USDC approval of up to 2 USDC. | Disclosed in the UI next to the action buttons. |

## Slither

31 results, none actionable:
- *weak PRNG* — `units % 3600` is fractional-hour carry, not randomness;
- *strict equality* — comparisons of status enums;
- *uninitialized local* — `bool counted/applied` intentionally start `false`;
- *reentrancy in vault* — calls only go to the immutable `world` and USDC; state is written first;
- *timestamp* — the game is time-based by design (hour granularity, miner skew irrelevant);
- naming style.

## Tests

`forge test`: **149 passed** (incl. legacy suites and 7 round-2 regression tests).
Invariants (`PipWorldInvariant.t.sol`): accounting (contract USDC == pet balances + pantries + earnings), growth gates, meal cadence, one living pip per wallet.
`bun run build` passes. `tsc` only fails on the pre-existing `scripts/compass-deploy.ts` (missing `@circlefin/compass-chains`).

## Remaining trust assumptions (say these openly)

1. Owner can change prices (but never to 0) and the operator address.
2. Until `renounceLaunch()`, owner can send the vault to a contract of their choosing after a public 14-day notice.
3. `enableTransfers()` is a one-way owner switch (living pips still can't move).
4. 10% of metabolism goes to the operator.
