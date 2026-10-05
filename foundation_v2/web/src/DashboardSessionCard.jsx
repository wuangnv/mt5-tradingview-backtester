import React, { useEffect, useId, useRef, useState } from 'react'
import SessionPerformance from './SessionPerformance.jsx'
import { canResumeSession } from './sessionCatalog.js'
import { dashboardMoney } from './dashboardModel.js'
import './dashboard-session.css'

const date = value => Number.isFinite(Number(value)) && value != null ? new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeZone: 'UTC' }).format(new Date(Number(value) * 1000)) : '—'

function SessionIcon({ kind }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{kind === 'archive' ? <><path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6m4-6v6" /></> : kind === 'edit' ? <path d="m16 3 5 5-12 12H4v-5ZM13 6l5 5" /> : kind === 'analytics' ? <path d="M5 20V11m7 9V4m7 16V8" /> : kind === 'duplicate' ? <><rect x="8" y="8" width="12" height="13" rx="1" /><path d="M16 8V3H4v13h4" /></> : kind === 'summary' ? <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></> : kind === 'calendar' ? <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4m8-4v4M4 10h16" /></> : kind === 'balance' ? <><rect x="3" y="6" width="18" height="12" rx="2" /><circle cx="12" cy="12" r="3" /></> : kind === 'play' ? <path d="m9 6 9 6-9 6Z" fill="currentColor" stroke="none" /> : <path d="m5 9 7 7 7-7" />}</svg>
}

export default function DashboardSessionCard({ item, detail, dataset, href, onManage, onRemember, preview = false }) {
  const [expanded, setExpanded] = useState(false)
  const panelId = useId()
  const model = detail?.model, payload = detail?.payload || {}
  const name = item.name || item.record_id
  const knownProgress = Number.isInteger(item.row_count) && item.row_count > 0 && Number.isInteger(item.cursor_index)
  const remaining = knownProgress ? Math.max(0, item.row_count - item.cursor_index - 1) : null
  const cutoff = payload.provenance?.cutoff_timestamp
  const days = typeof cutoff === 'number' && typeof dataset?.last_timestamp === 'number' ? Math.max(0, Math.ceil((dataset.last_timestamp - cutoff) / 86400)) : null
  const disabledCopy = item.archived || item.dataset_available !== true
  return <article className={`fx-dashboard-session-card${expanded ? ' is-expanded' : ''}`} data-session-id={item.record_id}>
    <div className="fx-dashboard-session-card-head">
      {preview ? <button type="button" className="fx-dashboard-card-play" disabled aria-label={`Tiếp tục ${name}`} title="Chart cần phiên thật"><SessionIcon kind="play" /></button> : canResumeSession(item) ? <a className="fx-dashboard-card-play" href={href('replay', { select: null, surface: 'workspace' })} onClick={onRemember} aria-label={`Tiếp tục ${name}`}><SessionIcon kind="play" /></a> : <span className="fx-dashboard-card-play is-unavailable" title="Phiên hoặc dataset chưa sẵn sàng"><SessionIcon kind="play" /></span>}
      <div className="fx-dashboard-card-info"><h3>{name}<span>{item.timeframe || '—'}</span>{item.archived && <small>Đã lưu trữ</small>}</h3><div className="fx-dashboard-card-facts"><span title="Phạm vi dataset · UTC"><SessionIcon kind="calendar" />{date(dataset?.first_timestamp)} – {date(dataset?.last_timestamp)}</span><span title="Số dư từ lệnh đóng"><SessionIcon kind="balance" />{dashboardMoney(model?.endingBalance, model?.result?.account_currency)}</span></div><span className="fx-dashboard-card-asset">{item.instrument_id || '—'}</span></div>
      <div className="fx-dashboard-card-progress">{knownProgress && <progress aria-label={`Tiến độ ${name}`} value={Math.min(item.row_count, item.cursor_index + 1)} max={item.row_count} />}<small>{days !== null ? `Còn ${days.toLocaleString('vi-VN')} ngày dữ liệu` : remaining !== null ? `Còn ${remaining.toLocaleString('vi-VN')} nến` : '—'}</small></div>
      <div className="fx-dashboard-card-actions">
        <button type="button" className="fx-dashboard-card-icon is-danger" aria-label={`${item.archived ? 'Khôi phục' : 'Lưu trữ'} ${name}`} title={item.archived ? 'Khôi phục phiên' : 'Lưu trữ phiên'} onClick={() => onManage('archive', item)}><SessionIcon kind="archive" /></button>
        <button type="button" className="fx-dashboard-card-icon" aria-label={`Sửa ${name}`} title="Sửa tên và mô tả" onClick={() => onManage('rename', item)}><SessionIcon kind="edit" /></button>
        <a className="fx-dashboard-card-icon" aria-label={`Analytics ${name}`} title="Analytics" href={href('analytics')}><SessionIcon kind="analytics" /></a>
        <button type="button" className="fx-dashboard-card-icon" aria-label={`Tạo bản sao ${name}`} title="Tạo bản sao" disabled={disabledCopy} onClick={() => onManage('duplicate', item)}><SessionIcon kind="duplicate" /></button>
        <button type="button" className="fx-dashboard-card-summary" aria-label={`Summary ${name}`} onClick={() => onManage('summary', item)}><SessionIcon kind="summary" />Summary</button>
        <button type="button" className="fx-dashboard-card-icon fx-dashboard-card-expand" aria-label={`${expanded ? 'Thu gọn' : 'Mở rộng'} ${name}`} aria-expanded={expanded} aria-controls={panelId} onClick={() => setExpanded(!expanded)}><SessionIcon /></button>
      </div>
    </div>
    {expanded && <div className="fx-dashboard-card-charts" id={panelId}>{detail?.status === 'loading' || !detail ? <p role="status">Đang tải kết quả phiên…</p> : detail.status === 'error' ? <p role="alert">Chưa đọc được kết quả phiên.</p> : <SessionPerformance chartsOnly model={model} payload={payload} item={item} href={href} />}</div>}
  </article>
}

export function DashboardSessionDialog({ mode, item, detail, onClose, onSubmit, pending, blocked, error, preview, href }) {
  const dialog = useRef(null), opener = useRef(document.activeElement)
  const [draft, setDraft] = useState({ name: item.name || '', description: item.description || '' })
  const name = item.name || item.record_id
  const title = mode === 'summary' ? `Summary · ${name}` : mode === 'rename' ? 'Sửa phiên' : mode === 'duplicate' ? 'Tạo bản sao phiên' : item.archived ? 'Khôi phục phiên' : 'Lưu trữ phiên'
  useEffect(() => { dialog.current.showModal(); return () => { dialog.current?.close(); if (opener.current?.isConnected) opener.current.focus({ preventScroll: true }) } }, [])
  return <dialog className="fx-dashboard-dialog" ref={dialog} aria-label={title} onCancel={event => { event.preventDefault(); if (!pending) onClose() }} onKeyDown={event => {
    if (event.key !== 'Tab') return
    const controls = [...event.currentTarget.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(element => !element.disabled && element.tabIndex >= 0 && element.getClientRects().length)
    const first = controls[0], last = controls[controls.length - 1]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  }} onClick={event => { if (event.target === event.currentTarget && !pending) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose() } }}>
    <header><h2>{title}</h2><button type="button" aria-label="Đóng hộp thoại phiên" disabled={pending} onClick={onClose}>×</button></header>
    {preview && mode !== 'summary' && <small className="fx-dashboard-dialog-preview">Bản xem thử · thay đổi chỉ ở chế độ demo</small>}
    {error && <p role="alert">{error}</p>}
    {mode === 'summary' ? detail?.status === 'loading' || !detail ? <p role="status">Đang tải kết quả phiên…</p> : detail.status === 'error' ? <p role="alert">Chưa đọc được kết quả phiên.</p> : <SessionPerformance model={detail.model} payload={detail.payload} item={item} href={href} /> : <form onSubmit={event => { event.preventDefault(); onSubmit(mode, item, draft) }}>
      {mode === 'rename' ? <><label>Tên phiên<input autoFocus required maxLength={160} value={draft.name} disabled={pending} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label><label>Mô tả<textarea rows={4} maxLength={2000} value={draft.description} disabled={pending} onChange={event => setDraft({ ...draft, description: event.target.value })} /></label></> : <p>{mode === 'duplicate' ? `Tạo bản sao “${name}” ở vị trí replay hiện tại.` : item.archived ? `Khôi phục “${name}” vào danh sách phiên đang hoạt động.` : `Chuyển “${name}” sang Đã lưu trữ. Dữ liệu và lịch sử vẫn được giữ.`}</p>}
      <footer><button className="fxr-button fxr-button-secondary" type="button" disabled={pending} onClick={onClose}>Hủy</button><button className="fxr-button fxr-button-primary" type="submit" disabled={pending || blocked || mode === 'rename' && !draft.name.trim()}>{pending ? 'Đang lưu…' : mode === 'rename' ? 'Lưu thay đổi' : mode === 'duplicate' ? 'Tạo bản sao' : item.archived ? 'Khôi phục' : 'Lưu trữ'}</button></footer>
    </form>}
  </dialog>
}
