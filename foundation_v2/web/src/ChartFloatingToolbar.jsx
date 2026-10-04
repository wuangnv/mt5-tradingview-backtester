import React, { useEffect, useRef, useState } from 'react'
import ChartIcon from './ChartIcon.jsx'

export function clampToolbar(position, width, height, parentWidth, parentHeight, minimumY = 36) {
  return { x: Math.max(0, Math.min(position.x, Math.max(0, parentWidth - width))), y: Math.max(minimumY, Math.min(position.y, Math.max(minimumY, parentHeight - height - 28))) }
}

export default function ChartFloatingToolbar({ name, storageKey, initialPosition, compactRow = 0, children }) {
  const [layout, setLayout] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey))
      if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) return { ...saved, pinned: Boolean(saved.pinned), collapsed: Boolean(saved.collapsed) }
    } catch { /* Storage is optional for chart interaction. */ }
    return { ...initialPosition, pinned: false, collapsed: false }
  })
  const ref = useRef(null)
  const drag = useRef(null)
  useEffect(() => {
    const node = ref.current
    if (!node) return
    const constrain = () => setLayout(current => ({ ...current, ...clampToolbar(current, node.offsetWidth, node.offsetHeight, node.parentElement.clientWidth, node.parentElement.clientHeight, node.parentElement.clientWidth < 760 ? 36 + compactRow * 64 : 36) }))
    const observer = new ResizeObserver(constrain)
    observer.observe(node.parentElement)
    observer.observe(node)
    return () => observer.disconnect()
  }, [compactRow])
  useEffect(() => { try { localStorage.setItem(storageKey, JSON.stringify(layout)) } catch { /* Optional preferences. */ } }, [layout, storageKey])
  const move = (x, y) => {
    const node = ref.current
    setLayout(current => ({ ...current, ...clampToolbar({ x, y }, node.offsetWidth, node.offsetHeight, node.parentElement.clientWidth, node.parentElement.clientHeight, node.parentElement.clientWidth < 760 ? 36 + compactRow * 64 : 36) }))
  }
  return <div ref={ref} className={`chart-floating-toolbar ${layout.collapsed ? 'is-collapsed' : ''}`} role="group" aria-label={name} style={{ left: layout.x, top: layout.y }}>
    <button type="button" className="chart-float-grip" aria-label={`Di chuyển ${name}`} title="Kéo để di chuyển · phím mũi tên để chỉnh vị trí" disabled={layout.pinned}
      onPointerDown={event => { if (event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); drag.current = { x: event.clientX - layout.x, y: event.clientY - layout.y }; event.preventDefault() }}
      onPointerMove={event => { if (drag.current) move(event.clientX - drag.current.x, event.clientY - drag.current.y) }}
      onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }}
      onKeyDown={event => { if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return; event.preventDefault(); event.stopPropagation(); move(layout.x + (event.key === 'ArrowLeft' ? -12 : event.key === 'ArrowRight' ? 12 : 0), layout.y + (event.key === 'ArrowUp' ? -12 : event.key === 'ArrowDown' ? 12 : 0)) }}><ChartIcon name="grip" /></button>
    {!layout.collapsed && <div className="chart-float-content">{children}</div>}
    <button type="button" aria-label={`Ghim ${name}`} title="Ghim vị trí" aria-pressed={layout.pinned} onClick={() => setLayout(current => ({ ...current, pinned: !current.pinned }))}><ChartIcon name="pin" /></button>
    <button type="button" aria-label={`${layout.collapsed ? 'Mở' : 'Thu gọn'} ${name}`} title={layout.collapsed ? 'Mở thanh công cụ' : 'Thu gọn'} aria-expanded={!layout.collapsed} onClick={() => setLayout(current => ({ ...current, collapsed: !current.collapsed }))}><ChartIcon name={layout.collapsed ? 'expand' : 'collapse'} /></button>
  </div>
}
