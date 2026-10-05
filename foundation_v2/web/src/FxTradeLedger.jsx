import React, { useEffect, useMemo, useState } from 'react'
import { filterAnalyticsRows, known, outcomeOf } from './tradingAnalyticsModel.js'
import { closeTime } from './sessionPerformanceModel.js'
import FxSelect from './FxSelect.jsx'
import { fmt } from './FxAnalytics.jsx'

const dateFormatter = new Intl.DateTimeFormat('vi-VN', { timeZone: 'UTC', dateStyle: 'short', timeStyle: 'short' })
const date = value => closeTime(value) ? dateFormatter.format(closeTime(value)) : '—'
const COLUMNS = [
  ['session_id', 'Session'], ['status', 'Type'], ['source', 'Source'], ['recorded_at_utc', 'Entry (realtime)'], ['open_time_utc', 'Entry (chart UTC)'],
  ['symbol', 'Asset'], ['side', 'Side'], ['entry_type', 'Entry type'], ['net_pnl', 'Return'], ['return_pct', 'Return (%)'], ['realized_r', 'Return (R)'],
  ['rating', 'Rating'], ['price_open', 'Entry price'], ['quantity', 'Size'], ['stop_loss', 'Stop loss'], ['take_profit', 'Take profit'],
  ['close_time_utc', 'Exit (UTC)'], ['price_close', 'Exit price'], ['gross_pnl', 'Gross P/L'], ['fees', 'Fees'], ['tags', 'Tags'],
]
const DEFAULT_COLUMNS = ['session_id', 'status', 'source', 'recorded_at_utc', 'open_time_utc', 'symbol', 'side', 'entry_type', 'net_pnl', 'return_pct', 'realized_r', 'rating']
function valueOf(row, key, model, sessionName) {
  if (key === 'session_id') return sessionName || row.session_name || row.session_id || row.source?.session_id || model.result?.session_id || '—'
  if (key === 'status') return 'Closed'
  if (key === 'source') return model.result?.preview ? 'UI demo' : row.session_id || row.source_provenance?.session_id || model.result?.session_id ? 'Replay' : row.source === 'research ledger' ? 'Research' : '—'
  // The return denominator is explicit; missing capital never becomes a 0% return.
  if (key === 'return_pct') { const capital = model.result?.multi_session ? row.starting_balance : model.startBalance; return known(capital) && capital > 0 && known(row.net_pnl) ? row.net_pnl / capital * 100 : null }
  return row[key]
}
function display(row, key, model, sessionName) {
  const value = valueOf(row, key, model, sessionName)
  if (key.endsWith('_time_utc') || key === 'recorded_at_utc') return date(value)
  if (['net_pnl', 'gross_pnl', 'fees'].includes(key)) return fmt(value, model.result?.multi_session ? ` ${row.account_currency || 'đơn vị chưa rõ'}` : '')
  if (key === 'return_pct') return fmt(value, '%')
  if (key === 'realized_r') return fmt(value, ' R')
  if (['price_open', 'price_close', 'stop_loss', 'take_profit'].includes(key)) return fmt(value, '', 6)
  if (key === 'quantity') return fmt(value, '', 4)
  if (key === 'tags') return Array.isArray(value) && value.length ? value.join(', ') : '—'
  return value ?? '—'
}
export default function FxTradeLedger({ model, extra, selected, onSelect, sessionName }) {
  const data = useMemo(() => ({ rows: filterAnalyticsRows(model.ledger, extra) }), [model, extra])
  const [page, setPage] = useState(0), [size, setSize] = useState(10), [sort, setSort] = useState({ key: 'close_time_utc', direction: 'desc' })
  const [columns, setColumns] = useState(DEFAULT_COLUMNS), [checked, setChecked] = useState(new Set())
  const [showColumns, setShowColumns] = useState(false)
  const rows = useMemo(() => [...data.rows].sort((left, right) => {
    let a = valueOf(left, sort.key, model, sessionName), b = valueOf(right, sort.key, model, sessionName)
    if (sort.key.endsWith('_time_utc') || sort.key === 'recorded_at_utc') { a = closeTime(a)?.getTime(); b = closeTime(b)?.getTime() }
    if (a === null || a === undefined) return b === null || b === undefined ? 0 : 1
    if (b === null || b === undefined) return -1
    const compared = typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), 'vi')
    return (sort.direction === 'asc' ? compared : -compared) || left.rowIndex - right.rowIndex
  }), [data.rows, model, sort, sessionName])
  const pages = Math.max(1, Math.ceil(rows.length / size)), current = Math.min(page, pages - 1), visible = rows.slice(current * size, (current + 1) * size)
  useEffect(() => { setPage(0); setChecked(new Set()) }, [extra, model.result])
  const toggle = id => setChecked(values => { const next = new Set(values); if (next.has(id)) next.delete(id); else next.add(id); return next })
  const shownColumns = COLUMNS.filter(([key]) => columns.includes(key))
  const allChecked = visible.length > 0 && visible.every(row => checked.has(row.tradeId))
  return <section className="fxa-trades" aria-label="Trade ledger" data-testid="fx-trade-ledger">
    <div className="fxa-ledger-tools">{checked.size > 0 && <span>{checked.size} đã chọn</span>}<button className="fxa-button fxa-icon-button" title="Cột hiển thị" aria-label="Cột hiển thị" type="button" aria-expanded={showColumns} aria-controls="fxa-columns" onClick={() => setShowColumns(!showColumns)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16M15 4v16" /></svg></button></div>
    {showColumns && <fieldset className="fxa-column-picker" id="fxa-columns"><legend>Chọn cột</legend>{COLUMNS.map(([key, title]) => <label key={key}><input type="checkbox" checked={columns.includes(key)} onChange={() => setColumns(values => values.includes(key) ? values.filter(value => value !== key) : [...values, key])} />{title}</label>)}</fieldset>}
    <div className="fxa-table-scroll" tabIndex={0} role="region" aria-label="Giao dịch, cuộn ngang để xem các cột"><table><thead><tr><th><input aria-label="Chọn các lệnh trên trang" type="checkbox" checked={allChecked} onChange={() => setChecked(values => { const next = new Set(values); visible.forEach(row => allChecked ? next.delete(row.tradeId) : next.add(row.tradeId)); return next })} /></th><th>Actions</th>{shownColumns.map(([key, label]) => <th key={key} aria-sort={sort.key === key ? sort.direction === 'asc' ? 'ascending' : 'descending' : 'none'}><button type="button" onClick={() => { setSort({ key, direction: sort.key === key && sort.direction === 'asc' ? 'desc' : 'asc' }); setPage(0) }}>{key === 'net_pnl' ? 'Return (' + (model.result?.account_currency || 'đơn vị tài khoản') + ')' : label}{sort.key === key ? sort.direction === 'asc' ? ' ↑' : ' ↓' : ''}</button></th>)}</tr></thead><tbody>{visible.map(row => <tr key={row.tradeId} className={selected === row.tradeId ? 'is-selected' : ''}><td><input type="checkbox" aria-label={`Chọn lệnh ${row.tradeId}`} checked={checked.has(row.tradeId)} onChange={() => toggle(row.tradeId)} /></td><td><button className="fxa-detail-button" type="button" aria-label={`Chi tiết ${row.tradeId}`} aria-pressed={selected === row.tradeId} onClick={() => onSelect(selected === row.tradeId ? '' : row.tradeId)}>↗</button></td>{shownColumns.map(([key]) => <td key={key} className={['net_pnl', 'gross_pnl'].includes(key) ? outcomeOf(row[key]) === 'win' ? 'is-positive' : outcomeOf(row[key]) === 'loss' ? 'is-negative' : '' : ''}>{['status', 'side'].includes(key) ? <span className={`fxa-badge is-${key === 'status' ? 'closed' : String(row.side).toLowerCase()}`}>{display(row, key, model, sessionName)}</span> : key === 'session_id' ? <span title={row.trade_id || row.tradeId}>{display(row, key, model, sessionName)}</span> : display(row, key, model, sessionName)}</td>)}</tr>)}</tbody></table></div>
    {!rows.length && <p className="fxa-empty">Không có giao dịch khớp bộ lọc.</p>}
    <nav className="fxa-pagination" aria-label="Trade ledger pagination" data-testid="analytics-ledger-pagination"><div><button className="fxa-button" type="button" aria-label="Trang trước" disabled={current === 0} onClick={() => setPage(current - 1)}>‹</button>{Array.from({ length: Math.min(pages, 7) }, (_, i) => Math.min(Math.max(0, current - 3), Math.max(0, pages - 7)) + i).map(index => <button key={index} type="button" className="fxa-button" aria-label={`Trang ${index + 1}`} aria-current={current === index ? 'page' : undefined} onClick={() => setPage(index)}>{index + 1}</button>)}<button className="fxa-button" type="button" aria-label="Trang sau" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>›</button></div><FxSelect label="Số dòng Trades" value={size} onChange={value => { setSize(Number(value)); setPage(0) }} triggerContent={`${size} / trang`} options={[10, 25, 50, 100].map(value => ({ value, label: String(value) }))} /></nav>
  </section>
}
