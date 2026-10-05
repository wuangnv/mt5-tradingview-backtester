import React, { useEffect, useId, useRef, useState } from 'react'
import { dashboardMoney, readDashboardReplayContext } from './dashboardModel.js'
import { sessionDate, sessionSettingsFacts } from './sessionSettingsModel.js'
import './session-settings.css'

const tabs = [{ key: 'info', name: 'Session Info' }, { key: 'balance', name: 'Balance & Assets' }, { key: 'costs', name: 'Costs' }, { key: 'range', name: 'Date Range' }]
function ReadField({ label, value }) { return <label>{label}<input value={value ?? '—'} readOnly /></label> }

export default function SessionSettingsDrawer({ item, dataset, payload, model, workspace, replayRecord, onClose, onSubmit, pending = false, blocked = false, error, preview = false }) {
  const dialog = useRef(null), opener = useRef(document.activeElement), id = useId()
  const [tab, setTab] = useState('info'), [draft, setDraft] = useState({ name: item.name || '', description: item.description || '' })
  const [recordState, setRecord] = useState({ status: 'idle', record: replayRecord || null })
  const facts = sessionSettingsFacts(item, dataset, payload, model, replayRecord || recordState.record)
  const dirty = draft.name !== (item.name || '') || draft.description !== (item.description || '')
  useEffect(() => {
    const element = dialog.current
    element.showModal()
    return () => { element.close(); if (opener.current?.isConnected) opener.current.focus({ preventScroll: true }) }
  }, [])
  useEffect(() => {
    if (tab !== 'costs' || replayRecord || preview || !workspace) return
    const controller = new AbortController()
    setRecord({ status: 'loading', record: null })
    readDashboardReplayContext(workspace, item, controller.signal).then(record => {
      if (!controller.signal.aborted) setRecord({ status: 'ready', record })
    }).catch(problem => { if (!controller.signal.aborted) setRecord({ status: 'error', record: null, error: problem.message }) })
    return () => controller.abort()
  }, [tab, item.record_id, item.revision, workspace, replayRecord, preview])
  const close = () => { if (!pending) onClose() }
  return <dialog className="fxs-settings-drawer" ref={dialog} aria-label="Session Settings" onCancel={event => { event.preventDefault(); close() }} onClick={event => {
    if (event.target !== event.currentTarget) return
    const bounds = event.currentTarget.getBoundingClientRect()
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close()
  }} onKeyDown={event => {
    if (event.key !== 'Tab') return
    const elements = [...event.currentTarget.querySelectorAll('button, input, textarea, [href], [tabindex]')].filter(element => !element.disabled && element.tabIndex >= 0 && element.getClientRects().length)
    const first = elements[0], last = elements[elements.length - 1]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  }}>
    <button className="fxs-drawer-close" aria-label="Đóng cài đặt phiên" type="button" disabled={pending} onClick={close}>×</button>
    <header><h2>Session Settings</h2><p>{item.name || item.record_id} · {item.record_id}</p></header>
    <div className="fxs-settings-tabs" role="tablist" aria-label="Cài đặt phiên">{tabs.map((entry, index) => <button type="button" key={entry.key} role="tab" id={`${id}-${entry.key}`} aria-selected={tab === entry.key} aria-controls={`${id}-panel`} tabIndex={tab === entry.key ? 0 : -1} onClick={() => setTab(entry.key)} onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
      setTab(tabs[next].key); document.getElementById(`${id}-${tabs[next].key}`)?.focus()
    }}>{entry.name}</button>)}</div>
    <section className="fxs-settings-panel" id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${tab}`}>
      {tab === 'info' ? <form onSubmit={event => { event.preventDefault(); if (dirty && draft.name.trim()) onSubmit(draft) }}>
        <label>Name<input autoFocus required maxLength={160} value={draft.name} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} disabled={pending} /></label>
        <ReadField label="Strategy" value={facts.strategy} />
        <ReadField label="Chart Layout" value="Chưa gắn chart layout" />
        <label>Description<textarea rows={4} maxLength={2000} placeholder="Add notes to your session" value={draft.description} onChange={event => setDraft(current => ({ ...current, description: event.target.value }))} disabled={pending} /></label>
        {preview && <small>Bản xem thử · thay đổi chỉ ở chế độ demo</small>}
        {error && <p role="alert">{error}</p>}
        <button className="fxs-settings-save" type="submit" disabled={pending || blocked || !dirty || !draft.name.trim()}>{pending ? 'Đang lưu…' : 'Save Changes'}</button>
      </form> : tab === 'balance' ? <div className="fxs-settings-fields"><ReadField label="Account Balance" value={dashboardMoney(facts.balance, facts.currency)} /><label>Select Assets<div className="fxs-settings-asset">{facts.asset}</div></label><p className="fxs-settings-note">Balance và assets được giữ theo phiên hiện tại. Tạo phiên mới để đổi cấu hình.</p></div> : tab === 'costs' ? <div className="fxs-settings-fields">
        {recordState.status === 'loading' && <p role="status">Đang đọc cấu hình chi phí…</p>}
        {recordState.status === 'error' && <p role="alert">{recordState.error}</p>}
        {facts.costs ? <><ReadField label="Spread · price" value={facts.costs.spread_basis === 'bid_ask_embedded' ? 'Đã nằm trong Bid/Ask lịch sử' : facts.spread} /><ReadField label="Commission / side" value={`${facts.costs.commission_per_side_account ?? '—'} ${facts.currency || ''}`} /><ReadField label="Minimum fee" value={`${facts.costs.minimum_fee_account ?? '—'} ${facts.currency || ''}`} /><ReadField label="Slippage / side · price" value={facts.costs.slippage_price_per_side} /><ReadField label="Cost model" value={facts.costs.version} /></> : recordState.status !== 'loading' && <p>Chưa có cấu hình chi phí đã lưu cho phiên này.</p>}
        <p className="fxs-settings-note">Chi phí của phiên đã lưu chỉ đọc; không tính lại các giao dịch đã chạy.</p>
      </div> : <div className="fxs-settings-fields"><ReadField label="Dataset start · UTC" value={sessionDate(facts.first, true)} /><ReadField label="Dataset end · UTC" value={sessionDate(facts.last, true)} /><ReadField label="Replay position · UTC" value={sessionDate((replayRecord || recordState.record)?.cutoff_timestamp ?? payload?.provenance?.cutoff_timestamp, true)} /><ReadField label="Auto-update end date" value="Phạm vi dataset cố định" /><ReadField label="Smooth candles" value="Không áp dụng · replay theo dữ liệu nguồn" /><p className="fxs-settings-note">Phạm vi được giữ theo dataset của phiên. Cập nhật Market Data không thay đổi phiên đã lưu.</p></div>}
    </section>
  </dialog>
}
