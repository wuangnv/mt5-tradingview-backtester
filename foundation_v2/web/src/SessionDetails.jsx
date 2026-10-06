import React, { useEffect, useState } from 'react'
import { FilterIcon } from './FxSelect.jsx'
import { dashboardMoney } from './dashboardModel.js'
import { sessionDate, sessionRemainingDays, sessionSettingsFacts } from './sessionSettingsModel.js'
import './session-performance.css'

export function SessionChartLink({ href, preview = false }) {
  const content = <>Go to chart<svg viewBox="0 0 20 20" aria-hidden="true"><path fill="currentColor" d="m6 3 10 7-10 7Z" /></svg></>
  return preview ? <button className="fxr-button fxr-button-primary fxs-go-chart" disabled title="Chart cần phiên thật">{content}</button> : <a className="fxr-button fxr-button-primary fxs-go-chart" href={href}>{content}</a>
}

export function SessionSummaryCard({ item, dataset, payload, model, replayRecord, chartHref, preview = false }) {
  const facts = sessionSettingsFacts(item, dataset, payload, model, replayRecord)
  const days = sessionRemainingDays(dataset, payload, replayRecord)
  const remaining = Number.isInteger(item.row_count) && Number.isInteger(item.cursor_index) ? Math.max(0, item.row_count - item.cursor_index - 1) : null
  return <article className="fxr-session-card fxr-session-summary-card">
    <div className="fxs-summary-heading"><h2>{item.name || item.record_id}</h2><div className="fxs-balance"><span>Account balance</span><strong>{dashboardMoney(facts.balance, facts.currency)}</strong></div></div>
    <p>{facts.strategy} · {facts.asset}</p>
    <p className="fxs-session-range">{sessionDate(facts.first)} – {sessionDate(facts.last)} <span className="fxs-remaining">{days !== null ? `${days.toLocaleString('vi-VN')} ngày còn lại` : remaining !== null ? `${remaining.toLocaleString('vi-VN')} nến còn lại` : 'Chưa rõ thời gian còn lại'}</span></p>
    <div className="fxr-session-links">{(preview || !item.archived && item.dataset_available === true) && <SessionChartLink href={chartHref} preview={preview} />}</div>
    {!preview && item.dataset_available !== true && <p>{item.dataset_available === false ? 'Dataset không khả dụng.' : 'Chưa rõ dataset.'}</p>}
  </article>
}

export function SessionDescriptionCard({ item, onSave, pending = false, disabled = false, error, children }) {
  const [editing, setEditing] = useState(false), [description, setDescription] = useState(item.description || '')
  useEffect(() => { setEditing(false); setDescription(item.description || '') }, [item.record_id])
  useEffect(() => { if (!editing) setDescription(item.description || '') }, [item.description, editing])
  const save = async event => { event.preventDefault(); if (await onSave(description) !== false) setEditing(false) }
  return <article className="fxr-session-card fxr-description-card">
    <div className="fxs-description-heading"><h2>Description</h2><button className="fxs-edit-description" aria-label={editing ? 'Hủy sửa mô tả' : 'Sửa mô tả'} type="button" disabled={disabled || pending} onClick={() => { setDescription(item.description || ''); setEditing(!editing) }}><FilterIcon kind="edit" /></button></div>
    {editing ? <form className="fxr-session-edit" onSubmit={save}><textarea autoFocus aria-label="Mô tả phiên" placeholder="Add a description…" value={description} maxLength={2000} rows={4} onChange={event => setDescription(event.target.value)} disabled={pending} /><button type="submit" className="fxr-button fxr-button-secondary fxs-save-description" disabled={disabled || pending || description === (item.description || '')}><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden="true"><path d="M3 2h12l3 3v13H2V2ZM6 2v5h8V2M5 18v-7h10v7" /></svg>{pending ? 'Đang lưu…' : 'Save'}</button>{error && <p role="alert">{error}</p>}</form> : item.description && <p className="fxr-session-description">{item.description}</p>}
    {children}
  </article>
}
