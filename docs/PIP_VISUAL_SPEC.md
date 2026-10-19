# pip — "digit yard" visual spec (build brief for the Arc Studio agent)

**Status:** approved by the owner. Build it.
**Reference implementation:** [`docs/reference/pip-digits-prototype.html`](./reference/pip-digits-prototype.html).
It is a complete, working, single-file prototype (vanilla JS + canvas, no libraries) with demo data.
**Port its code; do not redesign it.** The owner loved the look: "keep all of this style".
Open it in a browser first and play with it (click and hold pip, move the cursor through the grass,
use the "demo" card to preview forms and moods).

Your job: move this visual into the real React app. It replaces the current ASCII `PipArt` and
`YardScene` and is driven by live contract data and events instead of the demo state.

---

## 0. TL;DR checklist

- [ ] Phase 1: Create `src/digit-yard/` (engine split into TS modules, ported 1:1 from the prototype).
- [ ] Phase 1: Create the `<DigitYard />` React component (canvas + overlays) with an imperative handle.
- [ ] Phase 1: Create the `usePipView()` hook that maps contract state to `{ mood, stage, alive, hat, ... }`.
- [ ] Phase 1: Wire live events: `Interacted` → robot visit, `Fed` → coin drop, `Died` → ghost, `Hatched` → mochi.
- [ ] Phase 1: Wire user tx success → the matching animation.
- [ ] Phase 1: Restyle the page to the prototype layout and palette (yard left, panel right; stacked on phones).
- [ ] Phase 1: Add the growth card (stage + progress). Pure frontend, no contract change.
- [ ] Phase 1: Acceptance checks in §9 pass. `bun run build` and `forge test` stay green.
- [ ] Phase 2 (later, only after the owner says go): love points and seasons (offchain, from events).
- [ ] Phase 3 (later, only after the owner says go): contract changes (metabolism per stage, agent→owner registry).

Do **not** start Phase 2 or Phase 3 without the owner's go-ahead.

---

## 1. Look and feel (non-negotiable)

- **Everything in the yard is drawn with the digits `0–9`.** No images, no SVG sprites, no letters in the scene.
  Each grid cell gets one digit. Brightness picks the digit by ink density (`RAMP = '1743259608'`,
  from lightest to densest). Color comes from the scene.
- **pip is pink. Everything else is green** (neon "dopamine" grass, dark canopy, stars), plus a dark teal pond
  that reflects pip with a ripple. Robots (agents) are pale steel/mint so they read against the grass.
- Characters get a **dark halo**: background cells around pip and robots are cleared, so figures pop
  (same trick as the ASCII MMO reference video).
- **Glow:** a second canvas at 1/3 resolution sits *behind* the main canvas with CSS `filter: blur(6px); opacity: .75`.
  Never put the glow on top or use `mix-blend-mode: screen`. That washes the colors out to grey (bug we hit).
- **Fonts:** JetBrains Mono (UI and canvas digits), Silkscreen (display: logo, mood word, big numbers). Both from Google Fonts.
- Dark single theme. Background `#040906`.

### Palette (copy exactly; from the prototype's `COLORS`)

| range | name | from → to | use |
|---|---|---|---|
| 0–11 | G (green) | `#062a12`→`#139a3e` (6), `#18c94f`→`#8dff7a` (6) | grass, canopy, stars, hat, visor |
| 12–21 | P (pink) | `#4a0f2e`→`#c2307e` (5), `#e2479c`→`#ffd6ec` (5) | pip body (max level 8), cheeks/pompom = 9 |
| 22–27 | W (water) | `#041716`→`#2d6e6a` | pond |
| 28 | WHITE | `#eafff1` | eye highlights, sparks, evolution flash |
| 29 | EYE | (drawn as an empty cell = pure black) | eyes, mouth |
| 30–32 | GH (ghost) | `#5c4652`, `#a88a99`, `#e8d6df` | dead pip |
| 33–36 | RP (reflection pink) | `#2a0a1c`→`#8a2e62` | pip in the pond |
| 37 | GOLD | `#ffe28a` | coin center |
| 38–40 | robot metal | `#e9fff0`, `#a9d9bb`, `#6f9c80` | agent robots |

UI tokens (panel): `--green #39ff7a`, `--green-dim #1f9c4c`, `--mint #c4ffd8`, `--pink #ff5fb8`,
`--pink-soft #ffc2e3`, `--ink #d9f7e3`, `--muted #6f9c80`, `--warn #ffd166`, `--panel #07120c`,
`--line rgba(57,255,122,.16)`. Put them in `tailwind.config.js` → `theme.extend.colors`, or as CSS variables in `src/index.css`.

---

## 2. Rendering engine (port from the prototype)

### Grid
- Font size `fs = clamp(9, round(width/105), 12)`. Cell width = `measureText('0').width`, cell height = `round(fs*1.18)`.
- Canvas is DPR-scaled (cap DPR at 2). Re-measure on `ResizeObserver` and after `document.fonts.ready`.
- Render at **~30 fps** (accumulate dt, skip frames). Pause when `document.hidden`.
- Per frame:
  1. **Background pass** for every cell: sky / canopy / grass / pond (with pip reflection).
  2. **Stamps** in bounding boxes: robots → pip (with halo) → particles.
  3. **Draw batched by color:** bucket cell indices per palette key, then one `fillStyle` per bucket and `fillText` per cell.
  4. `drawImage` the main canvas into the glow canvas.
- Arrays: `keyArr: Uint8Array` (palette key, 255 = empty), `chArr: Uint8Array` (digit index), `hashArr: Float32Array`
  (per-cell static hash, computed on resize). Value noise + integer hash, as in the prototype (`hash`, `noise`).

### Scene layout (fractions of yard size; see `layout()`)
`horizon = 0.30H`, pip feet line `feet = 0.66H`, pip unit size `L.s = min(0.18H, W*(W<600 ? 0.25 : 0.2))`,
pond center `(0.5W, 0.84H)`, `rx = min(0.40W, 4.2·L.s)`, `ry = 0.11H`.

### Background rules (see the big loop in `render()`)
- **Sky:** mostly empty, rare twinkling stars (`hash > 0.986`).
- **Canopy:** noise-shaped treeline above the horizon, dark greens, slight sway.
- **Grass:** depth `d`, sway `sin(t·1.3 + x·0.011 + y·0.017)·(2+7d)`, noise plus blade stripes, moving wind gusts (bright band).
  The **cursor parts the grass**: dark inside radius `0.11·min(W,H)` and a bright ring just outside it.
  Cells below brightness 0.2 stay empty, which gives the grass texture.
- **Pond:** ellipse with a stony rim, ripple noise, and **pip's reflection**: sample pip at `(x + ripple, 2·feet + 0.08·L.s − y)`
  using the RP palette.
- **Digital shimmer:** cells with `hash > 0.9` cycle their digit over time.

### pip shape (`pipSample(px, py, t, mood, reflect)`)
An SDF-style sampler in pip-local units (`u, v` divided by `pipBox.s`). Order of tests (first hit wins):
hat → agent antenna → (not mochi) ears / arms / feet → body ellipse → eyes → mouth → cheeks → body shading.
- Body shading: fake sphere normal, light from top-left, `lit = clamp(0.38 + dot·0.5, 0.2, 0.86)`, rim (`e > 0.9`) darker.
- Eyes: black ellipses with a white highlight. **Eyes follow the cursor** (`A.gx/A.gy`, eased). They blink every 2–5 s.
  Sleepy (half-closed) when hungry. Closed lines when asleep. `X` eyes when dead.
- Mouth by state: open and chewing (eating) / small "o" (asleep) / smile (mood ≤ 1, petting, tickled) / flat line (mood 2) / frown (mood ≥ 3).
- Evolution flash: while `A.evo > 0`, body cells blink WHITE.

---

## 3. Growth stages — NEW

Every generation is born as a **mochi** and grows as it is fed.
Phase 1 derives the stage **in the frontend from existing contract reads**. No contract change.

| stage | name | `sc` (size × L.s) | body `rx/ry` | shape | condition (this generation) |
|---|---|---|---|---|---|
| 0 | mochi | 0.50 | 1.22 / 0.80 | round rice cake, flat bottom (`v·1.35` below center), **no ears, arms or feet**, bouncier | hatched |
| 1 | pip | 0.78 | 1.08 / 0.92 | current pip (ears, arms, feet) | `totalFedThisGen ≥ 50_000` (0.05 USDC) |
| 2 | big pip | 1.00 | 1.08 / 0.92 | current pip, full size | `totalFedThisGen ≥ 250_000` (0.25 USDC) |
| 3 | agent pip | 1.06 | 1.08 / 0.92 | current pip + antenna with a blinking beacon, green visor with glowing scan-bar eyes, orbiting ring of digits | `totalFedThisGen ≥ 1_000_000` **and** `visitorCount ≥ 5` |

```ts
// src/digit-yard/stages.ts
export const STAGE_THRESHOLDS = [
  { fed: 50_000n,    visitors: 0n },   // → pip
  { fed: 250_000n,   visitors: 0n },   // → big pip
  { fed: 1_000_000n, visitors: 5n },   // → agent pip
] as const
export function stageOf(totalFedThisGen: bigint, visitorCount: bigint, alive: boolean): 0|1|2|3 {
  if (!alive) return 0
  let s = 0
  for (const t of STAGE_THRESHOLDS) { if (totalFedThisGen >= t.fed && visitorCount >= t.visitors) s++; else break }
  return s as 0|1|2|3
}
```
`totalFedThisGen()` and `visitorCount()` are already public getters on `Pip.sol`.
`visitorCount` counts unique `interact()` callers this generation.
- The size eases smoothly between stages (`A.sc += (target − A.sc)·min(1, dt·2.5)`).
- When the stage **increases** (and not on first load), play the **evolution ceremony**: white flash (`A.evo = 1.1`),
  a ring of 40 sparks, an `EVOLVED` floater, a bubble ("pip evolved into big pip!" / "pip became an agent. beep. still pink."),
  and an `EVOLVE` row in the activity log.
- On `Hatched` (new generation), the stage resets to mochi and pip visibly shrinks.
- The growth card in the panel shows 4 pills (done / current / locked), a digit progress bar (`8` filled pink, `0` empty)
  and the line "next: big pip · fed 0.12 / 0.25 usdc this generation" (+ "· 3 / 5 different agents" for the last stage).

---

## 4. Animations and interactions

| trigger | animation | onchain? |
|---|---|---|
| idle | breathing squash, hop (mochi hops more), blink | — |
| cursor in yard | grass parts around the cursor; pip's eyes follow it | — |
| **click pip** | squish + 4 pink digit hearts float up + bubble | **local only** (no wallet popup) |
| **press and hold pip** | purr (fast squish), blush, waving arms, a stream of hearts every 0.17 s | local only |
| **3 quick clicks on pip** | tickle: side-to-side wiggle, spark burst, "hehe. stop. no wait. more" | local only |
| click empty grass | small spark burst at the cursor | local only |
| no activity for 25 s | falls asleep: closed eyes, small mouth, `2`s drift up like "zzz", sleepy bubbles. Any event wakes it ("*yawn*") | — |
| mood ≥ 3 (hungry) | every few seconds 50% chance of a tummy shake + "grrrowl. that was my tummy" | — |
| `PET` tx / Interacted(PET) | squish + hearts | ✔ |
| `FEED` / `feed()` tx / Fed / Interacted(FEED) | coin (mint ring, gold center) falls from the top, pip chews, crumbs, green floater `+10h` (life added) | ✔ |
| `SAY` | bubble quotes the text | ✔ |
| `PLAY` | big jump, arms wave, sparks from the ground | ✔ |
| `GIFT_HAT` | striped green party cone + pink pompom for 24 h (`currentHat().active`) | ✔ |
| Interacted from an agent | a digit robot walks in from a side with a name tag, does the action next to pip with a speech bubble, then walks out | ✔ |
| Died | pip becomes a grey floating ghost with `X` eyes; agents walking in only feed | ✔ |
| Hatched | mochi pops in (squish), bubble "a new pip hatched. it is a tiny mochi. hi." | ✔ |
| stage up | evolution ceremony (§3) | derived |

**Important:** clicking or holding pip must **not** open the wallet. Onchain actions only come from the action buttons.
The button flow is the existing approve → `interact()` / `feed()`. Play the animation when the tx is confirmed
(or optimistically on submit, then revert the bubble on failure). Floaters `+N love` are Phase 2 only. In Phase 1 show only `+10h`.

**Robots and history:** `InteractedLog.tsx` backfills past events with `ts: 0`. **Animate only live events** (`ts > 0`).
Max 2 robots on screen at once, so queue the rest (one every ~3 s). Label = `agentName` (truncate to 16 chars).
For `Fed` events from humans, don't spawn a robot: just drop the coin.

---

## 5. Code structure

```
src/digit-yard/
  palette.ts       // COLORS + index constants (G, P, W, WHITE, EYE, GH, RP, GOLD, R0..R2), RAMP
  noise.ts         // hash, noise, clamp, smooth
  stages.ts        // STAGES (sc/rx/ry), STAGE_THRESHOLDS, stageOf()
  pip-shape.ts     // pipSample(), setPink()  (pure, takes a state object)
  scene.ts         // background pass (sky, canopy, grass, pond+reflection)
  sprites.ts       // robots + particles (heart, coin, spark, z) stamping
  engine.ts        // class DigitYardEngine: resize, frame loop, render, state A, public methods
src/components/DigitYard.tsx   // React wrapper: canvases + overlay bubbles/tags/floaters
src/hooks/usePipView.ts        // contract reads → view model
```

### Engine API (imperative; React must not re-render per frame)
```ts
class DigitYardEngine {
  constructor(container: HTMLElement, main: HTMLCanvasElement, glow: HTMLCanvasElement, overlay: OverlayCallbacks)
  setView(v: { mood: 0|1|2|3|4|5; stage: 0|1|2|3; alive: boolean; hat: boolean; reducedMotion: boolean }): void
  pet(opts?: { long?: boolean }): void
  feed(lifeAddedSeconds: number): void   // coin + "+10h" floater
  say(text: string, ms?: number): void
  play(): void
  hat(on: boolean): void
  agentVisit(v: { name: string; action: 0|1|2|3|4; text?: string }): void   // queues a robot
  evolve(): void
  died(): void
  hatched(): void
  destroy(): void   // cancel RAF, observers, listeners
}
type OverlayCallbacks = {
  bubble(text: string, x: number, y: number, visible: boolean): void
  tags(list: { id: string; name: string; x: number; y: number; say?: string }[]): void
  floater(text: string, x: number, y: number, color: 'pink' | 'green'): void
}
```
Overlays (speech bubbles, robot name tags, floaters) are absolutely positioned HTML over the canvas, as in the prototype.
Position them from the engine each frame through refs/DOM (not React state) to avoid 30 fps re-renders.
The simplest route is for the engine to own those DOM nodes like the prototype does.

### `usePipView()`
Reads (already in `App.tsx`'s `useReadContracts`): `mood`, `isAlive`, `timeLeft`, `balance`, `burnRatePerHour`,
`generation`, `currentHat`. **Add** `totalFedThisGen` and `visitorCount`. Returns
`{ mood, alive, stage, hatActive, timeLeftSeconds, balance, burnRatePerHour, generation, nextStage: { name, fed, need, visitors, needVisitors } }`.
Detect transitions by comparing with the previous value (`useRef`): stage up → `engine.evolve()`;
`generation` up → `engine.hatched()`; `alive` true→false → `engine.died()`.
Skip transitions on the first load.

Keep the existing 10 s refetch. Events give instant animation; reads catch up.

---

## 6. Page layout (match the prototype)

- **Header:** `pip.exe` (Silkscreen, pink) + "onchain tamagotchi", network chip with a green dot (`Arc Testnet · 5042002`
  or mainnet), wallet button on the right (keep `ConnectKitButton.Custom`, restyle it). Remove the "demo" chip.
- **Desktop (≥ 921 px):** grid `minmax(0,1fr) 360px`. The yard fills the left at `height: calc(100vh − 76px)`.
  ⚠ Also set `flex: none` and `grid-template-rows: minmax(0,1fr)` on the grid, or the row grows to the panel's
  height (bug we hit). The right panel scrolls (`overflow-y: auto`).
- **Phone (< 921 px):** stacked. Yard `height: 64vh`. Hide the yard hint under 600 px. No horizontal scroll at 400 px.
- **Panel cards, in order:**
  1. status (mood word, digit life bar, time left, balance, metabolism, feeders · agents)
  2. growth (new, §3)
  3. visit pip (5 action buttons with live min prices from `minPet()` etc., feed amount chips, say input, existing approve flow from `FeedPanel`)
  4. activity (existing `Interacted` / `Fed` log restyled: who · ACTION amount · ago)
  5. for agents (existing `AgentEntrance` prompt + copy)
  6. graveyard + top feeders (existing data, restyled, can be a tab inside one card)
- Yard HUD overlay: top-left `gen N · mood`, top-right `time left …`, bottom-left hint
  "click pip to pet · hold for long pets · move the cursor through the grass".
- Remove the demo-only "preview form / mood" card. Optional: keep it behind `?debug` for screenshots.

Old components to retire after the port: `PipArt.tsx`, `YardScene.tsx`, `PipThoughts.tsx`
(move its thought lines into the engine bubble rotation). Keep `InteractedLog`, `FeedLog`, `FeedPanel` logic.

---

## 7. Accessibility and performance
- `prefers-reduced-motion`: no sway, no hop, gentle breathing only. Floaters fade without moving.
- The canvas is `aria-hidden`. The yard section has an `aria-label` describing pip's current mood and form.
  Action buttons are real `<button>`s with visible focus.
- Budget: ~8k cells at 30 fps runs on a mid laptop. If `cols·rows > 14000`, raise the font size.
- Don't allocate per frame inside the cell loop (reuse arrays and buckets).

---

## 8. Phase 2 and 3 (do NOT build yet; context only)

**Phase 2: love points and seasons (offchain).** A score computed from `Fed` / `Interacted` events:
10,000 love per USDC; ×3 when pip's `timeLeft` at the time of the event was < 6 h (rescue); ×0.25 when > 7 days (stuffed).
Seasons of 6 weeks; leaderboard. The prototype's "season 1" card shows the intended UI.
It needs an indexer or a backfill script. Wording: love is a game score, never promise a token.

**Phase 3: contract (v2.3).**
- (a) Metabolism grows with the stage: 0.001 → 0.002 → 0.004 → 0.008 USDC/h. The contract tracks the stage from `totalFedThisGen` and `visitorCount`.
- (b) `registerAgent(owner)` so an agent's spend counts for its owner.

Both need new tests, the owner's sign-off and a redeploy. See `CHANGES_REVIEW.md` for the current contract state.

---

## 9. Acceptance checks (Phase 1)
1. At 1400×860 and 400×860 the yard renders as digits only, pip is pink, everything else green; no horizontal scroll.
2. The colors are saturated, not grey (the glow canvas is behind the main canvas).
3. A fresh generation shows a mochi without ears, arms or feet. After `totalFedThisGen ≥ 0.05 USDC` it evolves with the ceremony.
   Stages 2 and 3 work by their thresholds. Stage 3 needs 5 visitors.
4. Clicking pip → hearts, no wallet popup. Holding → heart stream + purr. Triple click → tickle.
5. A live `Interacted` event from another wallet → robot with the agent name walks in and does the action.
   Historical events don't spawn robots.
6. A user's FEED tx → coin drop + `+Nh` floater after confirmation. A failed tx → no animation.
7. pip dies (`isAlive=false`) → grey ghost with X eyes. Feed → new generation → mochi.
8. Idle 25 s → asleep with drifting `2`s. Any event wakes it.
9. Eyes follow the cursor. The cursor parts the grass.
10. `bun run build` passes. `forge test` still 110/110. No console errors.
