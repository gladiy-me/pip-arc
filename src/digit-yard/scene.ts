/**
 * Background pass: sky, canopy, grass (with cursor parting + gusts), pond with pip's reflection.
 * Ported 1:1 from the big cell loop in the prototype's `render()`.
 */
import { clamp, noise, smooth } from './noise'
import { EMPTY, G, W, WHITE } from './palette'
import { OUT, pipSample } from './pip-shape'
import type { Grid, Layout, Mood, Mouse, ShapeState } from './types'

export function renderBackground(
  g: Grid, L: Layout, S: ShapeState, t: number, mood: Mood, mouse: Mouse, reduce: boolean,
): void {
  const { cols, rows, cw, ch, W: Wpx, H: Hpx, keyArr, chArr, hashArr } = g
  const hz = L.horizon, sway0 = reduce ? 0 : 1
  const mR = Math.min(Wpx, Hpx) * 0.11

  for (let cy = 0; cy < rows; cy++) {
    const py = cy * ch + ch * 0.5
    for (let cx = 0; cx < cols; cx++) {
      const i = cy * cols + cx, px = cx * cw + cw * 0.5, h = hashArr[i]
      let key = EMPTY, b = 0
      const pdx = (px - L.pondX) / L.pondRx, pdy = (py - L.pondY) / L.pondRy, pe = pdx * pdx + pdy * pdy
      if (pe < 1) {
        // water: reflection of pip, rippled
        if (pe > 0.86) { key = G + 1 + ((h * 3) | 0); b = 0.5 + h * 0.4 }
        else {
          const rip = Math.sin(py * 0.35 + t * 2.2) * L.s * 0.05 * sway0
          pipSample(S, px + rip, 2 * L.feet + L.s * 0.08 - py, t, mood, true)
          if (OUT.k >= 0 && h > 0.12) { key = OUT.k; b = OUT.b }
          else {
            const w = noise(px * 0.025 + t * 0.25, py * 0.09) * 0.6 + 0.4 * Math.max(0, Math.sin(py * 0.6 - t * 1.6 + px * 0.015))
            b = 0.12 + w * 0.5
            key = h < 0.25 ? EMPTY : W + clamp((b * 6) | 0, 0, 5)
          }
        }
      } else if (py < hz) {
        // night sky + distant canopy
        const canopy = hz - Hpx * (0.05 + 0.1 * noise(px * 0.008, 3.1) + 0.03 * noise(px * 0.04, 7.7))
        if (py > canopy) {
          const nn = noise(px * 0.03 + Math.sin(t * 0.4) * 0.3 * sway0, py * 0.06)
          b = 0.2 + nn * 0.55 + h * 0.15
          key = h < 0.1 ? EMPTY : G + clamp((b * 5) | 0, 0, 4)
        } else if (h > 0.986) {
          b = 0.4 + 0.6 * Math.abs(Math.sin(t * 0.7 + h * 90))
          key = b > 0.8 ? WHITE : G + 6
        }
      } else {
        // grass: depth, sway, wind gusts, cursor parting
        const d = (py - hz) / (Hpx - hz)
        const sway = Math.sin(t * 1.3 + px * 0.011 + py * 0.017) * (2 + 7 * d) * sway0
        const nx = px + sway
        const blade = 0.5 + 0.5 * Math.sin(nx * 0.9 + noise(nx * 0.02, 1.7) * 9)
        b = 0.08 + 0.5 * noise((nx * 0.05) / (0.5 + d), py * 0.1) + 0.22 * h + 0.22 * blade * d
        const gust = sway0 * smooth(0.72, 1, Math.sin(px * 0.005 - t * 0.8 + py * 0.003))
        b += gust * 0.32
        if (mouse.in) {
          const md = Math.hypot(px - mouse.x, (py - mouse.y) * 1.6)
          if (md < mR) b *= 0.25 + 0.75 * (md / mR) ** 2
          else if (md < mR * 1.35) b += 0.35 * (1 - (md - mR) / (mR * 0.35))
        }
        b *= 0.55 + 0.6 * d
        if (b < 0.2) key = EMPTY
        else {
          const lvl = clamp((b * 12) | 0, 0, 11)
          key = G + lvl
          if (gust > 0.6 && h > 0.7) key = G + 11
        }
      }
      // digital shimmer: some digits tick over time
      let c = clamp((b * 9.99) | 0, 0, 9)
      if (h > 0.9) c = (c + ((t * 4 + h * 40) | 0)) % 10
      keyArr[i] = key; chArr[i] = c
    }
  }
}

/** Stamp pip (with dark halo) into the grid. */
export function stampPip(g: Grid, S: ShapeState, t: number, mood: Mood): void {
  const { cols, rows, cw, ch, keyArr, chArr, hashArr } = g
  const box = S.box
  const bx0 = Math.max(0, Math.floor((box.cx - box.s * 1.8) / cw)), bx1 = Math.min(cols - 1, Math.ceil((box.cx + box.s * 1.8) / cw))
  const by0 = Math.max(0, Math.floor((box.cy - box.s * 2.4) / ch)), by1 = Math.min(rows - 1, Math.ceil((box.cy + box.s * 1.5) / ch))
  for (let cy = by0; cy <= by1; cy++) for (let cx = bx0; cx <= bx1; cx++) {
    const hpx = cx * cw + cw * 0.5, hpy = cy * ch + ch * 0.5
    pipSample(S, hpx, hpy, t, mood, false)
    if (OUT.k < 0) {
      const hu = (hpx - box.cx) / (box.s * box.rx * 1.15), hv = (hpy - box.cy) / (box.s * (box.ry + 0.2) * 1.15)
      if (hu * hu + hv * hv < 1) keyArr[cy * cols + cx] = EMPTY
    }
    if (OUT.k >= 0) {
      const i = cy * cols + cx
      keyArr[i] = OUT.k
      let c = clamp((OUT.b * 9.99) | 0, 0, 9)
      if (hashArr[i] > 0.94) c = (c + ((t * 2 + hashArr[i] * 30) | 0)) % 10
      chArr[i] = c
      if (OUT.k === 29 /* EYE */) keyArr[i] = EMPTY
    }
  }
}
