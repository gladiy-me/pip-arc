/**
 * Digit-yard palette. Ported 1:1 from docs/reference/pip-digits-prototype.html (`COLORS`).
 * Index ranges are palette keys stored in `keyArr`; 255 = empty cell.
 */

/** Digits ordered by ink density, lightest → densest. */
export const RAMP = '1743259608'

function ramp(a: string, b: string, n: number): string[] {
  const p = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
  const A = p(a), B = p(b), out: string[] = []
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1)
    out.push(`rgb(${Math.round(A[0] + (B[0] - A[0]) * t)},${Math.round(A[1] + (B[1] - A[1]) * t)},${Math.round(A[2] + (B[2] - A[2]) * t)})`)
  }
  return out
}

export const COLORS: readonly string[] = ([] as string[]).concat(
  ramp('#062a12', '#139a3e', 6), ramp('#18c94f', '#8dff7a', 6),   // G 0..11
  ramp('#4a0f2e', '#c2307e', 5), ramp('#e2479c', '#ffd6ec', 5),   // P 12..21
  ramp('#041716', '#2d6e6a', 6),                                   // W 22..27 water
  ['#eafff1', '#1a050f', '#5c4652', '#a88a99', '#e8d6df'],         // 28 white, 29 eye, 30..32 ghost
  ramp('#2a0a1c', '#8a2e62', 4),                                   // 33..36 reflection pink
  ['#ffe28a'],                                                     // 37 coin highlight
  ['#e9fff0', '#a9d9bb', '#6f9c80'],                               // 38..40 robot metal
)

export const G = 0
export const P = 12
export const W = 22
export const WHITE = 28
export const EYE = 29 // drawn as an empty cell (pure black)
export const GH = 30
export const RP = 33
export const GOLD = 37
export const R0 = 38
export const R1 = 39
export const R2 = 40
export const NC = COLORS.length
export const EMPTY = 255
