/**
 * pip's SDF-style sampler, ported 1:1 from the prototype's `pipSample()` / `setPink()`.
 * Pure: reads a ShapeState, writes the palette key + brightness into `OUT`.
 */
import { clamp } from './noise'
import { EYE, G, GH, P, RP, WHITE } from './palette'
import type { Mood, ShapeState } from './types'

/** k = -1 means "not pip". Reused across calls (no per-cell allocation). */
export const OUT = { k: -1, b: 0 }

export function setPink(S: ShapeState, b: number, dead: boolean, reflect: boolean): void {
  if (reflect) { OUT.k = RP + clamp(Math.floor(b * 4), 0, 3); OUT.b = b * 0.75; return }
  if (dead) { OUT.k = GH + clamp(Math.floor(b * 3), 0, 2); OUT.b = b * 0.55; return }
  if (S.A.evo > 0 && ((S.A.evo * 10) | 0) % 2 === 0) { OUT.k = WHITE; OUT.b = 0.6 + b * 0.4; return } // evolution flash
  OUT.k = P + clamp(Math.floor(b * 10), 0, 8); OUT.b = b
}

const SIDES = [-1, 1] as const

export function pipSample(S: ShapeState, px: number, py: number, t: number, mood: Mood, reflect: boolean): void {
  const box = S.box, A = S.A
  const s = box.s
  const u = (px - box.cx) / s, v0 = (py - box.cy) / s
  const rx = box.rx, ry = box.ry
  OUT.k = -1
  if (u < -rx - 0.6 || u > rx + 0.6 || v0 < -ry - 1.4 || v0 > ry + 0.5) return
  const dead = mood === 5, mochi = S.stage === 0, agent = S.stage === 3 && !dead
  const v = v0 > 0 ? v0 * (mochi ? 1.35 : 1.08) : v0 // mochi sits flat like a rice cake
  const e = (u * u) / (rx * rx) + (v * v) / (ry * ry)
  // hat (party cone + pompom)
  if (S.hat && !dead) {
    const hb = -ry * 0.82, ht = -ry - 0.95, hx = 0.12
    if (v0 < hb && v0 > ht) {
      const k = (v0 - ht) / (hb - ht)
      const half = 0.36 * k, cx = hx * (1 - k)
      if (Math.abs(u - cx) < half) {
        const stripe = Math.sin((v0 + u * 0.4) * 22) > 0
        OUT.k = stripe ? G + 10 : G + 7; OUT.b = stripe ? 0.85 : 0.6; return
      }
    }
    if ((u - hx) ** 2 + (v0 - ht) ** 2 < 0.022) { OUT.k = P + 9; OUT.b = 0.95; return }
  }
  // agent form: antenna with a blinking beacon
  if (agent && !S.hat) {
    const top = -ry * 0.96
    if (Math.abs(u) < 0.045 && v0 < top && v0 > top - 0.5) { OUT.k = G + 10; OUT.b = 0.6; return }
    if (u * u + (v0 - (top - 0.6)) ** 2 < 0.02) { OUT.k = Math.sin(t * 5) > 0 ? P + 9 : WHITE; OUT.b = 0.95; return }
  }
  if (!mochi) {
    for (const sx of SIDES) { // ears
      const ex = u - sx * 0.55, ey = v0 + ry * 0.86
      if (ex * ex + ey * ey < 0.05) { setPink(S, 0.55 + 0.25 * (sx < 0 ? 1 : 0), dead, reflect); return }
    }
    const wave = A.playT >= 0 ? Math.sin(t * 18) * 0.25 : A.holding ? Math.sin(t * 9) * 0.12 : Math.sin(t * 2.2) * 0.04
    if (!dead) for (const sx of SIDES) { // arms
      const ax = u - sx * (rx * 0.98), ay = v0 - 0.22 + (sx > 0 ? wave : -wave)
      if ((ax * ax) / 0.03 + (ay * ay) / 0.05 < 1) { setPink(S, 0.6, dead, reflect); return }
    }
    if (!dead) for (const sx of SIDES) { // feet
      const fx = (u - sx * 0.45) / 0.3, fy = (v0 - ry * 0.98) / 0.15
      if (fx * fx + fy * fy < 1) { setPink(S, 0.42, dead, reflect); return }
    }
  }
  if (e > 1) return
  // face
  const blink = A.blink
  const sleepy = mood >= 3 && mood < 5 ? 0.55 : 1
  const ex0 = mochi ? 0.34 : 0.38, ey0 = mochi ? -0.04 : -0.12, erx = 0.17, ery = mochi ? 0.24 : 0.22
  const gx = reflect ? 0 : A.gx, gy = reflect ? 0 : A.gy
  if (agent) {
    // visor across the eyes, eyes become glowing scan bars
    if (Math.abs(v0 - ey0) < 0.19 && Math.abs(u) < rx * 0.86) {
      for (const sx of SIDES) {
        if (Math.abs(u - sx * ex0 - gx) < 0.16 && Math.abs(v0 - ey0 - gy * 0.5) < (A.sleep ? 0.025 : 0.065)) {
          OUT.k = A.sleep ? G + 4 : G + 11; OUT.b = 0.95; return
        }
      }
      OUT.k = G + 2; OUT.b = 0.55; return
    }
  } else for (const sx of SIDES) {
    const exc = sx * ex0 + gx, eyc = ey0 + gy
    if (dead) {
      const lx = u - exc, ly = v0 - eyc
      if (Math.abs(lx) < 0.2 && Math.abs(ly) < 0.2 && (Math.abs(lx - ly) < 0.08 || Math.abs(lx + ly) < 0.08)) { OUT.k = EYE; OUT.b = 1; return }
    } else if (A.sleep) {
      if (Math.abs(v0 - eyc - 0.04) < 0.045 && Math.abs(u - exc) < erx) { OUT.k = EYE; OUT.b = 1; return }
    } else {
      const dx = (u - exc) / erx, dy = (v0 - eyc) / (ery * sleepy * (1 - blink * 0.9))
      if (dx * dx + dy * dy < 1) {
        const hx = u - (exc - 0.06), hy = v0 - (eyc - 0.09)
        if (blink < 0.5 && sleepy === 1 && hx * hx + hy * hy < 0.007) { OUT.k = WHITE; OUT.b = 0.9; return }
        OUT.k = reflect ? RP : EYE; OUT.b = 1; return
      }
    }
  }
  // mouth + cheeks
  if (!dead) {
    const vm = v0 - (mochi ? 0.06 : 0)
    if (A.eatT >= 0) {
      const open = Math.abs(Math.sin(A.eatT * 14)) * 0.12 + 0.04
      const mx = u / 0.15, my = (vm - 0.26) / open
      if (mx * mx + my * my < 1) { OUT.k = EYE; OUT.b = 1; return }
    } else if (A.sleep) {
      const mx = u / 0.07, my = (vm - 0.24) / 0.06
      if (mx * mx + my * my < 1) { OUT.k = EYE; OUT.b = 1; return }
    } else if (mood <= 1 || A.holding || A.wiggle > 0) {
      const d = Math.hypot(u, vm - 0.06)
      if (Math.abs(d - 0.15) < 0.05 && vm > 0.15) { OUT.k = EYE; OUT.b = 1; return }
    } else if (mood === 2) {
      if (Math.abs(vm - 0.27) < 0.035 && Math.abs(u) < 0.13) { OUT.k = EYE; OUT.b = 1; return }
    } else {
      const d = Math.hypot(u, vm - 0.46)
      if (Math.abs(d - 0.18) < 0.04 && vm < 0.36) { OUT.k = EYE; OUT.b = 1; return }
    }
    const blush = A.holding || A.wiggle > 0 ? 1.25 : 1
    for (const sx of SIDES) {
      const cx = (u - sx * (mochi ? 0.66 : 0.68)) / (0.18 * blush), cy = (vm - 0.16) / (0.11 * blush)
      if (cx * cx + cy * cy < 1) { OUT.k = reflect ? RP + 3 : P + 9; OUT.b = 0.6; return }
    }
  }
  // body shading: fake sphere normal, light from top-left
  const nx = u / rx, ny = v / ry, nz = Math.sqrt(Math.max(0, 1 - e))
  let lit = -0.45 * nx - 0.6 * ny + 0.66 * nz
  lit = clamp(0.38 + lit * 0.5, 0.2, 0.86)
  if (e > 0.9) lit *= 0.72 // darker rim reads as outline
  setPink(S, lit, dead, reflect)
}

/** Hit test for clicks (slightly generous ellipse). */
export function insidePip(box: { cx: number; cy: number; rx: number; ry: number; s: number }, x: number, y: number): boolean {
  const u = (x - box.cx) / box.s, v = (y - box.cy) / box.s
  return (u * u) / (box.rx * box.rx * 1.3) + (v * v) / (box.ry * box.ry * 1.3) < 1
}
