import React, { useId, useState } from 'react'
import { SessionActions } from './SessionActions.jsx'
import SessionPerformance from './SessionPerformance.jsx'
import { canResumeSession } from './sessionCatalog.js'
import { dashboardMoney } from './dashboardModel.js'
import { sessionRemainingDays } from './sessionSettingsModel.js'
import './dashboard-session.css'

const date = value => Number.isFinite(Number(value)) && value != null ? new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeZone: 'UTC' }).format(new Date(Number(value) * 1000)) : '—'

function SessionIcon({ kind }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{kind === 'archive' ? <><rect x="3" y="4" width="18" height="4" rx="1" /><path d="M5 8v12h14V8M9 12h6" /></> : kind === 'edit' ? <path d="m16 3 5 5-12 12H4v-5ZM13 6l5 5" /> : kind === 'analytics' ? <path d="M5 20V11m7 9V4m7 16V8" /> : kind === 'duplicate' ? <><rect x="8" y="8" width="12" height="13" rx="1" /><path d="M16 8V3H4v13h4" /></> : kind === 'summary' ? <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></> : kind === 'calendar' ? <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4m8-4v4M4 10h16" /></> : kind === 'balance' ? <><rect x="3" y="6" width="18" height="12" rx="2" /><circle cx="12" cy="12" r="3" /></> : kind === 'play' ? <path d="m9 6 9 6-9 6Z" fill="currentColor" stroke="none" /> : <path d="m5 9 7 7 7-7" />}</svg>
}

export default function DashboardSessionCard({ item, detail, dataset, href, onManage, onRemember, preview = false, actionsDisabled = false }) {
  const [expanded, setExpanded] = useState(false)
  const panelId = useId()
  const model = detail?.model, payload = detail?.payload || {}
  const name = item.name || item.record_id
  const knownProgress = Number.isInteger(item.row_count) && item.row_count > 0 && Number.isInteger(item.cursor_index)
  const remaining = knownProgress ? Math.max(0, item.row_count - item.cursor_index - 1) : null
  const days = sessionRemainingDays(dataset, null, detail?.replayRecord)
  const disabledCopy = item.archived || item.dataset_available !== true
  return <article className={`fx-dashboard-session-card${expanded ? ' is-expanded' : ''}`} data-session-id={item.record_id}>
    <div className="fx-dashboard-session-card-head">
      {preview ? <button type="button" className="fx-dashboard-card-play" disabled aria-label={`Tiếp tục ${name}`} title="Chart cần phiên thật"><SessionIcon kind="play" /></button> : canResumeSession(item) ? <a className="fx-dashboard-card-play" href={href('replay', { select: null, surface: 'workspace' })} onClick={onRemember} aria-label={`Tiếp tục ${name}`}><SessionIcon kind="play" /></a> : <span className="fx-dashboard-card-play is-unavailable" title="Phiên hoặc dataset chưa sẵn sàng"><SessionIcon kind="play" /></span>}
      <div className="fx-dashboard-card-info"><h3>{name}{days !== null && <span className="fx-dashboard-days" title="Số ngày lịch còn lại từ vị trí replay đến cuối dataset"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden="true"><path d="m11 2-7 9h5l-1 7 8-10h-5Z" /></svg>{days.toLocaleString('vi-VN')} days</span>}{item.archived && <small>Đã lưu trữ</small>}</h3><div className="fx-dashboard-card-facts"><span title="Phạm vi dataset · UTC"><SessionIcon kind="calendar" />{date(dataset?.first_timestamp)} – {date(dataset?.last_timestamp)}</span><span title="Số dư từ lệnh đóng"><SessionIcon kind="balance" />{dashboardMoney(model?.endingBalance, model?.result?.account_currency)}</span></div><span className="fx-dashboard-card-asset">{item.instrument_id || '—'}</span></div>
      <div className="fx-dashboard-card-progress">{knownProgress && <progress aria-label={`Tiến độ ${name}`} value={Math.min(item.row_count, item.cursor_index + 1)} max={item.row_count} />}<small>{days !== null ? `Remaining ${days.toLocaleString('vi-VN')} days` : remaining !== null ? `Còn ${remaining.toLocaleString('vi-VN')} nến` : '—'}</small></div>
      <div className="fx-dashboard-card-actions">
        <SessionActions item={item} onAction={onManage} disabled={actionsDisabled} />
        <button type="button" className="fx-dashboard-card-icon" aria-label={`Sửa ${name}`} title="Sửa tên và mô tả" disabled={actionsDisabled} onClick={() => onManage('rename', item)}><SessionIcon kind="edit" /></button>
        <a className="fx-dashboard-card-icon" aria-label={`Analytics ${name}`} title="Analytics" href={href('analytics')}><SessionIcon kind="analytics" /></a>
        <button type="button" className="fx-dashboard-card-icon" aria-label={`Tạo bản sao ${name}`} title="Tạo bản sao" disabled={disabledCopy || actionsDisabled} onClick={() => onManage('duplicate', item)}><SessionIcon kind="duplicate" /></button>
        <a className="fx-dashboard-card-summary" aria-label={`Summary ${name}`} href={href('replay')} onClick={preview ? undefined : onRemember}><SessionIcon kind="summary" />Summary</a>
        <button type="button" className="fx-dashboard-card-icon fx-dashboard-card-expand" aria-label={`${expanded ? 'Thu gọn' : 'Mở rộng'} ${name}`} aria-expanded={expanded} aria-controls={panelId} onClick={() => setExpanded(!expanded)}><SessionIcon /></button>
      </div>
    </div>
    {expanded && <div className="fx-dashboard-card-charts" id={panelId}>{detail?.status === 'loading' || !detail ? <p role="status">Đang tải kết quả phiên…</p> : detail.status === 'error' ? <p role="alert">Chưa đọc được kết quả phiên.</p> : <SessionPerformance chartsOnly model={model} payload={payload} item={item} href={href} />}</div>}
  </article>
}
