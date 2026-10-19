/** Robots (agents) and particles (heart, coin, spark, z), ported 1:1 from the prototype stamps. */
import { clamp } from './noise'
import { EMPTY, G, GOLD, P, R0, R1, R2, WHITE } from './palette'
import type { Grid, Layout, Particle, Robot } from './types'

export function put(g: Grid, px: number, py: number, key: number, b: number): void {
  const cx = (px / g.cw) | 0, cy = (py / g.ch) | 0
  if (cx < 0 || cy < 0 || cx >= g.cols || cy >= g.rows) return
  const i = cy * g.cols + cx
  g.keyArr[i] = key; g.chArr[i] = key === EMPTY ? 0 : clamp((b * 9.99) | 0, 0, 9)
}

/**
 * Moves + stamps one particle. Returns true the frame a coin reaches pip's center
 * (the engine then plays the chew + crumbs).
 */
export function stampParticle(g: Grid, p: Particle, dt: number, pipCy: number): boolean {
  p.x += p.vx * dt; p.y += p.vy * dt; p.vy += (p.g || 0) * dt
  const a = clamp(p.life / p.max, 0, 1)
  if (p.type === 'spark') { put(g, p.x, p.y, a > 0.5 ? WHITE : G + 11, 0.4 + a * 0.6); return false }
  if (p.type === 'z') { // sleepy "2"s drift up like zzz
    p.x += Math.sin(p.life * 5) * 0.6
    const cx = (p.x / g.cw) | 0, cy = (p.y / g.ch) | 0
    if (cx >= 0 && cy >= 0 && cx < g.cols && cy < g.rows) { const i = cy * g.cols + cx; g.keyArr[i] = a > 0.4 ? G + 11 : G + 7; g.chArr[i] = 4 }
    return false
  }
  const R = p.r ?? 10
  for (let y = -R; y <= R; y += g.ch * 0.9) for (let x = -R * 1.1; x <= R * 1.1; x += g.cw * 0.9) {
    const u = x / R, v = y / R
    let hit = false, key = 0, b = 0
    if (p.type === 'heart') {
      const hx = u * 1.1, hy = -v * 1.15 + 0.25
      hit = (hx * hx + hy * hy - 1) ** 3 - hx * hx * hy * hy * hy < 0
      key = P + 6 + ((a * 3) | 0); b = 0.5 + a * 0.4
    } else if (p.type === 'coin') {
      const e = u * u + v * v
      hit = e < 1; key = e < 0.35 ? GOLD : e > 0.75 ? G + 9 : G + 11; b = e < 0.35 ? 0.9 : 0.7
    }
    if (hit) put(g, p.x + x, p.y + y, key, b)
  }
  if (p.type === 'coin' && p.y > pipCy && !p.done) {
    p.done = true; p.life = 0
    return true
  }
  return false
}

export function stampRobot(g: Grid, L: Layout, r: Robot, t: number): void {
  const { cw, ch } = g
  const rs = L.s * 0.55, walking = r.state !== 'act'
  const ph = walking ? Math.sin(t * 10 + r.seed) : 0
  const x0 = r.x - rs * 0.7, x1 = r.x + rs * 0.7, y0 = r.y - rs * 2.5, y1 = r.y
  for (let py = y0 - ch; py <= y1 + ch; py += ch) for (let px = x0 - cw; px <= x1 + cw; px += cw) put(g, px, py, EMPTY, 0)
  for (let py = y0; py <= y1; py += ch) for (let px = x0; px <= x1; px += cw) {
    const u = (px - r.x) / rs, v = (py - r.y) / rs
    let key = -1, b = 0.7
    const bob = walking ? Math.abs(ph) * 0.06 : 0, vv = v + bob
    if (v > -0.45) {
      const lift = 0.12
      if (u > -0.38 && u < -0.1 && v < -(ph > 0 ? lift * ph : 0)) key = R2
      if (u > 0.1 && u < 0.38 && v < -(ph < 0 ? -lift * ph : 0)) key = R2
    } else if (vv > -1.25 && vv <= -0.45 && Math.abs(u) < 0.52) {
      key = R1; b = 0.65
      if (Math.abs(u) < 0.2 && vv > -1.05 && vv < -0.7) { key = r.c; b = 0.9 }
    } else if (vv > -1.95 && vv <= -1.32 && Math.abs(u) < 0.44) {
      key = R0; b = 0.75
      const dir = r.state === 'act' ? 0 : r.vx > 0 ? 0.06 : -0.06
      if (vv > -1.75 && vv < -1.55 && (Math.abs(u - 0.18 - dir) < 0.08 || Math.abs(u + 0.18 - dir) < 0.08)) { key = G + 11; b = 0.95 }
    } else if (vv > -2.25 && vv <= -1.95 && Math.abs(u) < 0.05) { key = R1 }
    else if (Math.hypot(u, (vv + 2.32) * 0.8) < 0.11) { key = r.c; b = 0.9 }
    if (key >= 0) put(g, px, py, key, b)
  }
}
