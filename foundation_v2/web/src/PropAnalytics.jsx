import TestingReadState, { TestingSkeleton } from './TestingReadState.jsx'
import { useTestingLocale } from './testingLocale.jsx'
import { useEffect, useMemo, useState } from 'react'
import AnalyticsWorkspace from './AnalyticsWorkspace.jsx'
import { Metric, SelectField } from './FxAnalytics.jsx'
import { propReplayQuery } from './propAnalyticsModel.js'
import { buildWorkspaceHref } from './workspaceContext.js'
import useReadRefresh from './useReadRefresh.js'

const reportKey = report => `${report.session.session_id}:${report.attempt.attempt_id}`
export default function PropAnalytics({ workspace, query, embedded = false }) {


  const { t, fmt, statusLabel } = useTestingLocale()

  const [state, setState] = useState({ status: 'loading', items: [], error: '' }), [reload, setReload] = useState(0)
  const [selected, setSelected] = useState(query.get('prop_session') && query.get('attempt') ? `${query.get('prop_session')}:${query.get('attempt')}` : null)
  useReadRefresh(() => setReload(value => value + 1))
  useEffect(() => {
    const controller = new AbortController()
    setState(current => current.status === 'ready' ? { ...current, refreshing: true } : { status: 'loading', items: [], error: '' })
    fetch('/api/v2/prop/reports', { headers: { 'X-Workspace-Id': workspace }, signal: controller.signal }).then(async response => { const value = await response.json(); if (!response.ok) throw new Error(value.detail || `HTTP ${response.status}`); if (value.schema_version !== 'prop-report-list-v1' || value.broker_execution_capability !== false || !Array.isArray(value.items) || value.items.some(item => !item.session?.session_id || !item.attempt?.attempt_id || item.schema_version !== 'prop-attempt-report-v1')) throw new Error('prop_report_invalid'); return value.items }).then(items => { if (!controller.signal.aborted) setState(current => ({ status: 'ready', items: items.map(item => current.items.find(previous => reportKey(previous) === reportKey(item) && JSON.stringify(previous) === JSON.stringify(item)) || item), error: '' })) }).catch(error => { if (!controller.signal.aborted) setState(current => ({ ...current, status: current.items.length ? 'stale' : 'error', refreshing: false, error: error.message })) })
    return () => controller.abort()
  }, [workspace, reload])
  const report = selected === null ? state.items[0] : state.items.find(item => reportKey(item) === selected)
  const boundQuery = useMemo(() => propReplayQuery(report, new URLSearchParams(window.location.search)), [report, query])
  const choose = value => { setSelected(value); const report = state.items.find(item => reportKey(item) === value); const url = new URL(window.location.href); if (report) { url.searchParams.set('prop_session', report.session.session_id); url.searchParams.set('attempt', report.attempt.attempt_id) } else { url.searchParams.delete('prop_session'); url.searchParams.delete('attempt') } url.searchParams.delete('trade'); window.history.replaceState({}, '', url) }
  const money = report?.objectives?.money, calendar = report?.objectives?.calendar
  return <section className={`${embedded ? 'fx-dashboard-prop' : 'wm-page'} fxa-prop-page`} aria-label={t("Prop firm Analytics")} data-testid="prop-analytics">{!embedded && <h1 className="sr-only">{t("Analytics")}</h1>}
    {state.status === 'loading' && <TestingSkeleton label="Đang đọc báo cáo challenge…" />}{['error', 'stale'].includes(state.status) && <TestingReadState error={state.status === 'error'} message={t('Không đọc được báo cáo:') + ' ' + t(state.error)} onRetry={() => setReload(value => value + 1)} />}
    {state.status === 'ready' && <div className="fxa-prop-selector"><SelectField label={t("Prop firm attempt")} value={report ? reportKey(report) : ''} onChange={choose} options={[["", 'Chọn challenge'], ...state.items.map(item => [reportKey(item), `${item.profile.profile_id} · attempt ${item.attempt.attempt_id.slice(0, 8)} · ${statusLabel('prop_attempt', item.outcome.status)}`])]} /><a className="fxa-button" href={buildWorkspaceHref('testing', workspace, query)}>{t("Quản lý challenge")}</a></div>}
    {state.status === 'ready' && !report && <p className="fxa-empty">{state.items.length ? t("Không tìm thấy attempt này. Chọn challenge khác.") : t("Chưa có báo cáo Prop firm. Tạo challenge mô phỏng và gắn replay để có phân tích giao dịch.")}</p>}
    {report && <>
      <section className="fxa-prop-objectives" aria-label={t("Challenge objectives")} data-testid="prop-analytics-objectives"><div className="fxa-section-heading"><h2>{t("Challenge objectives")}</h2><span>{statusLabel('prop_attempt', report.outcome.status)} {t("· Phase")} {report.phase.phase_index}</span></div><div className="fxa-metrics"><Metric label={t("Balance snapshot")} value={fmt(report.phase.balance, ` ${report.phase.currency || t('Đơn vị tài khoản')}`)} /><Metric label={t("Equity snapshot")} value={fmt(report.phase.equity, ` ${report.phase.currency || t('Đơn vị tài khoản')}`)} note={`Floating P/L ${fmt(report.phase.floating_pl, ` ${report.phase.currency || t('Đơn vị tài khoản')}`)}`} /><Metric label={t("Trading days")} value={fmt(report.phase.qualifying_days, '', 0)} /><Metric label={t("Report time (UTC)")} value={report.phase.virtual_time_utc || '—'} /></div>
        {money ? <table><thead><tr><th>{t("Objective")}</th><th>{t("Kết quả / ngưỡng")}</th><th>{t("Trạng thái")}</th></tr></thead><tbody>{[['Profit target', money.profit_target, 'target'], ['Daily loss', money.daily_loss, 'floor'], ['Overall drawdown', money.overall_drawdown, 'floor']].map(([label, value, threshold]) => <tr key={label}><td>{t(label)}</td><td>{fmt(value?.current, ` ${report.phase.currency || t('Đơn vị tài khoản')}`)} / {fmt(value?.[threshold], ` ${report.phase.currency || t('Đơn vị tài khoản')}`)}</td><td>{value ? threshold === 'target' ? value.hit ? t("Đạt") : t("Đang thực hiện") : value.breached ? t("Vi phạm") : t("Trong giới hạn") : t("Chưa đủ dữ liệu")}</td></tr>)}<tr><td>{t("Ngày đủ điều kiện")}</td><td>{fmt(calendar?.qualifying_days)}</td><td>{calendar?.expired ? t("Hết hạn") : calendar?.min_qualifying_days_satisfied === true ? t("Đạt") : calendar ? t("Đang thực hiện") : t("Chưa đủ dữ liệu")}</td></tr></tbody></table> : <p className="fxa-empty">{t("Chưa có snapshot evaluator đủ dữ liệu để đánh giá objectives.")}</p>}
        <small>{t("Profile")}{report.profile.profile_id} {t("· terms")} {report.profile.terms_version} · {statusLabel('data_quality', report.phase.evaluation_quality)}{t(". Đây là số dư/equity tại snapshot, không phải đường equity lịch sử.")}</small>
      </section>
      {boundQuery ? <AnalyticsWorkspace key={`${workspace}:${reportKey(report)}:${report.attempt.revision}:${report.phase.last_event_sequence}`} workspace={workspace} query={boundQuery} sessionName={report.profile.profile_id} propReport={report} embedded /> : <p className="fxa-empty">{t("Attempt chưa có replay binding và cutoff hợp lệ. Objectives vẫn đọc được; gắn replay trong phần quản lý challenge để phân tích giao dịch và mô phỏng.")}</p>}
    </>}
  </section>
}
