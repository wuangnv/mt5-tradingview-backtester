import { useTestingLocale } from './testingLocale.jsx'
import { useEffect, useId, useRef, useState } from 'react'
import { FilterIcon, SelectChevron } from './FxSelect.jsx'
import './analytics-filter-controls.css'

export const timezoneOptions = (() => {
  const preferred = ['UTC', 'Asia/Ho_Chi_Minh', 'Pacific/Honolulu', 'America/Anchorage', 'America/Juneau', 'America/New_York', 'Europe/London']
  const zones = [...new Set([...preferred, ...Intl.supportedValuesOf('timeZone')])]
  return zones.map(value => {
    if (value === 'UTC') return { value, label: 'UTC' }
    const offset = new Intl.DateTimeFormat('en', { timeZone: value, timeZoneName: 'shortOffset' }).formatToParts(new Date()).find(part => part.type === 'timeZoneName').value.replace('GMT', 'UTC')
    const city = value === 'Asia/Ho_Chi_Minh' ? 'Ho Chi Minh' : value.split('/').slice(1).join(' / ').replaceAll('_', ' ')
    return { value, label: `(${offset}) ${city}`, detail: value }
  })
})()

function FilterPopover({ label, title, icon, children }) {
  const { t } = useTestingLocale()

  const [open, setOpen] = useState(false)
  const root = useRef(null), trigger = useRef(null), id = useId()
  useEffect(() => {
    if (!open) return
    const position = () => {
      const menu = root.current?.querySelector('.fx-filter-popover')
      if (!menu) return
      const container = root.current.closest('.fx-content')
      const clip = container?.getBoundingClientRect()
      const left = Math.max(12, (clip?.left || 0) + 12), right = Math.min(window.innerWidth - 12, (clip ? clip.left + container.clientWidth : window.innerWidth) - 12)
      menu.style.maxWidth = `${right - left}px`; menu.style.transform = ''; menu.style.top = 'calc(100% + 8px)'; menu.style.bottom = 'auto'; menu.style.maxHeight = ''
      const bounds = menu.getBoundingClientRect()
      menu.style.transform = `translateX(${bounds.left < left ? left - bounds.left : bounds.right > right ? right - bounds.right : 0}px)`
      const anchor = trigger.current.getBoundingClientRect()
      const below = Math.min(window.innerHeight, clip?.bottom || window.innerHeight) - anchor.bottom - 20
      const above = anchor.top - Math.max(0, clip?.top || 0) - 20
      const upwards = bounds.height > below && above > below
      if (upwards) { menu.style.top = 'auto'; menu.style.bottom = 'calc(100% + 8px)' }
      menu.style.maxHeight = `${Math.max(44, upwards ? above : below)}px`
    }
    position()
    root.current.querySelector('.fx-filter-popover input')?.focus({ preventScroll: true })
    const outside = event => { if (!root.current?.contains(event.target)) setOpen(false) }
    document.addEventListener('pointerdown', outside); window.addEventListener('resize', position)
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('resize', position) }
  }, [open])
  return <div className="fx-filter-control" ref={root} onBlur={event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false) }} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); setOpen(false); trigger.current?.focus() } }}>
    <button ref={trigger} type="button" className="fxa-button fxa-filter-pill" aria-label={label} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(!open)}>{icon && <FilterIcon kind={icon} />}{t(label)}<SelectChevron /></button>
    {open && <div id={id} role="dialog" tabIndex={-1} aria-label={title} className="fx-filter-popover"><h3 className="fx-filter-title">{t(title)}</h3>{children}</div>}
  </div>
}

export function TimeFilter({ value, onChange }) {
  const { t } = useTestingLocale()

  return <FilterPopover label={t("Time")} title={t("Time filter")}><div className="fx-time-range">{[['timeStart', 'Start'], ['timeEnd', 'End']].map(([key, label]) => <label key={key}>{t(label)}<input type="time" step="60" aria-label={t(`Time ${label}`)} value={value[key] || ''} onChange={event => onChange({ [key]: event.target.value, hour: 'all' })} /></label>)}</div><button type="button" className="fx-filter-clear" onClick={() => onChange({ timeStart: '', timeEnd: '', hour: 'all' })}>{t("Clear")}</button></FilterPopover>
}

export function DateFilter({ value, onChange }) {
  const { t, locale } = useTestingLocale()

  const [month, setMonth] = useState(() => {
    const date = value.from ? new Date(`${value.from}T00:00:00Z`) : new Date()
    return (Number.isNaN(date.getTime()) ? new Date() : date).toISOString().slice(0, 7)
  })
  const [endpoint, setEndpoint] = useState('from')
  const first = new Date(`${month}-01T00:00:00Z`)
  const days = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  const shiftMonth = delta => setMonth(new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + delta, 1)).toISOString().slice(0, 7))
  const choose = date => {
    if (endpoint === 'from') { onChange({ from: date, to: '' }); setEndpoint('to') }
    else { onChange(date < value.from ? { from: date, to: value.from } : { to: date }); setEndpoint('from') }
  }
  return <FilterPopover label={t("Backtesting Date")} title={t("Backtesting date filter")} icon="calendar">
    <div className="fx-date-range">{[['from', 'Start'], ['to', 'End']].map(([key, label]) => <label key={key}>{t(label)}<input type="date" aria-label={t(`Analytics ${key} date`)} value={value[key]} onFocus={() => setEndpoint(key)} onChange={event => { onChange({ [key]: event.target.value }); if (event.target.value) setMonth(event.target.value.slice(0, 7)) }} /></label>)}</div>
    <div className="fx-calendar-heading"><button type="button" aria-label={t("Previous month")} onClick={() => shiftMonth(-1)}>‹</button><strong aria-live="polite">{first.toLocaleDateString(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' })}</strong><button type="button" aria-label={t("Next month")} onClick={() => shiftMonth(1)}>›</button></div>
    <div className="fx-calendar" role="group" aria-label={t("Chọn khoảng ngày đóng UTC")}>{['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(day => <span key={day}>{t(day)}</span>)}{Array.from({ length: first.getUTCDay() }, (_, i) => <span key={`blank-${i}`} />)}{Array.from({ length: days }, (_, i) => {
      const date = `${month}-${String(i + 1).padStart(2, '0')}`, selected = date === value.from || date === value.to
      return <button key={date} type="button" aria-label={date} aria-pressed={selected} className={selected ? 'is-endpoint' : value.from && value.to && date > value.from && date < value.to ? 'is-in-range' : ''} onClick={() => choose(date)}>{i + 1}</button>
    })}</div><button type="button" className="fx-filter-clear" onClick={() => { onChange({ from: '', to: '' }); setEndpoint('from') }}>{t("Clear")}</button>
  </FilterPopover>
}
