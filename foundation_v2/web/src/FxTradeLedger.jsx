import React, { useEffect, useMemo, useState } from 'react'
import { advancedAnalytics, known, outcomeOf } from './tradingAnalyticsModel.js'
import { closeTime } from './sessionPerformanceModel.js'
import { fmt, SelectField } from './FxAnalytics.jsx'

const dateFormatter = new Intl.DateTimeFormat('vi-VN', { timeZone: 'UTC', dateStyle: 'short', timeStyle: 'short' })
const date = value => closeTime(value) ? dateFormatter.format(closeTime(value)) : '—'
const COLUMNS = [
  ['session_id', 'Session'], ['status', 'Type'], ['source', 'Source'], ['recorded_at_utc', 'Entry (realtime)'], ['open_time_utc', 'Entry (chart UTC)'],
  ['symbol', 'Asset'], ['side', 'Side'], ['entry_type', 'Entry type'], ['net_pnl', 'Return'], ['return_pct', 'Return (%)'], ['realized_r', 'Return (R)'],
  ['rating', 'Rating'], ['price_open', 'Entry price'], ['quantity', 'Size'], ['stop_loss', 'Stop loss'], ['take_profit', 'Take profit'],
  ['close_time_utc', 'Exit (UTC)'], ['price_close', 'Exit price'], ['gross_pnl', 'Gross P/L'], ['fees', 'Fees'], ['tags', 'Tags'],
]
const DEFAULT_COLUMNS = ['session_id', 'status', 'symbol', 'side', 'open_time_utc', 'net_pnl', 'realized_r', 'price_open', 'quantity', 'stop_loss', 'take_profit', 'close_time_utc', 'price_close', 'gross_pnl', 'fees']
function valueOf(row, key, model, sessionName) {
  if (key === 'session_id') return sessionName || row.session_id || row.source?.session_id || model.result?.session_id || '—'
  if (key === 'status') return 'Closed'
  if (key === 'source') return typeof row.source === 'string' ? row.source : row.source?.session_id || '—'
  // The return denominator is explicit; missing capital never becomes a 0% return.
  if (key === 'return_pct') return known(model.startBalance) && model.startBalance > 0 && known(row.net_pnl) ? row.net_pnl / model.startBalance * 100 : null
  return row[key]
}
function display(row, key, model, sessionName) {
  const value = valueOf(row, key, model, sessionName)
  if (key.endsWith('_time_utc') || key === 'recorded_at_utc') return date(value)
  if (['net_pnl', 'gross_pnl', 'fees'].includes(key)) return fmt(value)
  if (key === 'return_pct') return fmt(value, '%')
  if (key === 'realized_r') return fmt(value, ' R')
  if (['price_open', 'price_close', 'stop_loss', 'take_profit'].includes(key)) return fmt(value, '', 6)
  if (key === 'quantity') return fmt(value, '', 4)
  if (key === 'tags') return Array.isArray(value) && value.length ? value.join(', ') : '—'
  return value ?? '—'
}
export default function FxTradeLedger({ model, extra, selected, onSelect, sessionName }) {
  const data = useMemo(() => advancedAnalytics(model, extra), [model, extra])
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
    <div className="fxa-report-scope"><span>{rows.length} giao dịch đóng · {model.result?.account_currency || 'đơn vị tài khoản'} · UTC{checked.size > 0 ? ` · đã chọn ${checked.size}` : ''}</span><button className="fxa-button" type="button" aria-expanded={showColumns} aria-controls="fxa-columns" onClick={() => setShowColumns(!showColumns)}>Cột hiển thị</button></div>
    {showColumns && <fieldset className="fxa-column-picker" id="fxa-columns"><legend>Chọn cột</legend>{COLUMNS.map(([key, title]) => <label key={key}><input type="checkbox" checked={columns.includes(key)} onChange={() => setColumns(values => values.includes(key) ? values.filter(value => value !== key) : [...values, key])} />{title}</label>)}</fieldset>}
    <div className="fxa-table-scroll" tabIndex={0} role="region" aria-label="Giao dịch, cuộn ngang để xem các cột"><table><thead><tr><th><input aria-label="Chọn các lệnh trên trang" type="checkbox" checked={allChecked} onChange={() => setChecked(values => { const next = new Set(values); visible.forEach(row => allChecked ? next.delete(row.tradeId) : next.add(row.tradeId)); return next })} /></th><th>Actions</th>{shownColumns.map(([key, label]) => <th key={key} aria-sort={sort.key === key ? sort.direction === 'asc' ? 'ascending' : 'descending' : 'none'}><button type="button" onClick={() => { setSort({ key, direction: sort.key === key && sort.direction === 'asc' ? 'desc' : 'asc' }); setPage(0) }}>{key === 'net_pnl' ? 'Return (' + (model.result?.account_currency || 'đơn vị tài khoản') + ')' : label}{sort.key === key ? sort.direction === 'asc' ? ' ↑' : ' ↓' : ''}</button></th>)}</tr></thead><tbody>{visible.map(row => <tr key={row.tradeId} className={selected === row.tradeId ? 'is-selected' : ''}><td><input type="checkbox" aria-label={`Chọn lệnh ${row.tradeId}`} checked={checked.has(row.tradeId)} onChange={() => toggle(row.tradeId)} /></td><td><button className="fxa-detail-button" type="button" aria-label={`Chi tiết ${row.tradeId}`} aria-pressed={selected === row.tradeId} onClick={() => onSelect(selected === row.tradeId ? '' : row.tradeId)}>↗</button></td>{shownColumns.map(([key]) => <td key={key} className={['net_pnl', 'gross_pnl'].includes(key) ? outcomeOf(row[key]) === 'win' ? 'is-positive' : outcomeOf(row[key]) === 'loss' ? 'is-negative' : '' : ''}>{['status', 'side'].includes(key) ? <span className={`fxa-badge is-${key === 'status' ? 'closed' : String(row.side).toLowerCase()}`}>{display(row, key, model, sessionName)}</span> : key === 'session_id' ? <><span>{display(row, key, model, sessionName)}</span><small>{row.tradeId}</small></> : display(row, key, model, sessionName)}</td>)}</tr>)}</tbody></table></div>
    {!rows.length && <p className="fxa-empty">Không có giao dịch khớp bộ lọc.</p>}
    <nav className="fxa-pagination" aria-label="Trade ledger pagination" data-testid="analytics-ledger-pagination"><SelectField label="Số dòng Trades" value={String(size)} onChange={value => { setSize(Number(value)); setPage(0) }} options={[10, 25, 50, 100].map(value => [String(value), String(value)])} /><div><button className="fxa-button" type="button" aria-label="Trang đầu" disabled={current === 0} onClick={() => setPage(0)}>«</button><button className="fxa-button" type="button" aria-label="Trang trước" disabled={current === 0} onClick={() => setPage(current - 1)}>‹</button><span aria-live="polite">{current + 1} / {pages} · {rows.length ? current * size + 1 : 0}–{Math.min((current + 1) * size, rows.length)} / {rows.length}</span><button className="fxa-button" type="button" aria-label="Trang sau" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>›</button><button className="fxa-button" type="button" aria-label="Trang cuối" disabled={current >= pages - 1} onClick={() => setPage(pages - 1)}>»</button></div></nav><small>— = chưa có dữ liệu nguồn. Return (%) chia cho vốn ban đầu. Trường realtime, phí, SL/TP và rating chỉ hiện khi nguồn cung cấp.</small>
  </section>
}
