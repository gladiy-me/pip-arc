import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { createDigitYard, type DigitYardApi, type DigitYardView } from './engine'

type Props = {
  view: DigitYardView
  hud: { left: React.ReactNode; right: React.ReactNode }
  hint?: string
  onPet?: (long: boolean) => void
  children?: React.ReactNode
  label: string
}

/** Canvas + overlays. The engine owns animation; React only pushes the view and calls methods. */
export const DigitYard = forwardRef<DigitYardApi | null, Props>(function DigitYard({ view, hud, hint, onPet, children, label }, ref) {
  const yardRef = useRef<HTMLElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const glowRef = useRef<HTMLCanvasElement>(null)
  const bubbleRef = useRef<HTMLDivElement>(null)
  const apiRef = useRef<DigitYardApi | null>(null)
  const onPetRef = useRef(onPet)
  onPetRef.current = onPet

  useEffect(() => {
    if (!yardRef.current || !canvasRef.current || !glowRef.current || !bubbleRef.current) return
    const api = createDigitYard({
      container: yardRef.current,
      canvas: canvasRef.current,
      glow: glowRef.current,
      bubble: bubbleRef.current,
      onPet: (long) => onPetRef.current?.(long),
    })
    apiRef.current = api
    return () => {
      api.destroy()
      apiRef.current = null
    }
  }, [])

  useEffect(() => {
    apiRef.current?.setView(view)
  }, [view.mood, view.stage, view.alive, view.retired, view.hat])

  useImperativeHandle(ref, () => ({
    setView: (v) => apiRef.current?.setView(v),
    pet: (o) => apiRef.current?.pet(o),
    feed: (s) => apiRef.current?.feed(s),
    say: (t, ms) => apiRef.current?.say(t, ms),
    play: () => apiRef.current?.play(),
    evolve: (n) => apiRef.current?.evolve(n),
    agentVisit: (v) => apiRef.current?.agentVisit(v),
    wake: () => apiRef.current?.wake(),
    destroy: () => {},
  }), [])

  return (
    <section className="yard" ref={yardRef} aria-label={label}>
      <canvas ref={glowRef} className="glow" aria-hidden="true" />
      <canvas ref={canvasRef} aria-hidden="true" />
      <div className="yard-hud"><span>{hud.left}</span><span>{hud.right}</span></div>
      <div className="bubble" ref={bubbleRef} style={{ opacity: 0 }} />
      {hint && <div className="hint">{hint}</div>}
      {children}
    </section>
  )
})
