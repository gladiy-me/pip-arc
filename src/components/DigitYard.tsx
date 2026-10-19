/**
 * <DigitYard /> — React wrapper around DigitYardEngine.
 * Renders the two canvases (glow BEHIND main) + HUD; the engine owns the overlay
 * DOM nodes (bubbles, tags, floaters) and draws at ~30 fps without React re-renders.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, type ReactNode } from 'react'
import { DigitYardEngine, type ViewWithGen, type ActionId } from '../digit-yard'

export interface DigitYardHandle {
  setView(v: ViewWithGen): void
  pet(opts?: { long?: boolean; who?: string }): void
  feed(lifeAddedSeconds: number, opts?: { amountUsdc?: number; who?: string }): void
  say(text: string, ms?: number): void
  heard(text: string, who?: string): void
  play(): void
  hat(on: boolean): void
  agentVisit(v: { name: string; action: ActionId; text?: string; lifeAddedSeconds?: number }): void
  evolve(): void
  died(gen?: number): void
  hatched(gen?: number): void
}

interface DigitYardProps {
  ariaLabel: string
  hudLeft?: ReactNode
  hudRight?: ReactNode
  hint?: string
}

export const DigitYard = forwardRef<DigitYardHandle, DigitYardProps>(function DigitYard(
  { ariaLabel, hudLeft, hudRight, hint = 'click pip to pet · hold for long pets · move the cursor through the grass' },
  ref,
) {
  const yardRef = useRef<HTMLElement>(null)
  const mainRef = useRef<HTMLCanvasElement>(null)
  const glowRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<DigitYardEngine | null>(null)
  // calls that arrive before the engine exists (e.g. StrictMode remount) replay the latest view
  const pendingView = useRef<ViewWithGen | null>(null)

  useEffect(() => {
    if (!yardRef.current || !mainRef.current || !glowRef.current) return
    const eng = new DigitYardEngine(yardRef.current, mainRef.current, glowRef.current)
    engineRef.current = eng
    if (pendingView.current) eng.setView(pendingView.current)
    return () => { eng.destroy(); engineRef.current = null }
  }, [])

  useImperativeHandle(ref, () => ({
    setView: v => { pendingView.current = v; engineRef.current?.setView(v) },
    pet: o => engineRef.current?.pet(o),
    feed: (s, o) => engineRef.current?.feed(s, o),
    say: (t, ms) => engineRef.current?.say(t, ms),
    heard: (t, w) => engineRef.current?.heard(t, w),
    play: () => engineRef.current?.play(),
    hat: on => engineRef.current?.hat(on),
    agentVisit: v => engineRef.current?.agentVisit(v),
    evolve: () => engineRef.current?.evolve(),
    died: g => engineRef.current?.died(g),
    hatched: g => engineRef.current?.hatched(g),
  }), [])

  return (
    <section className="yard" ref={yardRef} aria-label={ariaLabel}>
      <canvas ref={glowRef} className="glow" aria-hidden="true" />
      <canvas ref={mainRef} aria-hidden="true" />
      <div className="yard-hud"><span>{hudLeft}</span><span>{hudRight}</span></div>
      <div className="hint">{hint}</div>
    </section>
  )
})
