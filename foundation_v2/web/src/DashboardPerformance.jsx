import React, { useEffect, useState } from 'react'
import { dashboardNumber, dashboardFilterError, readDashboardOverview } from './dashboardModel.js'

function Metric({ title, value, detail, icon, tone }) {
  return <div className="fx-dashboard-metric"><span><span className="fx-dashboard-metric-icon" aria-hidden="true">{icon}</span>{title}</span><strong className={tone || ''}>{value}</strong><small>{detail}</small></div>
}

function MonthlyChart({ title, items, field, rate = false, accent = 'gold' }) {
  const valid = items.filter(item => item[field] !== null && Number.isFinite(item[field]))
  const max = rate ? 100 : Math.max(1, ...valid.map(item => item[field]))
  return <div className={`fx-dashboard-chart-panel is-${accent}`}><h3>{title}</h3>{valid.length ? <div className="fx-dashboard-month-chart"><div className="fx-dashboard-chart-axis">{[max, max / 2, 0].map((value, index) => <span key={index}>{dashboardNumber(value, rate ? '%' : '')}</span>)}</div><div className="fx-dashboard-chart-scroll" tabIndex={0} role="region" aria-label={`${title}, cuộn ngang để xem các tháng`}><div className="fx-dashboard-month-bars" role="img" aria-label={`${title}: ${valid.map(item => `${item.month}: ${dashboardNumber(item[field], rate ? '%' : ' giao dịch')}`).join('; ')}`}>{valid.map(item => <div className="fx-dashboard-month-column" key={item.month}><div className="fx-dashboard-bar-track"><div className="fx-dashboard-bar" style={{ height: `${item[field] / max * 100}%` }} title={`${item.month}: ${dashboardNumber(item[field], rate ? '%' : '')}`}><span>{dashboardNumber(item[field], rate ? '%' : '')}</span></div></div><span className="fx-dashboard-month-label">{item.month.slice(5)}/{item.month.slice(0, 4)}</span></div>)}</div></div></div> : <div className="fx-dashboard-empty-chart">Chưa có dữ liệu theo tháng.</div>}</div>
}

function SymbolChart({ items }) {
  const max = Math.max(1, ...items.map(item => item.closed_trade_count || 0))
  return <div className="fx-dashboard-chart-panel is-purple"><h3>Trades by symbol</h3>{items.length ? <div className="fx-dashboard-symbol-chart" role="img" aria-label={`Giao dịch theo symbol: ${items.map(item => `${item.symbol}: ${dashboardNumber(item.closed_trade_count)}`).join('; ')}`}>{items.map(item => <div className="fx-dashboard-symbol-row" key={item.symbol}><span>{item.symbol}</span><div className="fx-dashboard-symbol-track"><div className="fx-dashboard-symbol-bar" style={{ width: `${(item.closed_trade_count || 0) / max * 100}%` }} /></div><strong>{dashboardNumber(item.closed_trade_count)}</strong></div>)}<div className="fx-dashboard-symbol-axis"><span>0</span><span>{dashboardNumber(max / 2)}</span><span>{dashboardNumber(max)} giao dịch</span></div></div> : <div className="fx-dashboard-empty-chart">Chưa có giao dịch theo symbol.</div>}</div>
}

export default function DashboardPerformance({ workspace, filters, reload, controls, dateControls, sourceHeading, previewPayload }) {
  const [state, setState] = useState({ status: 'loading', payload: null, error: '', key: '' })
  const key = JSON.stringify([workspace, filters.session, filters.from, filters.to])
  const filterError = dashboardFilterError(filters)
  useEffect(() => {
    if (filterError) return
    if (previewPayload) { setState({ status: 'ready', payload: previewPayload, error: '', key }); return }
    const controller = new AbortController()
    setState({ status: 'loading', payload: null, error: '', key })
    readDashboardOverview(workspace, filters, controller.signal).then(payload => {
      if (!controller.signal.aborted) setState({ status: 'ready', payload, error: '', key })
    }).catch(error => {
      if (!controller.signal.aborted) setState({ status: 'error', payload: null, error: error.message, key })
    })
    return () => controller.abort()
  }, [key, reload, filterError, previewPayload])
  // Hide results immediately when scope changes, before its request completes.
  const performance = !filterError && state.key === key ? state.payload?.performance : null
  const metrics = performance?.metrics
  const loading = !filterError && (state.key !== key || state.status === 'loading')
  const partial = performance?.status === 'partial'
  const blocked = performance?.status === 'blocked' || performance?.scope?.readable_session_count === 0 && performance?.scope?.session_count > 0
  const partialNotice = partial && !blocked ? `Performance chỉ tổng hợp ${performance.scope.readable_session_count}/${performance.scope.session_count} phiên có dữ liệu.` : ''
  const notice = filterError || (loading ? 'Đang tải Performance…' : state.status === 'error' ? 'Chưa tải được Performance.' : blocked ? 'Chưa đủ dữ liệu thực thi để tính Performance.' : metrics?.closed_trade_count === 0 ? 'Không có giao dịch đóng trong phạm vi này.' : '')
  return <section className="fx-dashboard-results" aria-label="Performance" aria-busy={loading}>
    <div className="fx-dashboard-section-head"><h2 className="fx-dashboard-performance-heading">Performance{partialNotice && <span className="fx-dashboard-scope-info" tabIndex={0} role="img" aria-label={partialNotice}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v6" /><circle cx="12" cy="7.5" r=".8" fill="currentColor" stroke="none" /></svg><span className="fx-dashboard-scope-tooltip" aria-hidden="true">{partialNotice}</span></span>}</h2><div className="fx-dashboard-performance-filters">{controls}{dateControls}</div></div>
    {sourceHeading && <h3 className="fx-dashboard-source-heading">{sourceHeading}</h3>}
    <div className={`fx-dashboard-data-state${filterError || state.status === 'error' || partial || blocked ? ' is-warning' : ''}`} data-testid="dashboard-data-state" role={filterError || state.status === 'error' ? 'alert' : 'status'}>{notice && <span>{notice}</span>}</div>
    <div className="fx-dashboard-performance-layout" data-testid="dashboard-performance"><div className="fx-dashboard-performance">
      <Metric title="Time invested" value={previewPayload ? performance?.preview_times?.invested || '—' : '—'} detail={previewPayload ? 'Thời gian luyện tập mẫu' : 'Chưa có dữ liệu thời gian luyện tập'} icon="◷" />
      <Metric title="Historical time replayed" value={previewPayload ? performance?.preview_times?.replayed || '—' : '—'} detail={previewPayload ? 'Thời gian replay mẫu' : 'Chưa có dữ liệu thời gian replay'} icon="↶" />
      <Metric title="Trades taken" value={dashboardNumber(metrics?.closed_trade_count)} detail="Giao dịch đã đóng · đã loại trùng" icon="⇄" />
      <Metric title="Overall win rate" value={dashboardNumber(metrics?.win_rate_pct, '%')} detail={metrics?.wins != null ? `${dashboardNumber(metrics.wins)} thắng · ${dashboardNumber(metrics.losses)} thua · ${dashboardNumber(metrics.breakeven)} hòa` : 'Chưa có kết quả giao dịch'} icon="◎" tone="is-positive" />
    </div><MonthlyChart title="Giao dịch theo tháng" items={performance?.months || []} field="closed_trade_count" /></div>
    <div className="fx-dashboard-secondary-charts"><MonthlyChart title="Win rate by month" items={performance?.months || []} field="win_rate_pct" rate accent="blue" /><SymbolChart items={performance?.symbols || []} /></div>
  </section>
}
