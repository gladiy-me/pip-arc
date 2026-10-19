/** Shared engine types. */
import type { Stage } from './stages'

export type Mood = 0 | 1 | 2 | 3 | 4 | 5
export type ActionId = 0 | 1 | 2 | 3 | 4

/** Cell grid shared by all passes. */
export interface Grid {
  W: number; H: number
  cw: number; ch: number
  cols: number; rows: number
  keyArr: Uint8Array
  chArr: Uint8Array
  hashArr: Float32Array
}

/** Scene layout in pixels (see layout()). */
export interface Layout {
  horizon: number; s: number; pipX: number; feet: number
  pondX: number; pondY: number; pondRx: number; pondRy: number
}

/** pip's current bounding ellipse; s = pip unit size in px. */
export interface PipBox { cx: number; cy: number; rx: number; ry: number; s: number }

/** pip animation state (prototype `A`). */
export interface Anim {
  squish: number; playT: number; eatT: number; blink: number; nextBlink: number; sc: number; evo: number
  idle: number; sleep: boolean; zT: number; holding: boolean; hold: number; heartT: number
  wiggle: number; shake: number; gx: number; gy: number; pets: number[]
}

/** What pipSample needs to know. */
export interface ShapeState {
  box: PipBox
  A: Anim
  stage: Stage
  hat: boolean
}

export interface Mouse { x: number; y: number; in: boolean }

export type ParticleType = 'heart' | 'coin' | 'spark' | 'z'
export interface Particle {
  type: ParticleType
  x: number; y: number; vx: number; vy: number
  g?: number; r?: number
  life: number; max: number
  done?: boolean
}

export interface Robot {
  id: string
  name: string
  action: ActionId
  text?: string
  /** seconds of life a FEED added (for the floater) */
  life?: number
  seed: number
  c: number // palette key of the robot's chest light / beacon
  x: number; y: number; vx: number; tx: number
  state: 'in' | 'act' | 'out'
  timer: number
  say?: string
}

export interface OverlayCallbacks {
  bubble(text: string, x: number, y: number, visible: boolean): void
  tags(list: { id: string; name: string; x: number; y: number; say?: string; sayY?: number }[]): void
  floater(text: string, x: number, y: number, color: 'pink' | 'green'): void
}

export interface YardView {
  mood: Mood
  stage: Stage
  alive: boolean
  hat: boolean
  reducedMotion: boolean
}
