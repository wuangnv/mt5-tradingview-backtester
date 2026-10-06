import React, { useEffect, useId, useRef, useState } from 'react'
import './fx-select.css'

export function FilterIcon({ kind }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{kind === 'calendar' ? <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4m8-4v4M4 10h16" /></> : kind === 'sort' ? <><path d="M7 4v16m-3-3 3 3 3-3M17 20V4m-3 3 3-3 3 3" /></> : kind === 'filter' ? <path d="M3 4h18l-7 8v7l-4 2v-9Z" /> : kind === 'edit' ? <><path d="m16 3 5 5-12 12H4v-5ZM13 6l5 5" /></> : <><path d="M4 20h16M7 16v-5m5 5V5m5 11V9" /></>}</svg>
}

export function SelectChevron() {
  return <svg className="fx-select-chevron" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 8 5 5 5-5" /></svg>
}

export default function FxSelect({ label, value, options, onChange, icon, searchable = false, placeholder = 'Tìm…', emptyLabel = 'Không có lựa chọn phù hợp.', disabled = false, triggerContent, className = '', multiple = false, iconOnly = false, selectAllLabel = 'Chọn tất cả', menuTitle, selectionField = false, clearValue }) {
  const [open, setOpen] = useState(false), [search, setSearch] = useState('')
  const root = useRef(null), trigger = useRef(null), input = useRef(null)
  const id = useId()
  const selected = options.find(option => String(option.value) === String(value))
  const isSelected = option => multiple ? value.includes(option.value) : String(option.value) === String(value)
  const available = options.filter(option => !option.disabled)
  const allSelected = multiple && available.length > 0 && available.every(isSelected)
  const visible = options.filter(option => `${option.label} ${option.detail || ''}`.toLocaleLowerCase('vi').includes(search.trim().toLocaleLowerCase('vi')))
  const close = () => { setOpen(false); trigger.current?.focus() }
  useEffect(() => {
    if (!open) return
    const positionMenu = () => {
      const menu = root.current?.querySelector('.fx-select-menu')
      if (!menu) return
      // Popups must fit the scrolling content, which also clips the sidebar edge.
      const container = root.current.closest('.fx-content')
      const clip = container?.getBoundingClientRect()
      const left = Math.max(12, (clip?.left || 0) + 12), right = Math.min(window.innerWidth - 12, (clip ? clip.left + container.clientWidth : window.innerWidth) - 12)
      menu.style.maxWidth = `${right - left}px`
      menu.style.transform = ''
      menu.style.top = 'calc(100% + 8px)'
      menu.style.bottom = 'auto'
      const bounds = menu.getBoundingClientRect()
      const shift = bounds.left < left ? left - bounds.left : bounds.right > right ? right - bounds.right : 0
      menu.style.transform = `translateX(${shift}px)`
      const anchor = trigger.current.getBoundingClientRect()
      const below = Math.min(window.innerHeight, clip?.bottom || window.innerHeight) - anchor.bottom - 18
      const above = anchor.top - Math.max(0, clip?.top || 0) - 18
      const upwards = bounds.height > below && above > below
      if (upwards) { menu.style.top = 'auto'; menu.style.bottom = 'calc(100% + 8px)' }
      const list = menu.querySelector('[role="listbox"]')
      const chromeHeight = bounds.height - list.getBoundingClientRect().height
      list.style.maxHeight = `${Math.max(44, Math.min(300, (upwards ? above : below) - chromeHeight))}px`
    }
    positionMenu()
    if (searchable) input.current?.focus()
    else (root.current?.querySelector('[role="option"][aria-selected="true"]:not(:disabled)') || root.current?.querySelector('[role="option"]:not(:disabled)'))?.focus()
    const outside = event => { if (!root.current?.contains(event.target)) setOpen(false) }
    document.addEventListener('pointerdown', outside)
    window.addEventListener('resize', positionMenu)
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('resize', positionMenu) }
  }, [open, searchable])
  return <div className={`fx-select ${className}`} ref={root} onBlur={event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false) }} onKeyDown={event => {
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close() }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && (event.target !== input.current || event.key.startsWith('Arrow'))) {
      event.preventDefault()
      if (!open) { setOpen(true); setSearch(''); return }
      const entries = [...root.current.querySelectorAll('[role="option"]:not(:disabled)')]
      const current = entries.indexOf(document.activeElement)
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? entries.length - 1 : current < 0 ? event.key === 'ArrowDown' ? 0 : entries.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + entries.length) % entries.length
      entries[next]?.focus()
    }
  }}>
    <button type="button" className="fx-select-trigger" aria-label={label} aria-haspopup={searchable ? 'dialog' : 'listbox'} aria-expanded={open} aria-controls={open ? id : undefined} disabled={disabled} ref={trigger} onClick={() => { setSearch(''); setOpen(!open) }}>
      {icon && <FilterIcon kind={icon} />}{!iconOnly && <><span className="fx-select-value">{triggerContent || selected?.label || 'Chọn…'}</span><SelectChevron /></>}
    </button>
    {open && <div id={id} className="fx-select-menu" role={searchable ? 'dialog' : 'presentation'} aria-label={searchable ? label : undefined}>
      {menuTitle && <h3 className="fx-filter-title">{menuTitle}</h3>}
      {selectionField && <div className="fx-filter-selection"><span>{multiple ? allSelected ? 'All' : options.filter(isSelected).map(option => option.label).join(', ') || 'None' : selected?.label}</span>{clearValue !== undefined && <button type="button" aria-label={`Clear ${label}`} onClick={() => onChange(clearValue)}>×</button>}<SelectChevron /></div>}
      {multiple && !selectionField && <span className="fx-select-count">{value.length} / {options.length} đã chọn</span>}
      {searchable && <input ref={input} type="search" aria-label={`Tìm ${label}`} placeholder={placeholder} value={search} onChange={event => setSearch(event.target.value)} />}
      {multiple && <label className="fx-select-all"><input type="checkbox" checked={allSelected} ref={node => { if (node) node.indeterminate = !allSelected && value.length > 0 }} onChange={() => onChange(allSelected ? [] : available.map(option => option.value))} />{selectAllLabel}</label>}
      <div role="listbox" tabIndex={-1} aria-label={label} aria-multiselectable={multiple || undefined}>{visible.map(option => <button type="button" role="option" key={option.value} aria-selected={isSelected(option)} disabled={option.disabled} title={option.disabled ? option.detail : undefined} onClick={() => {
        if (multiple) onChange(isSelected(option) ? value.filter(item => item !== option.value) : [...value, option.value])
        else { onChange(option.value); close() }
      }}>{multiple && <span className={`fx-select-checkbox${isSelected(option) ? ' is-checked' : ''}`} aria-hidden="true">{isSelected(option) ? '✓' : ''}</span>}<span>{option.label}{option.detail && <small>{option.detail}</small>}</span>{!multiple && isSelected(option) && <span className="fx-select-check" aria-hidden="true">✓</span>}</button>)}</div>
      {!visible.length && <p role="status">{emptyLabel}</p>}
    </div>}
  </div>
}
