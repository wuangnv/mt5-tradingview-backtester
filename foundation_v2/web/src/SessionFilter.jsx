import React, { useEffect, useId, useRef, useState } from 'react'
import './session-filter.css'

export default function SessionFilter({ items, value, onChange, multiple = false, disabled = false, triggerContent, compact = false }) {
  const [open, setOpen] = useState(false), [search, setSearch] = useState('')
  const root = useRef(null), trigger = useRef(null), input = useRef(null)
  const id = useId()
  const all = multiple && value === null
  const selected = multiple ? value || [] : value ? [value] : []
  const visible = items.filter(item => `${item.name || item.record_id} ${item.instrument_id || ''}`.toLocaleLowerCase('vi').includes(search.trim().toLocaleLowerCase('vi')))
  const label = all ? 'Tất cả phiên' : selected.length > 1 ? `${selected.length} phiên` : selected.length ? items.find(item => item.record_id === selected[0])?.name || selected[0] : 'Chọn phiên'
  useEffect(() => {
    if (!open) return
    const position = () => {
      const menu = root.current?.querySelector('.fxa-session-menu')
      if (!menu) return
      const clip = root.current.closest('.fx-content')?.getBoundingClientRect()
      const left = Math.max(12, (clip?.left || 0) + 12), right = Math.min(window.innerWidth - 12, (clip?.right || window.innerWidth) - 12)
      menu.style.maxWidth = `${right - left}px`; menu.style.transform = ''
      const bounds = menu.getBoundingClientRect()
      menu.style.transform = `translateX(${bounds.left < left ? left - bounds.left : bounds.right > right ? right - bounds.right : 0}px)`
    }
    position()
    input.current?.focus()
    const outside = event => { if (!root.current?.contains(event.target)) setOpen(false) }
    document.addEventListener('pointerdown', outside)
    window.addEventListener('resize', position)
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('resize', position) }
  }, [open])
  const toggle = item => {
    if (!multiple) { onChange(item.record_id); setOpen(false); trigger.current?.focus(); return }
    const next = new Set(all ? items.map(item => item.record_id) : selected)
    if (next.has(item.record_id)) next.delete(item.record_id)
    else next.add(item.record_id)
    onChange(next.size === items.length && items.every(item => next.has(item.record_id)) ? null : [...next])
  }
  return <div className={`fxa-session-filter${compact ? ' is-compact' : ''}`} ref={root} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }} onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); setOpen(false); trigger.current?.focus() }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && open && event.target !== input.current) {
      const controls = [...root.current.querySelectorAll('.fxa-session-menu input, .fxa-session-menu button')]
      const index = controls.indexOf(document.activeElement)
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? controls.length - 1 : Math.max(0, Math.min(controls.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))
      event.preventDefault(); controls[next]?.focus()
    }
  }}>
    <button type="button" className="fxa-button fxa-session-trigger" aria-label={`Session: ${label}`} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} disabled={disabled} ref={trigger} onClick={() => { setOpen(!open); setSearch('') }}><span>{triggerContent || label}</span><svg className="fx-select-chevron" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m5 8 5 5 5-5" /></svg></button>
    {open && <div className="fxa-session-menu" id={id} role="dialog" aria-label="Chọn session">
      <input ref={input} type="search" aria-label="Tìm phiên" placeholder="Tìm phiên…" value={search} onChange={event => setSearch(event.target.value)} />
      {multiple && <label className="fxa-session-all"><input type="checkbox" checked={all} ref={node => { if (node) node.indeterminate = !all && selected.length > 0 }} onChange={() => onChange(all ? [] : null)} />Tất cả phiên</label>}
      <div className="fxa-session-options">{visible.map(item => multiple ? <label key={item.record_id} className={all || selected.includes(item.record_id) ? 'is-selected' : ''}><input type="checkbox" checked={all || selected.includes(item.record_id)} onChange={() => toggle(item)} /><span>{item.name || item.record_id}<small>{item.instrument_id || 'Chưa rõ asset'}{item.archived ? ' · Đã lưu trữ' : ''}</small></span></label> : <button type="button" key={item.record_id} aria-pressed={value === item.record_id} className={value === item.record_id ? 'is-selected' : ''} onClick={() => toggle(item)}><span>{item.name || item.record_id}<small>{item.instrument_id || 'Chưa rõ asset'}{item.archived ? ' · Đã lưu trữ' : ''}</small></span>{value === item.record_id && <span aria-hidden="true">✓</span>}</button>)}</div>
      {!visible.length && <p className="fxa-empty">Không tìm thấy phiên.</p>}
    </div>}
  </div>
}
