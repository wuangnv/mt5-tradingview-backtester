import { useTestingLocale } from './testingLocale.jsx'
import { Fragment, useEffect, useId, useRef, useState } from 'react'
import './fx-select.css'
import TestingIcon from './TestingIcon.jsx'

export function FilterIcon({ kind }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{kind === 'calendar' ? <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4m8-4v4M4 10h16" /></> : kind === 'sort' ? <><path d="M7 4v16m-3-3 3 3 3-3M17 20V4m-3 3 3-3 3 3" /></> : kind === 'filter' ? <path d="M3 4h18l-7 8v7l-4 2v-9Z" /> : kind === 'edit' ? <><path d="m16 3 5 5-12 12H4v-5ZM13 6l5 5" /></> : <><path d="M4 20h16M7 16v-5m5 5V5m5 11V9" /></>}</svg>
}

export function SelectChevron() {
  return <svg className="fx-select-chevron" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 8 5 5 5-5" /></svg>
}

export default function FxSelect({ label, value, options: inputOptions, onChange, icon, searchable = false, placeholder = 'Tìm…', emptyLabel = 'Không có lựa chọn phù hợp.', disabled = false, triggerContent, className = '', multiple = false, multipleStyle = 'checkbox', selectedTags, iconOnly = false, selectAllLabel = 'Chọn tất cả', menuTitle, menuHeader, renderOption, filterOption, selectionField = false, clearValue, localizeOptions = true, ...triggerProps }) {
  const { t } = useTestingLocale()
  const options = inputOptions.map(option => ({ ...option, label: option.localize === false || !localizeOptions ? option.label : t(option.label), detail: option.localize === false || !localizeOptions ? option.detail : t(option.detail) }))

  const [open, setOpen] = useState(false), [search, setSearch] = useState('')
  const root = useRef(null), trigger = useRef(null), input = useRef(null)
  const id = useId()
  const Field = selectedTags ? 'div' : Fragment
  const selected = multiple ? null : options.find(option => String(option.value) === String(value))
  const isSelected = option => multiple ? value.includes(option.value) : String(option.value) === String(value)
  const available = options.filter(option => !option.disabled)
  const allSelected = multiple && available.length > 0 && available.every(isSelected)
  const selectedCount = multiple ? available.filter(isSelected).length : 0
  const visible = options.filter(option => (!filterOption || filterOption(option)) && `${option.label} ${option.detail || ''} ${option.searchText || ''}`.toLocaleLowerCase('vi').includes(search.trim().toLocaleLowerCase('vi')))
  const groups = Map.groupBy(visible, option => option.group || '')
  const close = () => { setOpen(false); trigger.current?.focus() }
  useEffect(() => {
    if (!open) return
    const positionMenu = () => {
      const menu = root.current?.querySelector('.fx-select-menu')
      if (!menu) return
      // Popups must fit the scrolling content, which also clips the sidebar edge.
      const container = root.current.closest('dialog, .quick-session-body, .fx-content')
      const clip = container?.getBoundingClientRect()
      const left = Math.max(12, (clip?.left || 0) + 12), right = Math.min(window.innerWidth - 12, (clip ? clip.left + container.clientWidth : window.innerWidth) - 12)
      menu.style.maxWidth = `${right - left}px`
      menu.style.transform = ''
      menu.style.top = 'calc(100% + 8px)'
      menu.style.bottom = 'auto'
      const list = menu.querySelector('[role="listbox"]')
      list.style.maxHeight = '300px'
      const bounds = menu.getBoundingClientRect()
      const shift = bounds.left < left ? left - bounds.left : bounds.right > right ? right - bounds.right : 0
      menu.style.transform = `translateX(${shift}px)`
      const anchor = root.current.getBoundingClientRect()
      const below = Math.min(window.innerHeight, clip?.bottom || window.innerHeight) - anchor.bottom - 18
      const above = anchor.top - Math.max(0, clip?.top || 0) - 18
      const upwards = bounds.height > below && above > below
      if (upwards) { menu.style.top = 'auto'; menu.style.bottom = 'calc(100% + 8px)' }
      const chromeHeight = bounds.height - list.getBoundingClientRect().height
      list.style.maxHeight = `${Math.max(44, Math.min(300, (upwards ? above : below) - chromeHeight))}px`
    }
    positionMenu()
    const outside = event => { if (!root.current?.contains(event.target)) setOpen(false) }
    document.addEventListener('pointerdown', outside)
    window.addEventListener('resize', positionMenu)
    const scroller = root.current.closest('dialog, .quick-session-body')
    scroller?.addEventListener('scroll', positionMenu)
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('resize', positionMenu); scroller?.removeEventListener('scroll', positionMenu) }
  }, [open, searchable, visible.length, menuHeader])
  useEffect(() => {
    if (!open) return
    if (searchable) input.current?.focus()
    else (root.current?.querySelector('[role="option"][aria-selected="true"]:not(:disabled)') || root.current?.querySelector('[role="option"]:not(:disabled)'))?.focus()
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
    <Field {...(selectedTags ? { className:'fx-select-tag-field', onPointerDown:event => {
      // Keep menu focus until the field click toggles it; otherwise dialog blur closes it first.
      if (!disabled && !event.target.closest('button')) event.preventDefault()
    }, onClick:event => { if (!disabled && !event.target.closest('button')) { trigger.current?.focus(); trigger.current?.click() } } } : {})}>
    {selectedTags?.length > 0 && <div className="fx-select-tags">{selectedTags.map(tag => <span className="fx-select-tag" key={tag.value} title={tag.detail}><span>{tag.label}</span><button type="button" disabled={disabled} aria-label={t('Bỏ tài sản {asset}',{asset:tag.label})} onClick={() => { trigger.current?.focus(); onChange(value.filter(item => item !== tag.value)) }}><TestingIcon kind="close" size={14} /></button></span>)}</div>}
    <button {...triggerProps} type="button" className="fx-select-trigger" aria-label={t(label)} aria-haspopup={searchable ? 'dialog' : 'listbox'} aria-expanded={open} aria-controls={open ? id : undefined} disabled={disabled} ref={trigger} onClick={() => { setSearch(''); setOpen(!open) }}>
      {icon && <FilterIcon kind={icon} />}{!iconOnly && <>{!selectedTags?.length && <span className="fx-select-value">{(localizeOptions ? t(triggerContent) : triggerContent) || selected?.label || t("Chọn…")}</span>}<SelectChevron /></>}
    </button>
    </Field>
    {open && <div id={id} className="fx-select-menu" role={searchable ? 'dialog' : 'presentation'} aria-label={searchable ? t(label) : undefined}>
      {menuTitle && <h3 className="fx-filter-title">{t(menuTitle)}</h3>}
      {selectionField && <div className="fx-filter-selection"><span>{multiple ? allSelected ? t("All") : options.filter(isSelected).map(option => option.label).join(', ') || t("None") : selected?.label}</span>{clearValue !== undefined && <button type="button" aria-label={t('Bỏ lọc {label}', { label: t(label) })} onClick={() => onChange(clearValue)}>×</button>}<SelectChevron /></div>}
      {searchable && <input ref={input} type="search" aria-label={t('Tìm {label}', { label: t(label) })} placeholder={t(placeholder)} value={search} onChange={event => setSearch(event.target.value)} />}
      {menuHeader}
      {multiple && multipleStyle === 'checkbox' && <button type="button" role="checkbox" disabled={!available.length} aria-checked={allSelected ? true : selectedCount > 0 ? 'mixed' : false} className="fx-select-all" onClick={() => {
        const locked = value.filter(item => !available.some(option => option.value === item))
        onChange(allSelected ? locked : [...locked, ...available.map(option => option.value)])
      }}><span className={`fx-select-checkbox${allSelected ? ' is-checked' : selectedCount > 0 ? ' is-mixed' : ''}`} aria-hidden="true" /><span className="fx-select-option-label">{t(selectAllLabel)}</span></button>}
      <div role="listbox" tabIndex={-1} aria-label={t(label)} aria-multiselectable={multiple || undefined}>{[...groups].map(([group, entries]) => {
        const content = entries.map(option => <button type="button" role="option" key={option.value} aria-selected={isSelected(option)} disabled={option.disabled} title={renderOption || option.disabled ? option.detail : undefined} onClick={() => {
        if (multiple) onChange(isSelected(option) ? value.filter(item => item !== option.value) : [...value, option.value])
        else { onChange(option.value); close() }
      }}>{multiple && multipleStyle === 'checkbox' && <span className={`fx-select-checkbox${isSelected(option) ? ' is-checked' : ''}`} aria-hidden="true" />}{renderOption ? renderOption(option) : <span className="fx-select-option-label">{option.label}{option.detail && <small>{option.detail}</small>}</span>}{(multiple && multipleStyle === 'check' || !multiple && isSelected(option)) && <span className="fx-select-check" aria-hidden="true">{isSelected(option) ? '✓' : ''}</span>}</button>)
        return group ? <div key={group} role="group" aria-label={t(group)}><div className="fx-select-group-title" aria-hidden="true">{t(group)}</div>{content}</div> : <Fragment key={group}>{content}</Fragment>
      })}</div>
      {!visible.length && <p role="status">{t(emptyLabel)}</p>}
    </div>}
  </div>
}
