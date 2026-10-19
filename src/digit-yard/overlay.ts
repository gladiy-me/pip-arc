/**
 * Default overlay: the engine owns absolutely-positioned DOM nodes (bubble, robot name tags,
 * agent speech bubbles, floaters) inside the yard container, like the prototype.
 * Positions are written straight to style each frame, so React never re-renders at 30 fps.
 */
import type { OverlayCallbacks } from './types'

export interface DomOverlay extends OverlayCallbacks { destroy(): void }

export function createDomOverlay(container: HTMLElement): DomOverlay {
  const bubble = document.createElement('div')
  bubble.className = 'dy-bubble'
  bubble.style.opacity = '0'
  bubble.setAttribute('aria-live', 'polite')
  container.appendChild(bubble)
  let lastText = ''
  const tags = new Map<string, { tag: HTMLDivElement; say: HTMLDivElement | null }>()
  const floaters = new Set<HTMLDivElement>()
  const seen = new Set<string>()

  return {
    bubble(text, x, y, visible) {
      if (text !== lastText) { bubble.textContent = text; lastText = text }
      bubble.style.left = x + 'px'
      bubble.style.top = y + 'px'
      const o = visible ? '1' : '0'
      if (bubble.style.opacity !== o) bubble.style.opacity = o
    },
    tags(list) {
      seen.clear()
      for (const r of list) {
        seen.add(r.id)
        let e = tags.get(r.id)
        if (!e) {
          const tag = document.createElement('div')
          tag.className = 'dy-tag'
          tag.textContent = r.name
          container.appendChild(tag)
          e = { tag, say: null }
          tags.set(r.id, e)
        }
        e.tag.style.left = r.x + 'px'
        e.tag.style.top = r.y + 'px'
        if (r.say) {
          if (!e.say) {
            e.say = document.createElement('div')
            e.say.className = 'dy-bubble agent'
            e.say.textContent = r.say
            container.appendChild(e.say)
          }
          e.say.style.left = r.x + 'px'
          e.say.style.top = (r.sayY ?? r.y) + 'px'
        } else if (e.say) { e.say.remove(); e.say = null }
      }
      for (const [id, e] of tags) {
        if (!seen.has(id)) { e.tag.remove(); e.say?.remove(); tags.delete(id) }
      }
    },
    floater(text, x, y, color) {
      const el = document.createElement('div')
      el.className = 'dy-floater' + (color === 'green' ? ' g' : '')
      el.textContent = text
      el.style.left = x + 'px'
      el.style.top = y + 'px'
      container.appendChild(el)
      floaters.add(el)
      setTimeout(() => { el.remove(); floaters.delete(el) }, 1700)
    },
    destroy() {
      bubble.remove()
      for (const e of tags.values()) { e.tag.remove(); e.say?.remove() }
      tags.clear()
      for (const f of floaters) f.remove()
      floaters.clear()
    },
  }
}
