import React, { useEffect, useRef, useState } from 'react'
import FxSelect, { FilterIcon } from './FxSelect.jsx'
import { calendarParts, DEFAULT_EXTRA_FILTERS, filterValues, WEEKDAYS } from './tradingAnalyticsModel.js'
import './ledger-controls.css'

const baseFilters = { side: 'all', outcome: 'all', from: '', to: '' }
function Choices({ label, options, value, onChange }) {
  const selected = filterValues(value)
  return <div className="fxl-choices" role="group" aria-label={label}>{options.length ? options.map(([key, name]) => <label key={key}><input type="checkbox" checked={selected.includes(String(key))} onChange={() => { const next = selected.includes(String(key)) ? selected.filter(item => item !== String(key)) : [...selected, String(key)]; onChange(next.length ? JSON.stringify(next) : '') }} />{name}</label>) : <p>Chưa có dữ liệu {label.toLowerCase()}.</p>}</div>
}
export default function LedgerFilterDrawer({ initialTab, filters, extra, rows, onApply, onClose }) {
  const dialog = useRef(null)
  const [tab, setTab] = useState(initialTab), [search, setSearch] = useState('')
  const [draft, setDraft] = useState({ ...baseFilters, ...filters })
  const [draftExtra, setDraftExtra] = useState(() => ({ ...DEFAULT_EXTRA_FILTERS, ...extra,
    assets: extra.assets || (extra.asset !== 'all' ? JSON.stringify([extra.asset]) : ''),
    sides: extra.sides || (filters.side !== 'all' ? JSON.stringify([filters.side]) : ''),
    outcomes: extra.outcomes || (filters.outcome !== 'all' ? JSON.stringify([filters.outcome]) : ''),
    tagInclude: extra.tagInclude || (extra.tag !== 'all' ? JSON.stringify([extra.tag]) : ''),
    days: extra.days || (extra.weekday !== 'all' ? JSON.stringify([extra.weekday]) : ''),
    hours: extra.hours || (extra.hour !== 'all' ? JSON.stringify([extra.hour]) : ''),
  }))
  const change = patch => setDraftExtra(value => ({ ...value, ...patch }))
  const unique = key => [...new Set(rows.flatMap(row => key === 'tags' ? row.tags || [] : row[key] ? [row[key]] : []))].sort()
  const years = [...new Set(rows.map(row => calendarParts(row.close_time_utc, draftExtra.timezone)?.key.slice(0, 4)).filter(Boolean))].sort()
  useEffect(() => {
    const opener = document.activeElement, element = dialog.current
    element.showModal()
    return () => { element.close(); if (opener?.isConnected) opener.focus({ preventScroll: true }) }
  }, [])
  const clear = () => { setDraft(baseFilters); setDraftExtra({ ...DEFAULT_EXTRA_FILTERS }) }
  const apply = () => {
    onApply({ ...draft, side: 'all', outcome: 'all' }, { ...draftExtra, asset: 'all', tag: 'all', weekday: 'all', hour: 'all' })
    onClose()
  }
  const sections = [
    ['Notes', <label className="fxl-field">Notes<input type="search" aria-label="Notes filter" value={draftExtra.notes} onChange={event => change({ notes: event.target.value })} placeholder="Search notes" />{!rows.some(row => typeof row.notes === 'string' || typeof row.note === 'string') && <small>Chưa có ghi chú trong dữ liệu giao dịch.</small>}</label>],
    ['Assets', <Choices label="Assets" value={draftExtra.assets} options={unique('symbol').map(value => [value, value])} onChange={assets => change({ assets })} />],
    ['Side', <Choices label="Side" value={draftExtra.sides} options={[["buy", 'Buy'], ["sell", 'Sell']]} onChange={sides => change({ sides })} />],
    ['Outcome', <Choices label="Outcome" value={draftExtra.outcomes} options={[["win", 'Win'], ["loss", 'Loss'], ["breakeven", 'Breakeven'], ["unknown", 'Unknown']]} onChange={outcomes => change({ outcomes })} />],
    ['Type', <Choices label="Type" value={draftExtra.types} options={unique('entry_type').map(value => [value, value])} onChange={types => change({ types })} />],
    ['Date range', <div className="fxl-fields"><label className="fxl-field">From · close date (UTC)<input type="date" aria-label="Analytics from date" value={draft.from} max={draft.to || undefined} onChange={event => setDraft(value => ({ ...value, from: event.target.value }))} /></label><label className="fxl-field">To · close date (UTC)<input type="date" aria-label="Analytics to date" value={draft.to} min={draft.from || undefined} onChange={event => setDraft(value => ({ ...value, to: event.target.value }))} /></label></div>],
    ['Year', <Choices label="Year" value={draftExtra.years} options={years.map(value => [value, value])} onChange={years => change({ years })} />],
    ['Month', <Choices label="Month" value={draftExtra.months} options={Array.from({ length: 12 }, (_, i) => [i + 1, String(i + 1)])} onChange={months => change({ months })} />],
    ['Days', <Choices label="Days" value={draftExtra.days} options={WEEKDAYS.map((value, index) => [index, value])} onChange={days => change({ days })} />],
    ['Hour of the day', <Choices label="Hour of the day" value={draftExtra.hours} options={Array.from({ length: 24 }, (_, i) => [i, `${String(i).padStart(2, '0')}:00`])} onChange={hours => change({ hours })} />],
  ]
  const calendarActive = ['years', 'months', 'days', 'hours'].some(key => filterValues(draftExtra[key]).length)
  return <dialog ref={dialog} className="fxl-filter-drawer" aria-label="Filters" onCancel={event => { event.preventDefault(); onClose() }} onKeyDown={event => {
    if (event.key !== 'Tab') return
    const controls = [...event.currentTarget.querySelectorAll('button, input, summary, [href], [tabindex]')].filter(element => !element.disabled && element.tabIndex >= 0 && element.getClientRects().length)
    const first = controls[0], last = controls.at(-1)
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  }} onClick={event => { if (event.target !== event.currentTarget) return; const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose() }}>
    <header><h2><FilterIcon kind="filter" />Filters</h2><button type="button" className="fxl-close" onClick={onClose} aria-label="Đóng Filters">×</button></header>
    <div className="fxl-tabs" role="tablist" aria-label="Filter type">{['Basic', 'Tags'].map(name => <button key={name} type="button" role="tab" aria-selected={tab === name} aria-controls={`fxl-${name.toLowerCase()}`} id={`fxl-tab-${name.toLowerCase()}`} tabIndex={tab === name ? 0 : -1} onClick={() => setTab(name)} onKeyDown={event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const next = event.key === 'Home' ? 'Basic' : event.key === 'End' ? 'Tags' : tab === 'Basic' ? 'Tags' : 'Basic'; setTab(next); document.getElementById(`fxl-tab-${next.toLowerCase()}`)?.focus() } }}>{name}</button>)}</div>
    <div className="fxl-drawer-body">
      {tab === 'Basic' ? <section role="tabpanel" id="fxl-basic" aria-labelledby="fxl-tab-basic"><label className="fxl-filter-search"><span className="sr-only">Search filter</span><input type="search" aria-label="Search filter" placeholder="Search filter" value={search} onChange={event => setSearch(event.target.value)} /></label>{sections.filter(([name]) => name.toLowerCase().includes(search.trim().toLowerCase())).map(([name, content]) => <details key={name}><summary>{name}</summary>{content}</details>)}{calendarActive && <small className="fxl-timezone">Year, Month, Days và Hour theo {draftExtra.timezone}.</small>}</section> : <section role="tabpanel" id="fxl-tags" aria-labelledby="fxl-tab-tags">{['Include', 'Exclude'].map((name, index) => {
        const key = name === 'Include' ? 'tagInclude' : 'tagExclude', mode = `${key}Mode`
        return <React.Fragment key={key}>{index > 0 && <div className="fxl-tag-separator">AND</div>}<div className="fxl-tag-heading"><span>{name}</span><div role="group" aria-label={`${name} match`}>{['AND', 'OR'].map(value => <button type="button" key={value} aria-pressed={draftExtra[mode] === value} onClick={() => change({ [mode]: value })}>{value}</button>)}</div></div><FxSelect label={`${name} tags`} triggerContent={filterValues(draftExtra[key]).length ? filterValues(draftExtra[key]).join(', ') : 'Select tags'} multiple searchable value={filterValues(draftExtra[key])} options={unique('tags').map(value => ({ value, label: value }))} onChange={value => change({ [key]: value.length ? JSON.stringify(value) : '' })} /></React.Fragment>
      })}</section>}
    </div>
    <footer><button type="button" className="fxl-clear" onClick={clear}>Clear All</button><button type="button" className="fxa-button is-primary" disabled={Boolean(draft.from && draft.to && draft.from > draft.to)} onClick={apply}>Apply Filters</button></footer>
  </dialog>
}
