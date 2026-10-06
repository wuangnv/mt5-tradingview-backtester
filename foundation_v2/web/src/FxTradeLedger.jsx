import { useTestingLocale } from './testingLocale.jsx'
import { TestingSkeleton } from './TestingReadState.jsx'
import { useEffect, useMemo, useRef, useState } from 'react'
import { filterAnalyticsRows, known, outcomeOf } from './tradingAnalyticsModel.js'
import { closeTime } from './sessionPerformanceModel.js'
import FxSelect from './FxSelect.jsx'

const COLUMNS = [
  ['session_id', 'Session'], ['status', 'Type'], ['source', 'Source'], ['recorded_at_utc', 'Entry Date (Realtime)'], ['open_time_utc', 'Entry Date (Chart UTC)'],
  ['symbol', 'Asset'], ['side', 'Side'], ['entry_type', 'Entry type'], ['net_pnl', 'Return'], ['return_pct', 'Return (%)'], ['realized_r', 'Return (R)'],
  ['rating', 'Trade Rating'], ['price_open', 'Entry price'], ['quantity', 'Size'], ['stop_loss', 'Stop loss'], ['take_profit', 'Take profit'],
  ['close_time_utc', 'Exit date (UTC)'], ['price_close', 'Exit price'], ['gross_pnl', 'Gross PnL'], ['fees', 'Fees'], ['tags', 'Tags'],
]
const DEFAULT_COLUMNS = COLUMNS.filter(([key]) => key !== 'tags').map(([key]) => key)
export function TradeInspector({ children, onClose }) {
  const { t } = useTestingLocale()

  const dialog = useRef(null)
  useEffect(() => {
    const opener = document.activeElement
    dialog.current.showModal()
    return () => { dialog.current?.close(); if (opener?.isConnected) opener.focus({ preventScroll: true }) }
  }, [])
  return <dialog className="fxa-trade-inspector" aria-label={t("Chi tiết giao dịch")} ref={dialog} onCancel={event => { event.preventDefault(); onClose() }} onKeyDown={event => {
    if (event.key !== 'Tab') return
    const controls = [...event.currentTarget.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(element => !element.disabled && element.tabIndex >= 0 && element.getClientRects().length)
    const first = controls[0], last = controls[controls.length - 1]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }} onClick={event => { if (event.target === event.currentTarget) { const bounds = event.currentTarget.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose() } }}>{children}</dialog>
}
function valueOf(row, key, model, sessionName) {
  if (key === 'session_id') return sessionName || row.session_name || row.session_id || row.source?.session_id || model.result?.session_id || '—'
  if (key === 'status') return 'Closed'
  if (key === 'source') return model.result?.preview ? 'UI demo' : row.session_id || row.source_provenance?.session_id || model.result?.session_id ? 'Replay' : row.source === 'research ledger' ? 'Research' : '—'
  // The return denominator is explicit; missing capital never becomes a 0% return.
  if (key === 'return_pct') { const capital = model.result?.multi_session ? row.starting_balance : model.startBalance; return known(capital) && capital > 0 && known(row.net_pnl) ? row.net_pnl / capital * 100 : null }
  return row[key]
}
function display(row, key, model, sessionName, { fmt, locale, t }) {
  const value = valueOf(row, key, model, sessionName)
  if (key.endsWith('_time_utc') || key === 'recorded_at_utc') return closeTime(value) ? new Intl.DateTimeFormat(locale, { timeZone: 'UTC', dateStyle: 'short', timeStyle: 'short' }).format(closeTime(value)) : '—'
  if (['net_pnl', 'gross_pnl', 'fees'].includes(key)) return fmt(value, model.result?.multi_session ? ` ${row.account_currency || t('Đơn vị tài khoản')}` : '')
  if (key === 'return_pct') return fmt(value, '%')
  if (key === 'realized_r') return fmt(value, ' R')
  if (['price_open', 'price_close', 'stop_loss', 'take_profit'].includes(key)) return fmt(value, '', 6)
  if (key === 'quantity') return fmt(value, '', 4)
  if (key === 'tags') return Array.isArray(value) && value.length ? value.join(', ') : '—'
  return key === 'side' ? t(String(value).toLowerCase() === 'buy' ? 'Buy' : String(value).toLowerCase() === 'sell' ? 'Sell' : 'Chưa rõ') : ['status', 'source'].includes(key) ? t(value ?? '—') : value ?? '—'
}
export default function FxTradeLedger({ model, extra, selected, onSelect, sessionName, renderFilters, hidden = false, remotePage }) {
  const { t, locale, fmt } = useTestingLocale()

  const data = useMemo(() => ({ rows: remotePage ? model.ledger : filterAnalyticsRows(model.ledger, extra) }), [model, extra, Boolean(remotePage)])
  const [localPage, setLocalPage] = useState(0), [localSize, setLocalSize] = useState(10), [localSort, setLocalSort] = useState({ key: 'close_time_utc', direction: 'desc' })
  const page = remotePage ? remotePage.page - 1 : localPage, size = remotePage?.pageSize || localSize, sort = remotePage?.sort || localSort
  const setPage = value => { if (remotePage) { if (!remotePage.pending && remotePage.totalCount !== null) remotePage.onChange({ page: value + 1 }) } else setLocalPage(value) }
  const setSize = value => remotePage ? remotePage.onChange({ pageSize: value, page: 1 }) : setLocalSize(value)
  const setSort = value => remotePage ? remotePage.onChange({ sort: value, page: 1 }) : setLocalSort(value)
  const [columns, setColumns] = useState(DEFAULT_COLUMNS), [checked, setChecked] = useState(new Set())
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 480px)').matches)
  useEffect(() => {
    const media = window.matchMedia('(max-width: 480px)'), update = () => setCompact(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  const tableScroll = useRef(null)
  const rows = useMemo(() => remotePage ? data.rows : [...data.rows].sort((left, right) => {
    let a = valueOf(left, sort.key, model, sessionName), b = valueOf(right, sort.key, model, sessionName)
    if (sort.key.endsWith('_time_utc') || sort.key === 'recorded_at_utc') { a = closeTime(a)?.getTime(); b = closeTime(b)?.getTime() }
    if (a === null || a === undefined) return b === null || b === undefined ? 0 : 1
    if (b === null || b === undefined) return -1
    const compared = typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), 'vi')
    return (sort.direction === 'asc' ? compared : -compared) || left.rowIndex - right.rowIndex
  }), [data.rows, model, sort, sessionName, Boolean(remotePage)])
  const total = remotePage ? remotePage.totalCount : rows.length
  const pages = Math.max(1, Math.ceil((total || 0) / size)), current = Math.min(page, pages - 1), visible = remotePage ? rows : rows.slice(current * size, (current + 1) * size)
  const pageButtons = compact ? 3 : 5
  useEffect(() => { if (tableScroll.current) tableScroll.current.scrollTop = 0 }, [current, size, sort, extra, model.result])
  useEffect(() => { if (!remotePage) setLocalPage(0) }, [extra, model.result])
  useEffect(() => { setChecked(new Set()) }, [extra, model.result, page])
  const toggle = id => setChecked(values => { const next = new Set(values); if (next.has(id)) next.delete(id); else next.add(id); return next })
  const shownColumns = COLUMNS.filter(([key]) => columns.includes(key))
  const allChecked = visible.length > 0 && visible.every(row => checked.has(row.tradeId))
  const mixedChecked = !allChecked && visible.some(row => checked.has(row.tradeId))
  const selectPage = useRef(null)
  useEffect(() => { if (selectPage.current) selectPage.current.indeterminate = mixedChecked }, [mixedChecked])
  const columnControl = <><button type="button" className="fxa-button fxa-icon-button" aria-label={t("Reset table columns")} title={t("Reset table columns")} onClick={() => setColumns([...DEFAULT_COLUMNS])}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M4 11a8 8 0 1 1 2 7M4 4v7h7" /></svg></button><FxSelect label={t("Cột hiển thị")} value={columns} onChange={setColumns} options={COLUMNS.map(([value, label]) => ({ value, label }))} multiple searchable icon="edit" iconOnly className="fxa-columns-control" /></>
  return <>
    {renderFilters?.(columnControl)}
    <section aria-busy={remotePage?.pending || undefined} hidden={hidden} className="fxa-trades" aria-label={t("Trade ledger")} data-testid="fx-trade-ledger">
    {!renderFilters && <div className="fxa-ledger-tools">{columnControl}</div>}
    {checked.size > 0 && <span className="sr-only" role="status">{checked.size} {t("đã chọn")}</span>}
    <div className="fxa-table-scroll" ref={tableScroll} tabIndex={0} role="region" aria-label={t("Giao dịch, cuộn ngang để xem các cột")}><table><thead><tr><th><input ref={selectPage} disabled={remotePage?.pending} aria-checked={mixedChecked ? "mixed" : allChecked} aria-label={t("Chọn các lệnh trên trang")} type="checkbox" checked={allChecked} onChange={() => setChecked(values => { const next = new Set(values); visible.forEach(row => allChecked ? next.delete(row.tradeId) : next.add(row.tradeId)); return next })} /></th><th>{t("Actions")}</th>{shownColumns.map(([key, label]) => <th key={key} aria-sort={sort.key === key ? sort.direction === 'asc' ? 'ascending' : 'descending' : 'none'}><button type="button" disabled={remotePage?.pending} onClick={() => { setSort({ key, direction: sort.key === key && sort.direction === 'asc' ? 'desc' : 'asc' }); setPage(0) }}>{key === 'net_pnl' ? t('Net P/L') + ' (' + (model.result?.account_currency || t('Đơn vị tài khoản')) + ')' : t(label)}{sort.key === key ? sort.direction === 'asc' ? ' ↑' : ' ↓' : ''}</button></th>)}</tr></thead><tbody>{remotePage?.pending ? <tr><td colSpan={shownColumns.length + 2}><TestingSkeleton rows={3} /></td></tr> : visible.map(row => <tr key={row.tradeId} className={selected === row.tradeId ? 'is-selected' : ''}><td><input type="checkbox" aria-label={t("Chọn lệnh {id}", { id: row.tradeId })} checked={checked.has(row.tradeId)} onChange={() => toggle(row.tradeId)} /></td><td><button className="fxa-detail-button" type="button" aria-label={t("Chi tiết {id}", { id: row.tradeId })} aria-pressed={selected === row.tradeId} onClick={() => onSelect(selected === row.tradeId ? '' : row.tradeId)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="1" /><path d="M5 17h14" /></svg></button></td>{shownColumns.map(([key]) => <td key={key} className={['net_pnl', 'gross_pnl'].includes(key) ? outcomeOf(row[key]) === 'win' ? 'is-positive' : outcomeOf(row[key]) === 'loss' ? 'is-negative' : '' : ''}>{['status', 'side'].includes(key) ? <span className={`fxa-badge is-${key === 'status' ? 'closed' : String(row.side).toLowerCase()}`}>{display(row, key, model, sessionName, { fmt, locale, t })}</span> : key === 'session_id' ? <span title={row.trade_id || row.tradeId}>{display(row, key, model, sessionName, { fmt, locale, t })}</span> : display(row, key, model, sessionName, { fmt, locale, t })}</td>)}</tr>)}</tbody></table>{!remotePage?.pending && total !== null && !rows.length && <p className="fxa-empty">{t("Không có giao dịch khớp bộ lọc.")}</p>}</div>
    <nav className="fxa-pagination" aria-label={t("Trade ledger pagination")} data-testid="analytics-ledger-pagination"><div><button className="fxa-button" type="button" aria-label={t("Trang đầu")} disabled={remotePage?.pending || current === 0} onClick={() => setPage(0)}>«</button><button className="fxa-button" type="button" aria-label={t("Trang trước")} disabled={remotePage?.pending || current === 0} onClick={() => setPage(current - 1)}>‹</button>{Array.from({ length: Math.min(pages, pageButtons) }, (_, i) => Math.min(Math.max(0, current - Math.floor(pageButtons / 2)), Math.max(0, pages - pageButtons)) + i).map(index => <button key={index} type="button" className="fxa-button" aria-label={t("Trang {page}", { page: index + 1 })} disabled={remotePage?.pending || total === null} aria-current={current === index ? 'page' : undefined} onClick={() => setPage(index)}>{index + 1}</button>)}<button className="fxa-button" type="button" aria-label={t("Trang sau")} disabled={remotePage?.pending || current >= pages - 1} onClick={() => setPage(current + 1)}>›</button><button className="fxa-button" type="button" aria-label={t("Trang cuối")} disabled={remotePage?.pending || current >= pages - 1} onClick={() => setPage(pages - 1)}>»</button></div><FxSelect disabled={remotePage?.pending} label={t("Số dòng Trades")} value={size} onChange={value => { setSize(Number(value)); setPage(0) }} triggerContent={String(size)} options={[10, 25, 50, 100].map(value => ({ value, label: String(value) }))} /></nav>
  </section></>
}
