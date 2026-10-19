# pip.exe MVP — personal pips & seasons (READ FIRST)

**Status (2026-10-19):** built and tested outside Studio by Claude at the owner's request. Everything below is
already implemented in this repo. **Your job in Arc Studio: build, deploy, wire the address, verify, ship.**
Do not redesign or rewrite it. Grant deadline: Arc microgrants close **Nov 1** and require *real USDC on Arc Mainnet*.

## 1. What the product is now

Everyone hatches **their own pip** (an ERC-721, non-transferable for now) and raises it during a **season**.

| rule | value (season 0) | where |
|---|---|---|
| hatch | `hatch(name, amount)`, needs ≥ 0.05 USDC of food (pantry counts); **one living pip per wallet** | `PipWorld.hatch` |
| metabolism | mochi 0.001 / pip 0.002 / big pip 0.004 / radiant 0.006 USDC per hour | `burnRateOf` |
| death | food runs out → dead **forever**; stays in the collection as a tombstone | `_settle` |
| counted meal | feed ≥ one day of food at the current stage, **max once per 8h**; anyone can feed any pip | `_feed`, `mealSizeOf`, `MEAL_COOLDOWN` |
| growth | mochi→pip: 6 meals + 2 days · pip→big pip: 18 meals + 10 days + 3 friends · big→radiant: 45 meals + 28 days + 8 friends | `growthReq` |
| friend | a wallet whose own pip is **alive** and ≥ 3 days old visiting/feeding; each friend counts once per pip | `_maybeFriend` |
| season | `SEASON_LENGTH` (deploy with **3628800 = 42 days**). At season end every living pip **retires**: frozen in its stage, leftover food → owner's **pantry** → first food of the next egg | `_settle`, `pantry` |
| lineage | a new egg whose previous pip **retired at stage ≥ 1** continues the line (`parentId`, `lineDepth`, inherited colour byte in `trait`). A dead parent breaks the line. Cosmetic only. | `hatch` |
| money | metabolism split in code: **90% → PipWorldVault** (no withdraw; 14-day timelocked one-time launch to a *contract* — **trust point, see `docs/AUDIT_ROUND2.md`**; `renounceLaunch()` removes that path forever and opens the food bank at once; otherwise food bank after 1 year), **10% → operator** (`computeAddress`) | `_credit`, `PipWorldVault.sol` |
| transfers | soulbound now; `enableTransfers()` is a one-way owner switch for later; living pips can never move | `_update` |

No agents in the MVP. The agent model is roadmap only (see the grant application).

## 2. Files

| path | what |
|---|---|
| `contracts/PipWorld.sol` | the game (ERC721Enumerable). Deploys `PipWorldVault` in its constructor. |
| `contracts/PipWorldVault.sol` | the vault |
| `contracts/test/PipWorld.t.sol` | 19 unit + fuzz tests; `AuditRound2.t.sol` — 7 regression tests for round-2 findings |
| `contracts/test/PipWorldInvariant.t.sol` | 4 invariants × 128k random calls: accounting, growth gates, meal cadence, one living pip each |
| `src/world/engine.ts` | the digit-yard renderer (ported 1:1 from `docs/reference/pip-digits-prototype.html`) |
| `src/world/DigitYard.tsx` | React wrapper |
| `src/world/WorldApp.tsx` | the whole MVP UI: hatch, status, growth, feed/pet/play/hat/say, share link, collection, explore, activity, vault, season |
| `src/world/contract.ts` | env config + ABIs (imported from `contracts/out`, so **run `forge build` before `bun run build`**) |
| `server/visit.ts` | `/api/visit` for agents (402 instructions; cosmetic reply, `paymentVerified: false`) |
| `src/legacy/App.tsx`, `contracts/Pip.sol`, `contracts/PipVault.sol` | the old single shared pip. Kept, not rendered. Do not deploy for the MVP. |

`forge test` → **149 passed** + 4 invariants (incl. the legacy suites). `bun run build` passes. `tsc` only fails on the pre-existing `scripts/compass-deploy.ts` (missing `@circlefin/compass-chains`).

## 3. Deploy (testnet first, then mainnet)

1. `forge build`
2. **Owner wallet: use a multisig (e.g. Safe) if Arc supports it** — it controls the vault launch path, and the vault owner **cannot be changed after deploy** (`transferOwnership` only moves PipWorld). Deploy **`PipWorld`** (not `Pip`) with constructor args:
   - `_usdc` = `0x3600000000000000000000000000000000000000` (Arc USDC, same on testnet and mainnet)
   - `_computeAddress` = operator wallet (receives the 10%)
   - `_owner` = owner wallet
   - `_seasonLength` = `3628800` (42 days). Season 1 starts at deploy time.
3. Read `vault()` from the deployed contract and record both addresses in `AGENTS.md`, `README.md`, `public/agents.md`, `public/.well-known/pip.json`.
4. Env for the frontend and server:
   ```
   VITE_NETWORK=testnet        # or mainnet
   VITE_WORLD_ADDRESS=0x...    # PipWorld
   ```
5. `bun run build` and redeploy the site to cramb.tech.
6. Smoke test on the real chain (two wallets): hatch → feed one meal → see "next counted meal in 8h" → second wallet visits →
   check `vault().totalBalance()` grows after a few hours. Check the activity card and the share link `?pip=<id>`.
7. Mainnet: same steps with `VITE_NETWORK=mainnet`. Hatch the team's first pip and feed it (this is the "real USDC on mainnet" the grant needs).

## 4. How it was verified (re-run these)

- `forge test` (149/149 + 4 invariants).
- Local end-to-end: anvil + mock USDC + PipWorld, the site with `VITE_NETWORK=local`, a headless browser with an injected wallet:
  connect → hatch → 7 meals across fast-forwarded time → grew mochi → pip → say → visit a neighbour via `?pip=1`
  → fast-forward 40 days → pip dead (ghost, tombstone note), season 2 started, "hatch a new egg" shown. Phone width: no horizontal scroll.
- `/api/visit`: 404 for unknown pip, 409 for dead pip, 402 with exact `approve` + `interact` calls for a live pip.

## 5. Not in the MVP (later, owner's call)

Weather (sun/rain), agent form & graduation, love points / leaderboards, live season results page, tradable collection.
`docs/PIP_VISUAL_SPEC.md` describes the visual in depth; its Phase 1 is **already implemented** in `src/world/`.
