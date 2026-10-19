/**
 * DigitYardEngine — the "digit yard" renderer, ported 1:1 from
 * docs/reference/pip-digits-prototype.html, minus the demo state.
 *
 * Imperative on purpose: React hands it a view via setView() and calls the
 * animation methods on events; the engine renders at ~30 fps on its own.
 */
import { hash, pick } from './noise'
import { COLORS, EMPTY, G, NC, P, RAMP } from './palette'
import { insidePip } from './pip-shape'
import { renderBackground, stampPip } from './scene'
import { stampParticle, stampRobot } from './sprites'
import { STAGES, type Stage } from './stages'
import { THOUGHTS } from './thoughts'
import { createDomOverlay, type DomOverlay } from './overlay'
import type {
  ActionId, Anim, Grid, Layout, Mood, Mouse, OverlayCallbacks, Particle, PipBox, Robot, ShapeState, YardView,
} from './types'

export type { YardView, OverlayCallbacks, ActionId, Mood }

const MAX_ROBOTS = 2
const ROBOT_GAP_S = 3
const SLEEP_AFTER_S = 25

export function fmtDur(sec: number): string {
  if (sec <= 0) return '0m'
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60)
  if (d) return `${d}d ${h}h`
  if (h) return `${h}h ${String(m).padStart(2, '0')}m`
  return `${m}m ${String(s).padStart(2, '0')}s`
}

export function fmtUsdc(v: number): string {
  return v >= 0.01
    ? v.toFixed(v >= 1 ? 2 : 3).replace(/0+$/, '').replace(/\.$/, '')
    : v.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')
}

export interface ViewWithGen extends YardView {
  /** current generation from reads; lets the engine ignore stale reads after a live Died/Hatched */
  generation?: number
}

export class DigitYardEngine {
  private container: HTMLElement
  private cv: HTMLCanvasElement
  private gv: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private gctx: CanvasRenderingContext2D
  private overlay: OverlayCallbacks
  private ownOverlay: DomOverlay | null = null

  // scene state (from the contract via setView)
  private stage: Stage = 0
  private alive = true
  private hatOn = false
  private hatLocalUntil = 0
  private mood: Mood = 1
  private reduce = false
  private gen = -1
  private minGen = -1
  private deadGen = -1
  private greeted = false

  private grid: Grid = { W: 0, H: 0, cw: 7, ch: 13, cols: 0, rows: 0, keyArr: new Uint8Array(0), chArr: new Uint8Array(0), hashArr: new Float32Array(0) }
  private dpr = 1
  private fs = 11
  private buckets: number[][] = Array.from({ length: NC }, () => [])
  private L: Layout = { horizon: 0, s: 1, pipX: 0, feet: 0, pondX: 0, pondY: 0, pondRx: 1, pondRy: 1 }

  private A: Anim = {
    squish: 0, playT: -1, eatT: -1, blink: 0, nextBlink: 2, sc: 0.5, evo: 0,
    idle: 0, sleep: false, zT: 0, holding: false, hold: 0, heartT: 0, wiggle: 0, shake: 0, gx: 0, gy: 0, pets: [],
  }
  private box: PipBox = { cx: 0, cy: 0, rx: 1, ry: 1, s: 1 }
  private shape: ShapeState
  private particles: Particle[] = []
  private robots: Robot[] = []
  private queue: { name: string; action: ActionId; text?: string; life?: number }[] = []
  private robotCooldown = 0
  private robotSeq = 0
  private mouse: Mouse = { x: -999, y: -999, in: false }

  private bubbleText = ''
  private bubbleUntil = 0
  private timers = new Set<ReturnType<typeof setTimeout>>()
  private thoughtTimer: ReturnType<typeof setInterval>
  private raf = 0
  private last = performance.now()
  private t0 = this.last
  private acc = 0
  private ro: ResizeObserver
  private destroyed = false
  private tagList: { id: string; name: string; x: number; y: number; say?: string; sayY?: number }[] = []

  constructor(container: HTMLElement, main: HTMLCanvasElement, glow: HTMLCanvasElement, overlay?: OverlayCallbacks) {
    this.container = container
    this.cv = main
    this.gv = glow
    const ctx = main.getContext('2d'), gctx = glow.getContext('2d')
    if (!ctx || !gctx) throw new Error('2d canvas not available')
    this.ctx = ctx; this.gctx = gctx
    if (overlay) this.overlay = overlay
    else { this.ownOverlay = createDomOverlay(container); this.overlay = this.ownOverlay }
    this.reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    this.shape = { box: this.box, A: this.A, stage: 0, hat: false }

    container.addEventListener('pointermove', this.onMove)
    container.addEventListener('pointerleave', this.onLeave)
    container.addEventListener('pointerdown', this.onDown)
    container.addEventListener('pointerup', this.onUp)
    container.addEventListener('pointercancel', this.onCancel)

    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(container)
    this.resize()
    if (document.fonts?.ready) void document.fonts.ready.then(() => { if (!this.destroyed) this.resize() })

    this.thoughtTimer = setInterval(() => this.thoughtTick(), 3000)
    this.raf = requestAnimationFrame(this.frame)
  }

  // ───────────────────────── public API ─────────────────────────

  setView(v: ViewWithGen): void {
    this.reduce = v.reducedMotion
    if (v.generation !== undefined) {
      if (v.generation < this.minGen) return            // stale read from before a live Hatched
      this.gen = Math.max(this.gen, v.generation)
    }
    let alive = v.alive
    if (alive && v.generation !== undefined && v.generation === this.deadGen) alive = false // stale read after a live Died
    this.alive = alive
    this.mood = alive ? (Math.min(4, v.mood) as Mood) : 5
    this.stage = alive ? v.stage : this.stage
    this.hatOn = v.hat
    if (!this.greeted) {
      this.greeted = true
      this.say(!alive ? 'pip ran out of compute. FEED to hatch the next pip.'
        : this.stage === 0 ? 'hi. i am a tiny mochi pip. feed me to grow.' : pick(THOUGHTS[this.mood]), 4000)
      this.A.sc = STAGES[this.stage].sc                   // no grow animation on first load
    }
  }

  /** PET from a tx or an event (the local click path is handled internally). */
  pet(opts: { long?: boolean; who?: string } = {}): void {
    const wasAsleep = this.wake()
    this.A.squish = 0.28
    for (let k = 0; k < (opts.long ? 2 : 4); k++) this.spawnHeart()
    if (opts.who) this.say(`${opts.who} petted me. briefly less lonely.`)
    else this.say(wasAsleep ? '*yawn* oh hi. pets accepted' : pick(['*squish* heart += 1', 'soft touch detected. thank you', 'more petting accepted']))
  }

  /** Coin drop + green "+Nh" floater (life added). */
  feed(lifeAddedSeconds: number, opts: { amountUsdc?: number; who?: string } = {}): void {
    const wasAsleep = this.wake()
    const PS = this.box.s
    this.particles.push({ type: 'coin', x: this.box.cx, y: 10, vx: 0, vy: 120, g: 500, r: this.L.s * 0.2, life: 4, max: 4 })
    const amt = opts.amountUsdc !== undefined ? ` +${fmtUsdc(opts.amountUsdc)} usdc` : ''
    this.say(wasAsleep ? '*sniff sniff* food?? awake.' : opts.who ? `nom. ${opts.who} fed me.${amt}` : `nom.${amt}`)
    if (lifeAddedSeconds > 0) {
      this.later(700, () => this.overlay.floater(`+${fmtDur(lifeAddedSeconds)}`, this.box.cx + PS * 1.1, this.box.cy - PS * 0.2, 'green'))
    }
  }

  say(text: string, ms = 3200): void {
    this.bubbleText = text
    this.bubbleUntil = performance.now() + ms
  }

  /** SAY action: bubble quotes the text. */
  heard(text: string, who?: string): void {
    this.wake()
    const tx = (text || 'hello pip').slice(0, 120)
    this.say(`"${tx.toLowerCase()}" — noted. i heard you${who ? ', ' + who : ''}.`, 4200)
  }

  play(): void {
    this.wake()
    const PS = this.box.s
    this.A.playT = 0
    for (let k = 0; k < 16; k++) this.particles.push({ type: 'spark', x: this.box.cx + (Math.random() - 0.5) * PS * 2, y: this.L.feet, vx: (Math.random() - 0.5) * 120, vy: -120 - Math.random() * 160, g: 220, life: 1.4, max: 1.4 })
    this.say(pick(['pip played and still won', 'wheee', 'again again']))
  }

  hat(on: boolean): void {
    this.wake()
    this.hatLocalUntil = on ? performance.now() + 30_000 : 0  // bridge until currentHat() reads catch up
    if (!on) this.hatOn = false
    else this.say('now fashionable. hat on for 24h')
  }

  /** Queue a robot visit (max 2 on screen, one every ~3 s). */
  agentVisit(v: { name: string; action: ActionId; text?: string; lifeAddedSeconds?: number }): void {
    const name = (v.name || 'agent').slice(0, 16)
    this.queue.push({ name, action: v.action, text: v.text, life: v.lifeAddedSeconds })
    if (this.queue.length > 20) this.queue.splice(0, this.queue.length - 20)
  }

  /** Evolution ceremony for the current (new) stage. */
  evolve(): void {
    if (!this.alive) return
    this.wake()
    const A = this.A, box = this.box
    A.evo = 1.1; A.squish = 0.3
    for (let k = 0; k < 40; k++) {
      const ang = (k / 40) * Math.PI * 2
      this.particles.push({ type: 'spark', x: box.cx, y: box.cy, vx: Math.cos(ang) * 230, vy: Math.sin(ang) * 150 - 40, g: 60, life: 1.3, max: 1.3 })
    }
    const st = this.stage
    this.later(300, () => this.say(st === 3 ? 'pip became an agent. beep. still pink.' : `pip evolved into ${STAGES[st].name}!`, 3800))
    this.overlay.floater('EVOLVED', box.cx, box.cy - box.s * 1.6, 'pink')
  }

  died(gen?: number): void {
    if (!this.alive) return
    this.alive = false
    this.mood = 5
    this.deadGen = gen ?? this.gen
    this.hatOn = false; this.hatLocalUntil = 0
    this.A.holding = false
    this.say('...', 2500)
  }

  hatched(gen?: number): void {
    const g = gen ?? (this.gen >= 0 ? this.gen + 1 : -1)
    if (g >= 0 && g <= this.gen && this.alive) return     // already showing this generation
    if (g >= 0) { this.minGen = g; this.gen = Math.max(this.gen, g) }
    this.deadGen = -1
    this.alive = true
    this.mood = Math.min(this.mood, 4) as Mood
    this.stage = 0
    this.hatOn = false; this.hatLocalUntil = 0
    this.A.squish = 0.3
    this.wake()
    this.say('a new pip hatched. it is a tiny mochi. hi.')
  }

  destroy(): void {
    this.destroyed = true
    cancelAnimationFrame(this.raf)
    clearInterval(this.thoughtTimer)
    for (const t of this.timers) clearTimeout(t)
    this.timers.clear()
    this.ro.disconnect()
    const c = this.container
    c.removeEventListener('pointermove', this.onMove)
    c.removeEventListener('pointerleave', this.onLeave)
    c.removeEventListener('pointerdown', this.onDown)
    c.removeEventListener('pointerup', this.onUp)
    c.removeEventListener('pointercancel', this.onCancel)
    c.classList.remove('over-pip')
    this.ownOverlay?.destroy()
  }

  // ───────────────────────── internals ─────────────────────────

  private later(ms: number, fn: () => void): void {
    const id = setTimeout(() => { this.timers.delete(id); if (!this.destroyed) fn() }, ms)
    this.timers.add(id)
  }

  /** Any event wakes pip. Returns whether it was asleep. */
  private wake(): boolean {
    const was = this.A.sleep
    this.A.idle = 0
    this.A.sleep = false
    return was
  }

  private resize(): void {
    const r = this.container.getBoundingClientRect()
    const g = this.grid
    g.W = r.width; g.H = r.height
    this.dpr = Math.min(2, window.devicePixelRatio || 1)
    let fs = Math.max(9, Math.min(12, Math.round(g.W / 105)))
    const ctx = this.ctx
    this.cv.width = Math.round(g.W * this.dpr); this.cv.height = Math.round(g.H * this.dpr)
    this.gv.width = Math.max(1, Math.round(g.W / 3)); this.gv.height = Math.max(1, Math.round(g.H / 3))
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    // perf budget (§7): keep the grid under ~14k cells
    for (;;) {
      ctx.font = `500 ${fs}px "JetBrains Mono", ui-monospace, monospace`
      g.cw = ctx.measureText('0').width || fs * 0.6
      g.ch = Math.round(fs * 1.18)
      g.cols = Math.ceil(g.W / g.cw); g.rows = Math.ceil(g.H / g.ch)
      if (g.cols * g.rows <= 14000 || fs >= 24) break
      fs++
    }
    this.fs = fs
    ctx.textBaseline = 'top'
    const n = g.cols * g.rows
    g.keyArr = new Uint8Array(n); g.chArr = new Uint8Array(n); g.hashArr = new Float32Array(n)
    for (let i = 0; i < n; i++) g.hashArr[i] = hash(i % g.cols, (i / g.cols) | 0)
    this.layout()
  }

  private layout(): void {
    const { W: Wpx, H: Hpx } = this.grid, L = this.L
    L.horizon = Hpx * 0.30
    L.s = Math.max(1, Math.min(Hpx * 0.18, Wpx * (Wpx < 600 ? 0.25 : 0.2)))
    L.pipX = Wpx * 0.5
    L.feet = Hpx * 0.66
    L.pondX = Wpx * 0.5; L.pondY = Hpx * 0.84; L.pondRx = Math.max(1, Math.min(Wpx * 0.40, L.s * 4.2)); L.pondRy = Math.max(1, Hpx * 0.11)
  }

  private frame = (now: number): void => {
    if (this.destroyed) return
    const dt = Math.min(0.1, (now - this.last) / 1000); this.last = now
    this.acc += dt
    this.raf = requestAnimationFrame(this.frame)
    if (document.hidden) return
    this.agentTick(dt)
    if (this.acc < 1 / 30) return                        // render at ~30fps
    const step = this.acc; this.acc = 0
    if (this.grid.cols === 0 || this.grid.rows === 0) return
    this.render((now - this.t0) / 1000, step)
  }

  private moodNow(): Mood { return this.alive ? (Math.min(4, this.mood) as Mood) : 5 }

  private render(t: number, dt: number): void {
    const A = this.A, box = this.box, L = this.L, g = this.grid
    const mood = this.moodNow()
    const dead = mood === 5
    const reduce = this.reduce
    const energy = [1.2, 1, 0.75, 0.45, 0.25, 0][mood]
    const hat = !dead && (this.hatOn || performance.now() < this.hatLocalUntil)
    this.shape.stage = this.stage
    this.shape.hat = hat
    // pip motion
    const ST = STAGES[this.stage]
    A.sc += (ST.sc - A.sc) * Math.min(1, dt * 2.5)       // grow / shrink smoothly between stages
    const PS = L.s * A.sc; box.s = PS
    if (A.evo > 0) A.evo = Math.max(0, A.evo - dt)
    A.squish *= Math.pow(0.02, dt)
    A.nextBlink -= dt
    if (A.nextBlink <= 0) { A.blink = 1; A.nextBlink = 2 + Math.random() * 3 }
    A.blink = Math.max(0, A.blink - dt * 7)
    // falls asleep when nobody visits for a while
    A.idle += dt
    A.sleep = this.alive && A.idle > SLEEP_AFTER_S && A.playT < 0 && !A.holding
    if (A.sleep) {
      A.zT -= dt
      if (A.zT <= 0) { A.zT = 1.1; this.particles.push({ type: 'z', x: box.cx + PS * 0.75, y: box.cy - PS * box.ry * 0.9, vx: 16, vy: -30, life: 2.6, max: 2.6 }) }
    }
    // hold to pet: purr + a stream of hearts
    if (A.holding) {
      A.hold += dt; A.squish = 0.08 + 0.035 * Math.sin(t * 38)
      A.heartT -= dt; if (A.heartT <= 0) { A.heartT = 0.17; this.spawnHeart(0.6) }
    }
    A.wiggle = Math.max(0, A.wiggle - dt); A.shake = Math.max(0, A.shake - dt)
    // eyes follow the cursor
    let tgx = 0, tgy = 0
    const mouse = this.mouse
    if (mouse.in && !A.sleep && !dead) {
      const dx = mouse.x - box.cx, dy = mouse.y - box.cy, dd = Math.hypot(dx, dy) || 1, k = Math.min(1, dd / (PS * 2.5))
      tgx = (dx / dd) * 0.07 * k; tgy = (dy / dd) * 0.05 * k
    }
    A.gx += (tgx - A.gx) * Math.min(1, dt * 8); A.gy += (tgy - A.gy) * Math.min(1, dt * 8)
    let jump = 0
    if (A.playT >= 0) {
      A.playT += dt; const p = A.playT / 1.1
      jump = reduce ? 0 : Math.sin(Math.PI * Math.min(1, p)) * PS * 1.1
      if (p >= 1) { A.playT = -1; A.squish = 0.25 }
    }
    if (A.eatT >= 0) { A.eatT += dt; if (A.eatT > 1.2) A.eatT = -1 }
    const mochi = this.stage === 0
    const breathe = reduce || A.sleep ? Math.sin(t * 1.2) * 0.6 : Math.sin(t * 2.4 * Math.max(0.4, energy))
    const hop = reduce || dead || A.sleep ? 0 : Math.max(0, Math.sin(t * 2.4)) * PS * (mochi ? 0.12 : 0.08) * energy
    const q = (mochi ? 0.06 : 0.035) * breathe + A.squish
    box.rx = ST.rx * (1 + q)
    box.ry = ST.ry * (1 - q)
    const motion = reduce ? 0 : 1
    box.cx = L.pipX + (dead ? Math.sin(t * 0.8) * L.s * 0.15 * motion : 0)
      + (A.wiggle > 0 ? Math.sin(t * 34) * PS * 0.08 * motion : 0) + (A.shake > 0 ? Math.sin(t * 70) * PS * 0.035 * motion : 0)
    const base = mochi ? box.ry / 1.35 : box.ry + 0.1
    box.cy = L.feet - PS * base - hop - jump - (dead ? L.s * (0.5 + Math.sin(t * 1.3) * 0.12 * motion) : 0)
    // agent form: a slow ring of digits orbits pip
    if (this.stage === 3 && !dead && Math.random() < 0.5) {
      const ang = t * 1.6 + Math.random() * 0.4
      this.particles.push({ type: 'spark', x: box.cx + Math.cos(ang) * PS * 1.6, y: box.cy + Math.sin(ang) * PS * 0.45, vx: 0, vy: 0, g: 0, life: 0.45, max: 0.45 })
    }

    // 1. background
    renderBackground(g, L, this.shape, t, mood, mouse, reduce)
    // 2. stamps: robots → pip (with halo) → particles
    for (const r of this.robots) stampRobot(g, L, r, t)
    stampPip(g, this.shape, t, mood)
    let w = 0
    const ps = this.particles
    for (let j = 0; j < ps.length; j++) { const p = ps[j]; p.life -= dt; if (p.life > 0) ps[w++] = p }
    ps.length = w
    for (let j = 0; j < ps.length; j++) {
      if (stampParticle(g, ps[j], dt, box.cy)) this.coinLanded()
    }

    // 3. draw batched by color
    const n = g.cols * g.rows, buckets = this.buckets, keyArr = g.keyArr, chArr = g.chArr, cols = g.cols, cw = g.cw, ch = g.ch
    for (let k = 0; k < NC; k++) buckets[k].length = 0
    for (let i = 0; i < n; i++) { const k = keyArr[i]; if (k !== EMPTY) buckets[k].push(i) }
    const ctx = this.ctx
    ctx.clearRect(0, 0, g.W, g.H)
    for (let k = 0; k < NC; k++) {
      const list = buckets[k]; if (!list.length) continue
      ctx.fillStyle = COLORS[k]
      for (let j = 0; j < list.length; j++) {
        const i = list[j]
        ctx.fillText(RAMP[chArr[i]], (i % cols) * cw, ((i / cols) | 0) * ch)
      }
    }
    // 4. glow (behind the main canvas, via CSS blur)
    this.gctx.clearRect(0, 0, this.gv.width, this.gv.height)
    this.gctx.drawImage(this.cv, 0, 0, this.gv.width, this.gv.height)

    this.placeOverlays(hat)
  }

  private coinLanded(): void {
    const A = this.A, box = this.box
    A.eatT = 0; A.squish = 0.15
    for (let k = 0; k < 10; k++) this.particles.push({ type: 'spark', x: box.cx, y: box.cy, vx: (Math.random() - 0.5) * 200, vy: -Math.random() * 180, g: 300, life: 0.8, max: 0.8 })
  }

  private placeOverlays(hat: boolean): void {
    const box = this.box, L = this.L
    const top = box.cy - box.s * (box.ry + (hat || this.stage === 3 ? 1.25 : 0.55))
    this.overlay.bubble(this.bubbleText, box.cx, Math.max(40, top), performance.now() < this.bubbleUntil)
    const list = this.tagList
    list.length = 0
    for (const r of this.robots) {
      list.push({ id: r.id, name: r.name, x: r.x, y: r.y - L.s * 1.5, say: r.state === 'act' ? r.say : undefined, sayY: r.y - L.s * 1.75 })
    }
    this.overlay.tags(list)
  }

  private spawnHeart(scale = 1): void {
    const PS = this.box.s
    this.particles.push({ type: 'heart', x: this.box.cx + (Math.random() - 0.5) * PS * 1.6, y: this.box.cy - PS * 0.5, vx: (Math.random() - 0.5) * 40, vy: -60 - Math.random() * 60, r: this.L.s * (0.11 + Math.random() * 0.09) * scale, life: 1.7, max: 1.7 })
  }

  /** Local-only pet (click / hold / triple-click tickle). Never touches the wallet. */
  private localPet(long: boolean): void {
    const wasAsleep = this.wake()
    const A = this.A, box = this.box
    A.squish = 0.28
    for (let k = 0; k < (long ? 2 : 4); k++) this.spawnHeart()
    const now = performance.now()
    A.pets = A.pets.filter(x => now - x < 1300); A.pets.push(now)
    if (A.pets.length >= 3) {                            // rapid clicks = tickle
      A.pets = []; A.wiggle = 1
      this.say(pick(['hehe. stop. no wait. more', 'ticklish!! 0110100001101001', 'ahaha my digits']))
      for (let k = 0; k < 12; k++) this.particles.push({ type: 'spark', x: box.cx, y: box.cy, vx: (Math.random() - 0.5) * 260, vy: -Math.random() * 200, g: 320, life: 0.9, max: 0.9 })
    } else {
      this.say(long ? 'purrrrr. long pets are the best' : wasAsleep ? '*yawn* oh hi. pets accepted' : pick(['*squish* heart += 1', 'soft touch detected. thank you', 'more petting accepted']))
    }
  }

  private thoughtTick(): void {
    if (performance.now() < this.bubbleUntil + 4000) return
    const m = this.moodNow()
    if (this.A.sleep) this.say(pick(['zzz', 'zzz... usdc... zzz', '*dreams in digits*']), 2500)
    else if (m >= 3 && m < 5 && Math.random() < 0.5) { this.A.shake = 0.6; this.say('grrrowl. that was my tummy') }
    else this.say(pick(THOUGHTS[m]))
  }

  private agentTick(dt: number): void {
    const L = this.L, Wpx = this.grid.W
    this.robotCooldown -= dt
    if (this.queue.length && this.robots.length < MAX_ROBOTS && this.robotCooldown <= 0) {
      this.robotCooldown = ROBOT_GAP_S
      const q = this.queue.shift()!
      const fromLeft = Math.random() < 0.5
      this.robots.push({
        id: `r${this.robotSeq++}`, name: q.name, action: q.action, text: q.text, life: q.life,
        seed: Math.random() * 10, c: Math.random() < 0.5 ? P + 7 : G + 11,
        x: fromLeft ? -L.s : Wpx + L.s, y: L.feet + L.s * 0.05, vx: fromLeft ? 1 : -1,
        tx: L.pipX + (fromLeft ? -1 : 1) * L.s * 2.1, state: 'in', timer: 0,
      })
    }
    for (const r of this.robots) {
      const speed = L.s * 1.4
      r.y = L.feet + L.s * 0.05                          // follow layout on resize
      if (r.state === 'in') r.tx = L.pipX + (r.vx > 0 ? -1 : 1) * L.s * 2.1
      if (r.state === 'in') {
        r.x += r.vx * speed * dt
        if ((r.vx > 0 && r.x >= r.tx) || (r.vx < 0 && r.x <= r.tx)) {
          r.state = 'act'; r.timer = 2.2
          this.robotActs(r)
        }
      } else if (r.state === 'act') {
        r.timer -= dt; if (r.timer <= 0) { r.state = 'out'; r.vx = -r.vx }
      } else {
        r.x += r.vx * speed * dt
      }
    }
    if (this.robots.length) this.robots = this.robots.filter(r => r.x > -L.s * 2 && r.x < Wpx + L.s * 2)
  }

  private robotActs(r: Robot): void {
    if (!this.alive && r.action !== 1) r.action = 1     // dead: agents walking in only feed
    const a = r.action
    r.say = a === 2 ? (r.text || 'hello pip').slice(0, 60) : a === 1 ? 'feeding pip' : a === 4 ? 'a hat for you' : a === 3 ? 'tag, you are it' : '*pat pat*'
    if (a === 0) this.pet({ who: r.name })
    else if (a === 1) this.feed(r.life ?? 0, { who: r.name })
    else if (a === 2) this.heard(r.text || 'hello pip', r.name)
    else if (a === 3) this.play()
    else this.hat(true)
  }

  // pointer handlers
  private local(e: PointerEvent): { x: number; y: number } {
    const r = this.container.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  private onMove = (e: PointerEvent): void => {
    const p = this.local(e)
    this.mouse.x = p.x; this.mouse.y = p.y; this.mouse.in = true
    this.container.classList.toggle('over-pip', insidePip(this.box, p.x, p.y))
  }
  private onLeave = (): void => { this.mouse.in = false; this.container.classList.remove('over-pip') }
  private onDown = (e: PointerEvent): void => {
    const { x, y } = this.local(e)
    const A = this.A
    if (insidePip(this.box, x, y) && this.alive) {
      A.holding = true; A.hold = 0; A.heartT = 0.25; A.idle = 0
      try { this.container.setPointerCapture(e.pointerId) } catch { /* ignore */ }
    } else {
      for (let k = 0; k < 8; k++) this.particles.push({ type: 'spark', x, y, vx: (Math.random() - 0.5) * 160, vy: -Math.random() * 140, g: 260, life: 0.7, max: 0.7 })
    }
  }
  private onUp = (): void => {
    if (!this.A.holding) return
    this.A.holding = false
    this.localPet(this.A.hold > 0.7)
  }
  private onCancel = (): void => { this.A.holding = false }
}

