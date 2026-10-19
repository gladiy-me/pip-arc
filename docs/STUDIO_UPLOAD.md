# pip.exe MVP — upload pack for the Arc Studio agent (READ THIS FIRST)

This pack has **19 files** (this one included). They are only the files that are **new or changed** for the MVP.
Everything else in the Studio project (package.json, vite config, main.tsx, server/index.ts, server/prod.ts,
tracing, the old `Pip.sol` contracts and tests) stays exactly as it is.

## Step 1 — put every file at its path

The files were uploaded flat (no folders). Create or overwrite each one at the path below. Copy the content **byte for byte**; do not rewrite, reformat or "improve" anything.

| uploaded file | put it at | new / replace |
|---|---|---|
| `PipWorld.sol` | `contracts/PipWorld.sol` | new |
| `PipWorldVault.sol` | `contracts/PipWorldVault.sol` | new |
| `PipWorld.t.sol` | `contracts/test/PipWorld.t.sol` | new |
| `AuditRound2.t.sol` | `contracts/test/AuditRound2.t.sol` | new |
| `PipWorldInvariant.t.sol` | `contracts/test/PipWorldInvariant.t.sol` | new |
| `MockERC20.sol` | `contracts/test-helpers/MockERC20.sol` | replace (`_transfer` is now `virtual`) |
| `App.tsx` | `src/App.tsx` | replace (now renders the MVP) |
| `config.ts` | `src/config.ts` | replace (Arc mainnet / testnet / local chains from viem) |
| `engine.ts` | `src/world/engine.ts` | new |
| `DigitYard.tsx` | `src/world/DigitYard.tsx` | new |
| `WorldApp.tsx` | `src/world/WorldApp.tsx` | new |
| `contract.ts` | `src/world/contract.ts` | new |
| `world.css` | `src/world/world.css` | new |
| `visit.ts` | `server/visit.ts` | replace |
| `agents.md` | `public/agents.md` | replace |
| `pip.json` | `public/.well-known/pip.json` | replace |
| `MVP_SPEC.md` | `docs/MVP_SPEC.md` | new |
| `AUDIT_ROUND2.md` | `docs/AUDIT_ROUND2.md` | new |
| `STUDIO_UPLOAD.md` | `docs/STUDIO_UPLOAD.md` | new (this file) |

`@openzeppelin/contracts` 5.1.0 is already in package.json. The contracts import it as `@openzeppelin/contracts/...`.

## Step 2 — check the files landed

1. `forge build`. It must compile with no errors.
2. `forge test`. All tests must pass: the new PipWorld suites and the old Pip suites.
3. `bun run build`. It must pass. **Run `forge build` first:** `src/world/contract.ts` imports the ABIs from `contracts/out/`.

If something fails, report the exact error. Do not change the contracts to make it pass.

## Step 3 — deploy

Follow `docs/MVP_SPEC.md`, section 3. In short:
- deploy **`PipWorld`** (not `Pip`) with the constructor args `(0x3600000000000000000000000000000000000000, <operator>, <owner>, 3628800)`;
- **the owner must be the final wallet** (a multisig if possible), because the vault owner can never change;
- set `VITE_NETWORK=testnet|mainnet` and `VITE_WORLD_ADDRESS=<PipWorld address>`;
- `forge build && bun run build`, then publish the site.
