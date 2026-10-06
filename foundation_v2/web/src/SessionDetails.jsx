import { useTestingLocale } from './testingLocale.jsx'
import { useEffect, useState } from 'react'
import { FilterIcon } from './FxSelect.jsx'

import { sessionDate as formatSessionDate, sessionRemainingDays, sessionSettingsFacts } from './sessionSettingsModel.js'
import './session-performance.css'

export function SessionChartLink({ href, preview = false }) {
  const { t } = useTestingLocale()

  const content = <>{t("Go to chart")}<svg viewBox="0 0 20 20" aria-hidden="true"><path fill="currentColor" d="m6 3 10 7-10 7Z" /></svg></>
  return preview ? <button className="fxr-button fxr-button-primary fxs-go-chart" disabled title={t("Chart cần phiên thật")}>{content}</button> : <a className="fxr-button fxr-button-primary fxs-go-chart" href={href}>{content}</a>
}

export function SessionSummaryCard({ item, dataset, payload, model, replayRecord, chartHref, preview = false }) {
  const dashboardMoney = (value, currency) => fmt(value, ` ${currency || t('Đơn vị tài khoản')}`)
  const sessionDate = (value, time = false) => formatSessionDate(value, time, locale)

  const { t, locale, fmt } = useTestingLocale()

  const facts = sessionSettingsFacts(item, dataset, payload, model, replayRecord)
  const days = sessionRemainingDays(dataset, payload, replayRecord)
  const remaining = Number.isInteger(item.row_count) && Number.isInteger(item.cursor_index) ? Math.max(0, item.row_count - item.cursor_index - 1) : null
  return <article className="fxr-session-card fxr-session-summary-card">
    <div className="fxs-summary-heading"><h2>{item.name || item.record_id}</h2><div className="fxs-balance"><span>{t("Account balance")}</span><strong>{dashboardMoney(facts.balance, facts.currency)}</strong></div></div>
    <p>{facts.strategy === 'Chưa gắn strategy' ? t(facts.strategy) : facts.strategy} · {facts.asset}</p>
    <p className="fxs-session-range">{sessionDate(facts.first)} – {sessionDate(facts.last)} <span className="fxs-remaining">{days !== null ? t("{count} ngày còn lại", { count: days.toLocaleString(locale) }) : remaining !== null ? t("{count} nến còn lại", { count: remaining.toLocaleString(locale) }) : t("Chưa rõ thời gian còn lại")}</span></p>
    <div className="fxr-session-links">{(preview || !item.archived && item.dataset_available === true) && <SessionChartLink href={chartHref} preview={preview} />}</div>
    {!preview && item.dataset_available !== true && <p>{item.dataset_available === false ? t("Dataset không khả dụng.") : t("Chưa rõ dataset.")}</p>}
  </article>
}

export function SessionDescriptionCard({ item, onSave, pending = false, disabled = false, error, children }) {
  const { t } = useTestingLocale()

  const [editing, setEditing] = useState(false), [description, setDescription] = useState(item.description || '')
  useEffect(() => { setEditing(false); setDescription(item.description || '') }, [item.record_id])
  useEffect(() => { if (!editing) setDescription(item.description || '') }, [item.description, editing])
  const save = async event => { event.preventDefault(); if (await onSave(description) !== false) setEditing(false) }
  return <article className="fxr-session-card fxr-description-card">
    <div className="fxs-description-heading"><h2>{t("Description")}</h2><button className="fxs-edit-description" aria-label={editing ? t("Hủy sửa mô tả") : t("Sửa mô tả")} type="button" disabled={disabled || pending} onClick={() => { setDescription(item.description || ''); setEditing(!editing) }}><FilterIcon kind="edit" /></button></div>
    {editing ? <form className="fxr-session-edit" onSubmit={save}><textarea autoFocus aria-label={t("Mô tả phiên")} placeholder={t("Add a description…")} value={description} maxLength={2000} rows={4} onChange={event => setDescription(event.target.value)} disabled={pending} /><button type="submit" className="fxr-button fxr-button-secondary fxs-save-description" disabled={disabled || pending || description === (item.description || '')}><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden="true"><path d="M3 2h12l3 3v13H2V2ZM6 2v5h8V2M5 18v-7h10v7" /></svg>{pending ? t("Đang lưu…") : t("Save")}</button>{error && <p role="alert">{error}</p>}</form> : item.description && <p className="fxr-session-description">{item.description}</p>}
    {children}
  </article>
}
