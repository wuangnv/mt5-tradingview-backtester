import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export default function LegacyPopover({ anchor, theme, label, onClose, onAnchorLost, children, wide = false }) {
  const ref = useRef(null), closeRef = useRef(onClose), lostRef = useRef(onAnchorLost), [position, setPosition] = useState({ visibility: 'hidden' })
  closeRef.current = onClose
  lostRef.current = onAnchorLost
  useLayoutEffect(() => {
    if (!anchor?.isConnected) { (lostRef.current || closeRef.current)(); return }
    const doc = anchor.ownerDocument, view = doc.defaultView, popup = ref.current
    const place = () => {
      if (!anchor.isConnected || !anchor.getBoundingClientRect().width) { (lostRef.current || closeRef.current)(); return }
      const a = anchor.getBoundingClientRect(), p = popup.getBoundingClientRect()
      const height = Math.min(p.height, view.innerHeight - 16), width = Math.min(p.width, view.innerWidth - 16)
      setPosition({ left: Math.max(8, Math.min(a.right - width, view.innerWidth - width - 8)), top: Math.max(8, a.bottom + height + 4 <= view.innerHeight ? a.bottom + 4 : a.top - height - 4) })
    }
    place()
    // Placement commits before paint, but a hidden node cannot take initial focus.
    popup.style.visibility = 'visible'
    const selected = popup.querySelector('button[aria-pressed="true"]:not(:disabled),button[aria-checked="true"]:not(:disabled)')
    const initial = selected || popup.querySelector('button:not(:disabled),input:not(:disabled),select:not(:disabled)')
    initial?.focus()
    const close = event => {
      if (event.type === 'pointerdown' && !popup.contains(event.target) && !anchor.contains(event.target)) closeRef.current()
      if (event.type === 'focusin' && !popup.contains(event.target) && !anchor.contains(event.target)) closeRef.current()
      if (event.type === 'keydown' && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeRef.current(); anchor.focus() }
      if (event.type === 'keydown' && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && event.target.tagName === 'BUTTON' && popup.contains(event.target)) {
        event.preventDefault()
        const buttons = [...popup.querySelectorAll('button:not(:disabled)')], index = buttons.indexOf(event.target)
        buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus()
      }
    }
    const blur = event => {
      if (!popup.contains(event.relatedTarget) && !anchor.contains(event.relatedTarget)) closeRef.current()
    }
    popup.addEventListener('focusout', blur)
    const docs = [...new Set([doc, document])]
    docs.forEach(d => { d.addEventListener('pointerdown', close); d.addEventListener('keydown', close); d.addEventListener('focusin', close) })
    view.addEventListener('resize', place)
    const observer = new ResizeObserver(place); observer.observe(popup)
    return () => {
      observer.disconnect(); view.removeEventListener('resize', place)
      popup.removeEventListener('focusout', blur)
      docs.forEach(d => { d.removeEventListener('pointerdown', close); d.removeEventListener('keydown', close); d.removeEventListener('focusin', close) })
      if (anchor.isConnected && popup.contains(doc.activeElement)) anchor.focus()
    }
  }, [anchor])
  if (!anchor) return null
  return createPortal(<div ref={ref} className={`legacy-popover ${theme === 'light' ? 'is-light' : ''} ${wide ? 'is-wide' : ''}`} style={position} role="group" aria-label={label}>{children}</div>, anchor.ownerDocument.body)
}
