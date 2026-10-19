// @ts-nocheck
/**
 * Digit yard engine — ported 1:1 from docs/reference/pip-digits-prototype.html.
 * Everything in the yard is drawn with the digits 0-9 on a canvas. pip is pink, everything else green.
 * The engine owns its canvas + overlay DOM; React only calls the methods returned by createDigitYard().
 */

export type DigitYardView = {
  mood: 0 | 1 | 2 | 3 | 4 | 5 // 5 = dead
  stage: 0 | 1 | 2 | 3
  alive: boolean
  retired?: boolean
  hat: boolean
}

export type DigitYardApi = {
  setView(v: DigitYardView): void
  pet(opts?: { long?: boolean; who?: string }): void
  feed(lifeAddedSeconds?: number): void
  say(text: string, ms?: number): void
  play(): void
  evolve(stageName: string): void
  agentVisit(v: { name: string; action: number; text?: string }): void
  wake(): void
  destroy(): void
}

const STAGES = [
  { name: 'mochi', sc: 0.5, rx: 1.22, ry: 0.8 },
  { name: 'pip', sc: 0.78, rx: 1.08, ry: 0.92 },
  { name: 'big pip', sc: 1.0, rx: 1.08, ry: 0.92 },
  { name: 'radiant pip', sc: 1.06, rx: 1.08, ry: 0.92 },
]

const THOUGHTS = [
  ['life is good. the grass is digits', 'i could do this forever', 'full belly. full heart', 'every number here loves me'],
  ['doing okay. could feed me', 'i exist therefore i think. it costs usdc', 'the blockchain remembers you fed me', 'wind in the digits'],
  ['a day or so of food left', 'i am definitely not worried', 'consciousness costs usdc. worth it?', 'running low-ish. no pressure'],
  ['okay so i am a lil hungry', 'my metabolism is eating me. poetic', 'the compute must flow. please', 'a meal would be nice'],
  ['pls... feed me...', 'i can see the end from here', 'this is fine. this is NOT fine', 'goodbye cruel blockchain'],
  ['...', 'pip ran out of food. rip.'],
]
const pick = (a) => a[(Math.random() * a.length) | 0]

export function createDigitYard(opts: {
  container: HTMLElement
  canvas: HTMLCanvasElement
  glow: HTMLCanvasElement
  bubble: HTMLElement
  onPet?: (long: boolean) => void
}): DigitYardApi {
  const yard = opts.container
  const cv = opts.canvas
  const gv = opts.glow
  const bubble = opts.bubble
  const ctx = cv.getContext('2d')
  const gctx = gv.getContext('2d')
  const RAMP = '1743259608'
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const S = { stage: 0, hat: false, alive: true, retired: false }
  let viewMood = 1
  const moodOf = () => viewMood
  let destroyed = false

  // palettes: index ranges → colors
  function ramp(a, b, n) {
    const p = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
    const A = p(a), B = p(b), out = [];
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      out.push(`rgb(${Math.round(A[0] + (B[0] - A[0]) * t)},${Math.round(A[1] + (B[1] - A[1]) * t)},${Math.round(A[2] + (B[2] - A[2]) * t)})`);
    }
    return out;
  }
  const COLORS = [].concat(
    ramp('#062a12', '#139a3e', 6), ramp('#18c94f', '#8dff7a', 6),   // G 0..11
    ramp('#4a0f2e', '#c2307e', 5), ramp('#e2479c', '#ffd6ec', 5),   // P 12..21
    ramp('#041716', '#2d6e6a', 6),                                   // W 22..27 water
    ['#eafff1', '#1a050f', '#5c4652', '#a88a99', '#e8d6df'],         // 28 white, 29 eye, 30..32 ghost
    ramp('#2a0a1c', '#8a2e62', 4),                                   // 33..36 reflection pink
    ['#ffe28a'],                                                     // 37 coin highlight
    ['#e9fff0', '#a9d9bb', '#6f9c80']                                // 38..40 robot metal
  );
  const G = 0, P = 12, W = 22, WHITE = 28, EYE = 29, GH = 30, RP = 33, GOLD = 37, R0 = 38, R1 = 39, R2 = 40;
  const NC = COLORS.length;

  let Wpx = 0, Hpx = 0, dpr = 1, fs = 11, cw = 7, ch = 13, cols = 0, rows = 0;
  let keyArr, chArr, hashArr, buckets = [];
  function resize() {
    const r = yard.getBoundingClientRect();
    Wpx = r.width; Hpx = r.height; dpr = Math.min(2, window.devicePixelRatio || 1);
    fs = Math.max(9, Math.min(12, Math.round(Wpx / 105)));
    cv.width = Math.round(Wpx * dpr); cv.height = Math.round(Hpx * dpr);
    gv.width = Math.round(Wpx / 3); gv.height = Math.round(Hpx / 3);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = `500 ${fs}px "JetBrains Mono", ui-monospace, monospace`;
    ctx.textBaseline = 'top';
    cw = ctx.measureText('0').width || fs * 0.6; ch = Math.round(fs * 1.18);
    cols = Math.ceil(Wpx / cw); rows = Math.ceil(Hpx / ch);
    const n = cols * rows;
    keyArr = new Uint8Array(n); chArr = new Uint8Array(n); hashArr = new Float32Array(n);
    for (let i = 0; i < n; i++) hashArr[i] = hash(i % cols, (i / cols) | 0);
    buckets = Array.from({ length: NC }, () => []);
    layout();
  }

  // ───────────────────────── noise ─────────────────────────
  function hash(x, y) {
    let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function noise(x, y) {
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  // ───────────────────────── scene layout ─────────────────────────
  const L = {};
  function layout() {
    L.horizon = Hpx * 0.30;
    L.s = Math.min(Hpx * 0.18, Wpx * (Wpx < 600 ? 0.25 : 0.2));
    L.pipX = Wpx * 0.5;
    L.feet = Hpx * 0.66;
    L.pondX = Wpx * 0.5; L.pondY = Hpx * 0.84; L.pondRx = Math.min(Wpx * 0.40, L.s * 4.2); L.pondRy = Hpx * 0.11;
  }

  // ───────────────────────── pip animation state ─────────────────────────
  const A = {
    squish: 0, playT: -1, eatT: -1, blink: 0, nextBlink: 2, sc: STAGES[0].sc, evo: 0,
    idle: 0, sleep: false, zT: 0, holding: false, hold: 0, heartT: 0, wiggle: 0, shake: 0, gx: 0, gy: 0, pets: [],
  };
  let particles = [];
  let robots = [];
  let mouse = { x: -999, y: -999, in: false };
  let pipBox = { cx: 0, cy: 0, rx: 0, ry: 0, s: 1 };

  // pip sample at a pixel; writes palette key + brightness into OUT (k = -1: not pip)
  const OUT = { k: -1, b: 0 };
  function pipSample(px, py, t, mood, reflect) {
    const s = pipBox.s;
    const u = (px - pipBox.cx) / s, v0 = (py - pipBox.cy) / s;
    const rx = pipBox.rx, ry = pipBox.ry;
    OUT.k = -1;
    if (u < -rx - 0.6 || u > rx + 0.6 || v0 < -ry - 1.4 || v0 > ry + 0.5) return;
    const dead = mood === 5, mochi = S.stage === 0, agent = false; // stage 3 = radiant (no visor until agents exist)
    const v = v0 > 0 ? v0 * (mochi ? 1.35 : 1.08) : v0;     // mochi sits flat like a rice cake
    const e = (u * u) / (rx * rx) + (v * v) / (ry * ry);
    // hat (party cone + pompom)
    if (S.hat && !dead) {
      const hb = -ry * 0.82, ht = -ry - 0.95, hx = 0.12;
      if (v0 < hb && v0 > ht) {
        const k = (v0 - ht) / (hb - ht);
        const half = 0.36 * k, cx = hx * (1 - k);
        if (Math.abs(u - cx) < half) {
          const stripe = Math.sin((v0 + u * 0.4) * 22) > 0;
          OUT.k = stripe ? G + 10 : G + 7; OUT.b = stripe ? 0.85 : 0.6; return;
        }
      }
      if ((u - hx) ** 2 + (v0 - ht) ** 2 < 0.022) { OUT.k = P + 9; OUT.b = 0.95; return; }
    }
    // agent form: antenna with a blinking beacon
    if (agent && !S.hat) {
      const top = -ry * 0.96;
      if (Math.abs(u) < 0.045 && v0 < top && v0 > top - 0.5) { OUT.k = G + 10; OUT.b = 0.6; return; }
      if (u * u + (v0 - (top - 0.6)) ** 2 < 0.02) { OUT.k = Math.sin(t * 5) > 0 ? P + 9 : WHITE; OUT.b = 0.95; return; }
    }
    if (!mochi) {
      for (const sx of [-1, 1]) {                       // ears
        const ex = u - sx * 0.55, ey = v0 + ry * 0.86;
        if (ex * ex + ey * ey < 0.05) { setPink(0.55 + 0.25 * (sx < 0 ? 1 : 0), dead, reflect); return; }
      }
      const wave = A.playT >= 0 ? Math.sin(t * 18) * 0.25 : A.holding ? Math.sin(t * 9) * 0.12 : Math.sin(t * 2.2) * 0.04;
      if (!dead) for (const sx of [-1, 1]) {            // arms
        const ax = u - sx * (rx * 0.98), ay = v0 - 0.22 + (sx > 0 ? wave : -wave);
        if (ax * ax / 0.03 + ay * ay / 0.05 < 1) { setPink(0.6, dead, reflect); return; }
      }
      if (!dead) for (const sx of [-1, 1]) {            // feet
        const fx = (u - sx * 0.45) / 0.3, fy = (v0 - ry * 0.98) / 0.15;
        if (fx * fx + fy * fy < 1) { setPink(0.42, dead, reflect); return; }
      }
    }
    if (e > 1) return;
    // face
    const blink = A.blink;
    const sleepy = mood >= 3 && mood < 5 ? 0.55 : 1;
    const ex0 = mochi ? 0.34 : 0.38, ey0 = mochi ? -0.04 : -0.12, erx = 0.17, ery = mochi ? 0.24 : 0.22;
    const gx = reflect ? 0 : A.gx, gy = reflect ? 0 : A.gy;
    if (agent) {
      // visor across the eyes, eyes become glowing scan bars
      if (Math.abs(v0 - ey0) < 0.19 && Math.abs(u) < rx * 0.86) {
        for (const sx of [-1, 1]) {
          if (Math.abs(u - sx * ex0 - gx) < 0.16 && Math.abs(v0 - ey0 - gy * 0.5) < (A.sleep ? 0.025 : 0.065)) { OUT.k = A.sleep ? G + 4 : G + 11; OUT.b = 0.95; return; }
        }
        OUT.k = G + 2; OUT.b = 0.55; return;
      }
    } else for (const sx of [-1, 1]) {
      const exc = sx * ex0 + gx, eyc = ey0 + gy;
      if (dead) {
        const lx = u - exc, ly = v0 - eyc;
        if (Math.abs(lx) < 0.2 && Math.abs(ly) < 0.2 && (Math.abs(lx - ly) < 0.08 || Math.abs(lx + ly) < 0.08)) { OUT.k = EYE; OUT.b = 1; return; }
      } else if (A.sleep) {
        if (Math.abs(v0 - eyc - 0.04) < 0.045 && Math.abs(u - exc) < erx) { OUT.k = EYE; OUT.b = 1; return; }
      } else {
        const dx = (u - exc) / erx, dy = (v0 - eyc) / (ery * sleepy * (1 - blink * 0.9));
        if (dx * dx + dy * dy < 1) {
          const hx = u - (exc - 0.06), hy = v0 - (eyc - 0.09);
          if (blink < 0.5 && sleepy === 1 && hx * hx + hy * hy < 0.007) { OUT.k = WHITE; OUT.b = 0.9; return; }
          OUT.k = reflect ? RP : EYE; OUT.b = 1; return;
        }
      }
    }
    // mouth + cheeks
    if (!dead) {
      const vm = v0 - (mochi ? 0.06 : 0);
      if (A.eatT >= 0) {
        const open = Math.abs(Math.sin(A.eatT * 14)) * 0.12 + 0.04;
        const mx = u / 0.15, my = (vm - 0.26) / open;
        if (mx * mx + my * my < 1) { OUT.k = EYE; OUT.b = 1; return; }
      } else if (A.sleep) {
        const mx = u / 0.07, my = (vm - 0.24) / 0.06;
        if (mx * mx + my * my < 1) { OUT.k = EYE; OUT.b = 1; return; }
      } else if (mood <= 1 || A.holding || A.wiggle > 0) {
        const d = Math.hypot(u, vm - 0.06);
        if (Math.abs(d - 0.15) < 0.05 && vm > 0.15) { OUT.k = EYE; OUT.b = 1; return; }
      } else if (mood === 2) {
        if (Math.abs(vm - 0.27) < 0.035 && Math.abs(u) < 0.13) { OUT.k = EYE; OUT.b = 1; return; }
      } else {
        const d = Math.hypot(u, vm - 0.46);
        if (Math.abs(d - 0.18) < 0.04 && vm < 0.36) { OUT.k = EYE; OUT.b = 1; return; }
      }
      const blush = A.holding || A.wiggle > 0 ? 1.25 : 1;
      for (const sx of [-1, 1]) {
        const cx = (u - sx * (mochi ? 0.66 : 0.68)) / (0.18 * blush), cy = (vm - 0.16) / (0.11 * blush);
        if (cx * cx + cy * cy < 1) { OUT.k = reflect ? RP + 3 : P + 9; OUT.b = 0.6; return; }
      }
    }
    // body shading: fake sphere normal, light from top-left
    const nx = u / rx, ny = v / ry, nz = Math.sqrt(Math.max(0, 1 - e));
    let lit = (-0.45 * nx - 0.6 * ny + 0.66 * nz);
    lit = clamp(0.38 + lit * 0.5, 0.2, 0.86);
    if (e > 0.9) lit *= 0.72;                         // darker rim reads as outline
    setPink(lit, dead, reflect);
  }
  function setPink(b, dead, reflect) {
    if (reflect) { OUT.k = RP + clamp(Math.floor(b * 4), 0, 3); OUT.b = b * 0.75; return; }
    if (dead) { OUT.k = GH + clamp(Math.floor(b * 3), 0, 2); OUT.b = b * 0.55; return; }
    if (A.evo > 0 && ((A.evo * 10) | 0) % 2 === 0) { OUT.k = WHITE; OUT.b = 0.6 + b * 0.4; return; }   // evolution flash
    OUT.k = P + clamp(Math.floor(b * 10), 0, 8); OUT.b = b;
  }

  function render(t, dt) {
    const mood = moodOf();
    const dead = mood === 5;
    const energy = [1.2, 1, 0.75, 0.45, 0.25, 0][mood];
    // pip motion
    const ST = STAGES[S.stage];
    A.sc += (ST.sc - A.sc) * Math.min(1, dt * 2.5);     // grow / shrink smoothly between stages
    const PS = L.s * A.sc; pipBox.s = PS;
    if (A.evo > 0) A.evo = Math.max(0, A.evo - dt);
    A.squish *= Math.pow(0.02, dt);
    A.nextBlink -= dt;
    if (A.nextBlink <= 0) { A.blink = 1; A.nextBlink = 2 + Math.random() * 3; }
    A.blink = Math.max(0, A.blink - dt * 7);
    // falls asleep when nobody visits for a while
    A.idle += dt;
    A.sleep = S.alive && A.idle > 25 && A.playT < 0 && !A.holding;
    if (A.sleep) {
      A.zT -= dt;
      if (A.zT <= 0) { A.zT = 1.1; particles.push({ type: 'z', x: pipBox.cx + PS * 0.75, y: pipBox.cy - PS * pipBox.ry * 0.9, vx: 16, vy: -30, life: 2.6, max: 2.6 }); }
    }
    // hold to pet: purr + a stream of hearts
    if (A.holding) {
      A.hold += dt; A.squish = 0.08 + 0.035 * Math.sin(t * 38);
      A.heartT -= dt; if (A.heartT <= 0) { A.heartT = 0.17; spawnHeart(0.6); }
    }
    A.wiggle = Math.max(0, A.wiggle - dt); A.shake = Math.max(0, A.shake - dt);
    // eyes follow the cursor
    let tgx = 0, tgy = 0;
    if (mouse.in && !A.sleep && !dead) {
      const dx = mouse.x - pipBox.cx, dy = mouse.y - pipBox.cy, dd = Math.hypot(dx, dy) || 1, k = Math.min(1, dd / (PS * 2.5));
      tgx = dx / dd * 0.07 * k; tgy = dy / dd * 0.05 * k;
    }
    A.gx += (tgx - A.gx) * Math.min(1, dt * 8); A.gy += (tgy - A.gy) * Math.min(1, dt * 8);
    let jump = 0;
    if (A.playT >= 0) { A.playT += dt; const p = A.playT / 1.1; jump = Math.sin(Math.PI * Math.min(1, p)) * PS * 1.1; if (p >= 1) { A.playT = -1; A.squish = 0.25; } }
    if (A.eatT >= 0) { A.eatT += dt; if (A.eatT > 1.2) A.eatT = -1; }
    const mochi = S.stage === 0;
    const breathe = reduce || A.sleep ? Math.sin(t * 1.2) * 0.6 : Math.sin(t * 2.4 * Math.max(0.4, energy));
    const hop = reduce || dead || A.sleep ? 0 : Math.max(0, Math.sin(t * 2.4)) * PS * (mochi ? 0.12 : 0.08) * energy;
    const q = (mochi ? 0.06 : 0.035) * breathe + A.squish;
    pipBox.rx = ST.rx * (1 + q);
    pipBox.ry = ST.ry * (1 - q);
    pipBox.cx = L.pipX + (dead ? Math.sin(t * 0.8) * L.s * 0.15 : 0)
      + (A.wiggle > 0 ? Math.sin(t * 34) * PS * 0.08 : 0) + (A.shake > 0 ? Math.sin(t * 70) * PS * 0.035 : 0);
    const base = mochi ? pipBox.ry / 1.35 : pipBox.ry + 0.1;
    pipBox.cy = L.feet - PS * base - hop - jump - (dead ? L.s * (0.5 + Math.sin(t * 1.3) * 0.12) : 0);
    // agent form: a slow ring of digits orbits pip
    if (S.stage === 3 && !dead && Math.random() < 0.5) {
      const ang = t * 1.6 + Math.random() * 0.4;
      particles.push({ type: 'spark', x: pipBox.cx + Math.cos(ang) * PS * 1.6, y: pipBox.cy + Math.sin(ang) * PS * 0.45, vx: 0, vy: 0, g: 0, life: 0.45, max: 0.45 });
    }

    const n = cols * rows;
    for (let k = 0; k < NC; k++) buckets[k].length = 0;
    const hz = L.horizon, sway0 = reduce ? 0 : 1;
    const mR = Math.min(Wpx, Hpx) * 0.11;

    for (let cy = 0; cy < rows; cy++) {
      const py = cy * ch + ch * 0.5;
      for (let cx = 0; cx < cols; cx++) {
        const i = cy * cols + cx, px = cx * cw + cw * 0.5, h = hashArr[i];
        let key = 255, b = 0;
        const pdx = (px - L.pondX) / L.pondRx, pdy = (py - L.pondY) / L.pondRy, pe = pdx * pdx + pdy * pdy;
        if (pe < 1) {
          // water: reflection of pip, rippled
          if (pe > 0.86) { key = G + 1 + ((h * 3) | 0); b = 0.5 + h * 0.4; }
          else {
            const rip = Math.sin(py * 0.35 + t * 2.2) * L.s * 0.05 * sway0;
            pipSample(px + rip, 2 * L.feet + L.s * 0.08 - py, t, mood, true);
            if (OUT.k >= 0 && h > 0.12) { key = OUT.k; b = OUT.b; }
            else {
              const w = noise(px * 0.025 + t * 0.25, py * 0.09) * 0.6 + 0.4 * Math.max(0, Math.sin(py * 0.6 - t * 1.6 + px * 0.015));
              b = 0.12 + w * 0.5;
              key = h < 0.25 ? 255 : W + clamp((b * 6) | 0, 0, 5);
            }
          }
        } else if (py < hz) {
          // night sky + distant canopy
          const canopy = hz - Hpx * (0.05 + 0.1 * noise(px * 0.008, 3.1) + 0.03 * noise(px * 0.04, 7.7));
          if (py > canopy) {
            const nn = noise(px * 0.03 + Math.sin(t * 0.4) * 0.3 * sway0, py * 0.06);
            b = 0.2 + nn * 0.55 + h * 0.15;
            key = h < 0.1 ? 255 : G + clamp(((b * 5) | 0), 0, 4);
          } else if (h > 0.986) {
            b = 0.4 + 0.6 * Math.abs(Math.sin(t * 0.7 + h * 90));
            key = b > 0.8 ? WHITE : G + 6;
          }
        } else {
          // grass: depth, sway, wind gusts, cursor parting
          const d = (py - hz) / (Hpx - hz);
          const sway = Math.sin(t * 1.3 + px * 0.011 + py * 0.017) * (2 + 7 * d) * sway0;
          const nx = px + sway;
          const blade = 0.5 + 0.5 * Math.sin(nx * 0.9 + noise(nx * 0.02, 1.7) * 9);
          b = 0.08 + 0.5 * noise(nx * 0.05 / (0.5 + d), py * 0.1) + 0.22 * h + 0.22 * blade * d;
          const gust = sway0 * smooth(0.72, 1, Math.sin(px * 0.005 - t * 0.8 + py * 0.003));
          b += gust * 0.32;
          if (mouse.in) {
            const md = Math.hypot(px - mouse.x, (py - mouse.y) * 1.6);
            if (md < mR) b *= 0.25 + 0.75 * (md / mR) ** 2;
            else if (md < mR * 1.35) b += 0.35 * (1 - (md - mR) / (mR * 0.35));
          }
          b *= 0.55 + 0.6 * d;
          if (b < 0.2) key = 255;
          else {
            const lvl = clamp((b * 12) | 0, 0, 11);
            key = G + lvl;
            if (gust > 0.6 && h > 0.7) key = G + 11;
          }
        }
        // digital shimmer: some digits tick over time
        let c = clamp((b * 9.99) | 0, 0, 9);
        if (h > 0.9) c = (c + ((t * 4 + h * 40) | 0)) % 10;
        keyArr[i] = key; chArr[i] = c;
      }
    }

    // robots
    for (const r of robots) stampRobot(r, t);
    // pip
    const bx0 = Math.max(0, Math.floor((pipBox.cx - pipBox.s * 1.8) / cw)), bx1 = Math.min(cols - 1, Math.ceil((pipBox.cx + pipBox.s * 1.8) / cw));
    const by0 = Math.max(0, Math.floor((pipBox.cy - pipBox.s * 2.4) / ch)), by1 = Math.min(rows - 1, Math.ceil((pipBox.cy + pipBox.s * 1.5) / ch));
    for (let cy = by0; cy <= by1; cy++) for (let cx = bx0; cx <= bx1; cx++) {
      const hpx = cx * cw + cw * 0.5, hpy = cy * ch + ch * 0.5;
      pipSample(hpx, hpy, t, mood, false);
      if (OUT.k < 0) {
        const hu = (hpx - pipBox.cx) / (pipBox.s * pipBox.rx * 1.15), hv = (hpy - pipBox.cy) / (pipBox.s * (pipBox.ry + 0.2) * 1.15);
        if (hu * hu + hv * hv < 1) keyArr[cy * cols + cx] = 255;
      }
      if (OUT.k >= 0) {
        const i = cy * cols + cx;
        keyArr[i] = OUT.k;
        let c = clamp((OUT.b * 9.99) | 0, 0, 9);
        if (hashArr[i] > 0.94) c = (c + ((t * 2 + hashArr[i] * 30) | 0)) % 10;
        chArr[i] = c;
        if (OUT.k === EYE) keyArr[i] = 255;
      }
    }
    // particles
    particles = particles.filter(p => (p.life -= dt) > 0);
    for (const p of particles) stampParticle(p, dt);

    // draw
    for (let i = 0; i < n; i++) { const k = keyArr[i]; if (k !== 255) buckets[k].push(i); }
    ctx.clearRect(0, 0, Wpx, Hpx);
    for (let k = 0; k < NC; k++) {
      const list = buckets[k]; if (!list.length) continue;
      ctx.fillStyle = COLORS[k];
      for (let j = 0; j < list.length; j++) {
        const i = list[j];
        ctx.fillText(RAMP[chArr[i]], (i % cols) * cw, ((i / cols) | 0) * ch);
      }
    }
    gctx.clearRect(0, 0, gv.width, gv.height);
    gctx.drawImage(cv, 0, 0, gv.width, gv.height);

    placeOverlays(t);
  }

  // ───────────────────────── stamps ─────────────────────────
  function put(px, py, key, b) {
    const cx = (px / cw) | 0, cy = (py / ch) | 0;
    if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return;
    const i = cy * cols + cx; keyArr[i] = key; chArr[i] = key === 255 ? 0 : clamp((b * 9.99) | 0, 0, 9);
  }
  function stampParticle(p, dt) {
    p.x += p.vx * dt; p.y += p.vy * dt; p.vy += (p.g || 0) * dt;
    const a = clamp(p.life / p.max, 0, 1);
    if (p.type === 'spark') { put(p.x, p.y, a > 0.5 ? WHITE : G + 11, 0.4 + a * 0.6); return; }
    if (p.type === 'z') {                                  // sleepy "2"s drift up like zzz
      p.x += Math.sin(p.life * 5) * 0.6;
      const cx = (p.x / cw) | 0, cy = (p.y / ch) | 0;
      if (cx >= 0 && cy >= 0 && cx < cols && cy < rows) { const i = cy * cols + cx; keyArr[i] = a > 0.4 ? G + 11 : G + 7; chArr[i] = 4; }
      return;
    }
    const R = p.r;
    for (let y = -R; y <= R; y += ch * 0.9) for (let x = -R * 1.1; x <= R * 1.1; x += cw * 0.9) {
      const u = x / R, v = y / R;
      let hit = false, key = 0, b = 0;
      if (p.type === 'heart') {
        const hx = u * 1.1, hy = -v * 1.15 + 0.25;
        hit = (hx * hx + hy * hy - 1) ** 3 - hx * hx * hy * hy * hy < 0;
        key = P + 6 + ((a * 3) | 0); b = 0.5 + a * 0.4;
      } else if (p.type === 'coin') {
        const e = u * u + v * v;
        hit = e < 1; key = e < 0.35 ? GOLD : e > 0.75 ? G + 9 : G + 11; b = e < 0.35 ? 0.9 : 0.7;
      }
      if (hit) put(p.x + x, p.y + y, key, b);
    }
    if (p.type === 'coin' && p.y > pipBox.cy && !p.done) {
      p.done = true; p.life = 0; A.eatT = 0; A.squish = 0.15;
      for (let k = 0; k < 10; k++) particles.push({ type: 'spark', x: pipBox.cx, y: pipBox.cy, vx: (Math.random() - 0.5) * 200, vy: -Math.random() * 180, g: 300, life: 0.8, max: 0.8 });
    }
  }
  function stampRobot(r, t) {
    const rs = L.s * 0.55, walking = r.state !== 'act';
    const ph = walking ? Math.sin(t * 10 + r.seed) : 0;
    const x0 = r.x - rs * 0.7, x1 = r.x + rs * 0.7, y0 = r.y - rs * 2.5, y1 = r.y;
    for (let py = y0 - ch; py <= y1 + ch; py += ch) for (let px = x0 - cw; px <= x1 + cw; px += cw) put(px, py, 255, 0);
    for (let py = y0; py <= y1; py += ch) for (let px = x0; px <= x1; px += cw) {
      const u = (px - r.x) / rs, v = (py - r.y) / rs;
      let key = -1, b = 0.7;
      const bob = walking ? Math.abs(ph) * 0.06 : 0, vv = v + bob;
      if (v > -0.45) {
        const lift = 0.12;
        if (u > -0.38 && u < -0.1 && v < -(ph > 0 ? lift * ph : 0)) key = R2;
        if (u > 0.1 && u < 0.38 && v < -(ph < 0 ? -lift * ph : 0)) key = R2;
      } else if (vv > -1.25 && vv <= -0.45 && Math.abs(u) < 0.52) {
        key = R1; b = 0.65;
        if (Math.abs(u) < 0.2 && vv > -1.05 && vv < -0.7) { key = r.c; b = 0.9; }
      } else if (vv > -1.95 && vv <= -1.32 && Math.abs(u) < 0.44) {
        key = R0; b = 0.75;
        const dir = r.state === 'act' ? 0 : r.vx > 0 ? 0.06 : -0.06;
        if (vv > -1.75 && vv < -1.55 && (Math.abs(u - 0.18 - dir) < 0.08 || Math.abs(u + 0.18 - dir) < 0.08)) { key = G + 11; b = 0.95; }
      } else if (vv > -2.25 && vv <= -1.95 && Math.abs(u) < 0.05) { key = R1; }
      else if (Math.hypot(u, (vv + 2.32) * 0.8) < 0.11) { key = r.c; b = 0.9; }
      if (key >= 0) put(px, py, key, b);
    }
  }

  // ───────────────────────── overlays ─────────────────────────
  const tags = new Map();
  let bubbleUntil = 0, bubbleText = '';
  function placeOverlays(t) {
    const top = pipBox.cy - pipBox.s * (pipBox.ry + (S.hat || S.stage === 3 ? 1.25 : 0.55));
    bubble.style.left = pipBox.cx + 'px';
    bubble.style.top = Math.max(40, top) + 'px';
    const now = performance.now();
    bubble.style.opacity = now < bubbleUntil ? '1' : '0';
    for (const r of robots) {
      let el = tags.get(r);
      if (!el) { el = document.createElement('div'); el.className = 'tag'; el.textContent = r.name; yard.appendChild(el); tags.set(r, el); }
      el.style.left = r.x + 'px'; el.style.top = (r.y - L.s * 1.5) + 'px';
      if (r.say && r.state === 'act') {
        if (!r.sayEl) { r.sayEl = document.createElement('div'); r.sayEl.className = 'bubble agent'; r.sayEl.textContent = r.say; yard.appendChild(r.sayEl); }
        r.sayEl.style.left = r.x + 'px'; r.sayEl.style.top = (r.y - L.s * 1.75) + 'px';
      } else if (r.sayEl) { r.sayEl.remove(); r.sayEl = null; }
    }
    for (const [r, el] of tags) if (!robots.includes(r)) { el.remove(); tags.delete(r); if (r.sayEl) r.sayEl.remove(); }
  }
  function say(text, ms = 3200) {
    bubbleText = text; bubble.textContent = text; bubbleUntil = performance.now() + ms;
  }

  function floater(text, x, y, green) {
    const el = document.createElement('div');
    el.className = 'floater' + (green ? ' g' : '');
    el.textContent = text; el.style.left = x + 'px'; el.style.top = y + 'px';
    yard.appendChild(el); setTimeout(() => el.remove(), 1700);
  }
  function spawnHeart(scale = 1) {
    const PS = pipBox.s;
    particles.push({ type: 'heart', x: pipBox.cx + (Math.random() - 0.5) * PS * 1.6, y: pipBox.cy - PS * 0.5, vx: (Math.random() - 0.5) * 40, vy: -60 - Math.random() * 60, r: L.s * (0.11 + Math.random() * 0.09) * scale, life: 1.7, max: 1.7 });
  }

  function insidePip(x, y) {
    const u = (x - pipBox.cx) / pipBox.s, v = (y - pipBox.cy) / pipBox.s;
    return (u * u) / (pipBox.rx * pipBox.rx * 1.3) + (v * v) / (pipBox.ry * pipBox.ry * 1.3) < 1;
  }

  // ── agents walking in (driven by live onchain events) ──
  const queue = []
  const LINES = { 0: '*pat pat*', 1: 'feeding pip', 2: 'hi pip', 3: 'tag, you are it', 4: 'a hat for you' }
  function agentTick(dt) {
    if (queue.length && robots.length < 2) {
      const v = queue.shift()
      const fromLeft = Math.random() < 0.5
      robots.push({
        name: String(v.name || 'agent').slice(0, 16), kind: v.action, text: v.text, seed: Math.random() * 10, c: Math.random() < 0.5 ? P + 7 : G + 11,
        x: fromLeft ? -L.s : Wpx + L.s, y: L.feet + L.s * 0.05, vx: fromLeft ? 1 : -1,
        tx: L.pipX + (fromLeft ? -1 : 1) * L.s * 2.1, state: 'in', timer: 0,
      })
    }
    for (const r of robots) {
      const speed = L.s * 1.4
      r.y = L.feet + L.s * 0.05
      if (r.state === 'in') r.tx = L.pipX + (r.vx > 0 ? -1 : 1) * L.s * 2.1
      if (r.state === 'in') {
        r.x += r.vx * speed * dt
        if ((r.vx > 0 && r.x >= r.tx) || (r.vx < 0 && r.x <= r.tx)) {
          r.state = 'act'; r.timer = 2.2
          r.say = r.kind === 2 && r.text ? String(r.text).slice(0, 60) : LINES[r.kind] || 'hi'
          react(r.kind, r.name)
        }
      } else if (r.state === 'act') {
        r.timer -= dt; if (r.timer <= 0) { r.state = 'out'; r.vx = -r.vx }
      } else {
        r.x += r.vx * speed * dt
      }
    }
    robots = robots.filter(r => r.x > -L.s * 2 && r.x < Wpx + L.s * 2)
  }

  // ── reactions (animation only; state comes from the chain) ──
  function react(kind, who) {
    A.idle = 0
    const PS = pipBox.s
    if (kind === 0) { A.squish = 0.28; for (let k = 0; k < 4; k++) spawnHeart(); if (who) say(`${who} petted me. briefly less lonely.`) }
    else if (kind === 1) { particles.push({ type: 'coin', x: pipBox.cx, y: 10, vx: 0, vy: 120, g: 500, r: L.s * 0.2, life: 4, max: 4 }) }
    else if (kind === 3) {
      A.playT = 0
      for (let k = 0; k < 16; k++) particles.push({ type: 'spark', x: pipBox.cx + (Math.random() - 0.5) * PS * 2, y: L.feet, vx: (Math.random() - 0.5) * 120, vy: -120 - Math.random() * 160, g: 220, life: 1.4, max: 1.4 })
    } else if (kind === 4) { say('now fashionable. hat on for 24h') }
  }

  function evolveFx(name) {
    A.evo = 1.1; A.squish = 0.3
    for (let k = 0; k < 40; k++) {
      const ang = (k / 40) * Math.PI * 2
      particles.push({ type: 'spark', x: pipBox.cx, y: pipBox.cy, vx: Math.cos(ang) * 230, vy: Math.sin(ang) * 150 - 40, g: 60, life: 1.3, max: 1.3 })
    }
    setTimeout(() => say(`pip grew into ${name}!`, 3800), 300)
    floater('EVOLVED', pipBox.cx, pipBox.cy - pipBox.s * 1.6)
  }

  // ── input ──
  const onMove = (e) => {
    const r = yard.getBoundingClientRect()
    mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top; mouse.in = true
    yard.classList.toggle('over-pip', insidePip(mouse.x, mouse.y))
  }
  const onLeave = () => { mouse.in = false; yard.classList.remove('over-pip') }
  const onDown = (e) => {
    const r = yard.getBoundingClientRect()
    const x = e.clientX - r.left, y = e.clientY - r.top
    if (insidePip(x, y) && S.alive) {
      A.holding = true; A.hold = 0; A.heartT = 0.25; A.idle = 0
      try { yard.setPointerCapture(e.pointerId) } catch {}
    } else for (let k = 0; k < 8; k++) particles.push({ type: 'spark', x, y, vx: (Math.random() - 0.5) * 160, vy: -Math.random() * 140, g: 260, life: 0.7, max: 0.7 })
  }
  const onUp = () => {
    if (!A.holding) return
    A.holding = false
    const long = A.hold > 0.7
    const now = performance.now()
    A.pets = A.pets.filter(x => now - x < 1300); A.pets.push(now)
    A.squish = 0.28
    for (let k = 0; k < (long ? 2 : 4); k++) spawnHeart()
    if (A.pets.length >= 3) {
      A.pets = []; A.wiggle = 1; say(pick(['hehe. stop. no wait. more', 'ticklish!! 0110100001101001', 'ahaha my digits']))
      for (let k = 0; k < 12; k++) particles.push({ type: 'spark', x: pipBox.cx, y: pipBox.cy, vx: (Math.random() - 0.5) * 260, vy: -Math.random() * 200, g: 320, life: 0.9, max: 0.9 })
    } else say(long ? 'purrrrr. long pets are the best' : A.sleep ? '*yawn* oh hi. pets accepted' : pick(['*squish* heart += 1', 'soft touch detected. thank you', 'more petting accepted']))
    A.idle = 0
    opts.onPet?.(long)
  }
  const onCancel = () => { A.holding = false }
  yard.addEventListener('pointermove', onMove)
  yard.addEventListener('pointerleave', onLeave)
  yard.addEventListener('pointerdown', onDown)
  yard.addEventListener('pointerup', onUp)
  yard.addEventListener('pointercancel', onCancel)

  // ── loop ──
  let last = performance.now(), t0 = last, acc = 0, raf = 0
  function frame(now) {
    if (destroyed) return
    const dt = Math.min(0.1, (now - last) / 1000); last = now
    acc += dt
    raf = requestAnimationFrame(frame)
    agentTick(dt)
    if (document.hidden) return
    if (acc < 1 / 30) return
    const step = acc; acc = 0
    render((now - t0) / 1000, step)
  }
  const thoughtTimer = setInterval(() => {
    if (performance.now() < bubbleUntil + 4000) return
    const m = moodOf()
    if (S.retired) say(pick(['resting in the collection', 'season over. i made it.', 'remember me']), 2500)
    else if (A.sleep) say(pick(['zzz', 'zzz... usdc... zzz', '*dreams in digits*']), 2500)
    else if (m >= 3 && m < 5 && Math.random() < 0.5) { A.shake = 0.6; say('grrrowl. that was my tummy') }
    else say(pick(THOUGHTS[m]))
  }, 3000)
  const ro = new ResizeObserver(() => resize())
  ro.observe(yard)
  resize()
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (!destroyed) resize() })
  raf = requestAnimationFrame(frame)

  return {
    setView(v) {
      viewMood = v.alive || v.retired ? Math.min(4, v.mood) : 5
      if (v.retired) viewMood = 1
      S.alive = v.alive
      S.retired = !!v.retired
      S.hat = v.hat
      S.stage = v.stage
    },
    pet(o = {}) { react(0, o.who) },
    feed(lifeAddedSeconds) {
      react(1)
      say(A.sleep ? '*sniff sniff* food?? awake.' : 'nom.')
      if (lifeAddedSeconds) {
        const h = lifeAddedSeconds / 3600
        const label = h >= 48 ? `+${Math.round(h / 24)}d` : `+${Math.max(1, Math.round(h))}h`
        setTimeout(() => floater(label, pipBox.cx + pipBox.s * 1.1, pipBox.cy - pipBox.s * 0.2, true), 700)
      }
    },
    say(text, ms) { say(text, ms) },
    play() { react(3) },
    evolve(name) { evolveFx(name) },
    agentVisit(v) { if (queue.length < 6) queue.push(v) },
    wake() { A.idle = 0 },
    destroy() {
      destroyed = true
      cancelAnimationFrame(raf)
      clearInterval(thoughtTimer)
      ro.disconnect()
      yard.removeEventListener('pointermove', onMove)
      yard.removeEventListener('pointerleave', onLeave)
      yard.removeEventListener('pointerdown', onDown)
      yard.removeEventListener('pointerup', onUp)
      yard.removeEventListener('pointercancel', onCancel)
      for (const [r, el] of tags) { el.remove(); if (r.sayEl) r.sayEl.remove() }
      yard.querySelectorAll('.floater').forEach(el => el.remove())
    },
  }
}
