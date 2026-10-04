import React, { useEffect, useMemo, useState } from 'react'
import AnalyticsWorkspace from './AnalyticsWorkspace.jsx'
import { AnalyticsSources, fmt, Metric, SelectField } from './FxAnalytics.jsx'
import { propReplayQuery } from './propAnalyticsModel.js'
import { buildWorkspaceHref } from './workspaceContext.js'
import useReadRefresh from './useReadRefresh.js'

const reportKey = report => `${report.session.session_id}:${report.attempt.attempt_id}`
export default function PropAnalytics({ workspace, query }) {
  const [state, setState] = useState({ status: 'loading', items: [], error: '' }), [reload, setReload] = useState(0)
  const [selected, setSelected] = useState(query.get('prop_session') && query.get('attempt') ? `${query.get('prop_session')}:${query.get('attempt')}` : null)
  useReadRefresh(() => setReload(value => value + 1))
  useEffect(() => {
    const controller = new AbortController()
    setState(current => current.status === 'ready' ? { ...current, refreshing: true } : { status: 'loading', items: [], error: '' })
    fetch('/api/v2/prop/reports', { headers: { 'X-Workspace-Id': workspace }, signal: controller.signal }).then(async response => { const value = await response.json(); if (!response.ok) throw new Error(value.detail || `HTTP ${response.status}`); if (value.schema_version !== 'prop-report-list-v1' || value.broker_execution_capability !== false || !Array.isArray(value.items) || value.items.some(item => !item.session?.session_id || !item.attempt?.attempt_id || item.schema_version !== 'prop-attempt-report-v1')) throw new Error('prop_report_invalid'); return value.items }).then(items => { if (!controller.signal.aborted) setState(current => ({ status: 'ready', items: items.map(item => current.items.find(previous => reportKey(previous) === reportKey(item) && JSON.stringify(previous) === JSON.stringify(item)) || item), error: '' })) }).catch(error => { if (!controller.signal.aborted) setState({ status: 'error', items: [], error: error.message }) })
    return () => controller.abort()
  }, [workspace, reload])
  const report = selected === null ? state.items[0] : state.items.find(item => reportKey(item) === selected)
  const boundQuery = useMemo(() => propReplayQuery(report, new URLSearchParams(window.location.search)), [report, query])
  const choose = value => { setSelected(value); const report = state.items.find(item => reportKey(item) === value); const url = new URL(window.location.href); if (report) { url.searchParams.set('prop_session', report.session.session_id); url.searchParams.set('attempt', report.attempt.attempt_id) } else { url.searchParams.delete('prop_session'); url.searchParams.delete('attempt') } url.searchParams.delete('trade'); window.history.replaceState({}, '', url) }
  const money = report?.objectives?.money, calendar = report?.objectives?.calendar
  return <section className="wm-page fxa-prop-page" aria-label="Prop firm Analytics" data-testid="prop-analytics"><h1 className="sr-only">Analytics</h1><AnalyticsSources workspace={workspace} query={query} active="prop" />
    {state.status === 'loading' && <p role="status">Đang đọc báo cáo challenge…</p>}{state.status === 'error' && <p role="alert">Không đọc được báo cáo: {state.error}. Sẽ kiểm tra lại khi quay về ứng dụng.</p>}
    {state.status === 'ready' && <div className="fxa-prop-selector"><SelectField label="Prop firm attempt" value={report ? reportKey(report) : ''} onChange={choose} options={[["", 'Chọn challenge'], ...state.items.map(item => [reportKey(item), `${item.profile.profile_id} · attempt ${item.attempt.attempt_id.slice(0, 8)} · ${item.outcome.status}`])]} /><a className="fxa-button" href={buildWorkspaceHref('testing', workspace, query)}>Quản lý challenge ↗</a></div>}
    {state.status === 'ready' && !report && <p className="fxa-empty">{state.items.length ? 'Không tìm thấy attempt này. Chọn challenge khác.' : 'Chưa có báo cáo Prop firm. Tạo challenge mô phỏng và gắn replay để có phân tích giao dịch.'}</p>}
    {report && <>
      <section className="fxa-prop-objectives" aria-label="Challenge objectives" data-testid="prop-analytics-objectives"><div className="fxa-section-heading"><h2>Challenge objectives</h2><span>{report.outcome.status} · Phase {report.phase.phase_index}</span></div><div className="fxa-metrics"><Metric label="Balance snapshot" value={fmt(report.phase.balance, ` ${report.phase.currency || 'đơn vị challenge'}`)} /><Metric label="Equity snapshot" value={fmt(report.phase.equity, ` ${report.phase.currency || 'đơn vị challenge'}`)} note={`Floating P/L ${fmt(report.phase.floating_pl, ` ${report.phase.currency || 'đơn vị challenge'}`)}`} /><Metric label="Trading days" value={fmt(report.phase.qualifying_days, '', 0)} /><Metric label="Report time (UTC)" value={report.phase.virtual_time_utc || '—'} /></div>
        {money ? <table><thead><tr><th>Objective</th><th>Kết quả / ngưỡng</th><th>Trạng thái</th></tr></thead><tbody>{[['Profit target', money.profit_target, 'target'], ['Daily loss', money.daily_loss, 'floor'], ['Overall drawdown', money.overall_drawdown, 'floor']].map(([label, value, threshold]) => <tr key={label}><td>{label}</td><td>{fmt(value?.current, ` ${report.phase.currency || 'đơn vị challenge'}`)} / {fmt(value?.[threshold], ` ${report.phase.currency || 'đơn vị challenge'}`)}</td><td>{value ? threshold === 'target' ? value.hit ? 'Đạt' : 'Đang thực hiện' : value.breached ? 'Vi phạm' : 'Trong giới hạn' : 'Chưa đủ dữ liệu'}</td></tr>)}<tr><td>Ngày đủ điều kiện</td><td>{fmt(calendar?.qualifying_days)}</td><td>{calendar?.expired ? 'Hết hạn' : calendar?.min_qualifying_days_satisfied === true ? 'Đạt' : calendar ? 'Đang thực hiện' : 'Chưa đủ dữ liệu'}</td></tr></tbody></table> : <p className="fxa-empty">Chưa có snapshot evaluator đủ dữ liệu để đánh giá objectives.</p>}
        <small>Profile {report.profile.profile_id} · terms {report.profile.terms_version} · {report.phase.evaluation_quality}. Đây là số dư/equity tại snapshot, không phải đường equity lịch sử.</small>
      </section>
      {boundQuery ? <AnalyticsWorkspace key={`${workspace}:${reportKey(report)}:${report.attempt.revision}:${report.phase.last_event_sequence}`} workspace={workspace} query={boundQuery} sessionName={report.profile.profile_id} propReport={report} embedded /> : <p className="fxa-empty">Attempt chưa có replay binding và cutoff hợp lệ. Objectives vẫn đọc được; gắn replay trong phần quản lý challenge để phân tích giao dịch và mô phỏng.</p>}
    </>}
  </section>
}
