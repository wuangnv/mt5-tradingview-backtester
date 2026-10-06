import { TestingSkeleton } from './TestingReadState.jsx'
import TestingIcon from './TestingIcon.jsx'
import { useTestingLocale } from './testingLocale.jsx'
import { useEffect, useState } from 'react'
import { dashboardFilterError, readDashboardOverview } from './dashboardModel.js'

function Metric({ title, value, detail, icon, tone }) {
  const { t } = useTestingLocale()

  return <div className="fx-dashboard-metric"><span><span className="fx-dashboard-metric-icon" aria-hidden="true"><TestingIcon kind={icon} /></span>{t(title)}</span><strong className={tone || ''}>{value}</strong><small>{t(detail)}</small></div>
}

function MonthlyChart({ title, items, field, rate = false, accent = 'gold' }) {
  const dashboardNumber = (value, suffix = '') => value == null || value === '' || typeof value === 'boolean' || !Number.isFinite(Number(value)) ? '—' : `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(Number(value))}${suffix}`

  const { t, locale } = useTestingLocale()

  const valid = items.filter(item => item[field] !== null && Number.isFinite(item[field]))
  const max = rate ? 100 : Math.max(1, ...valid.map(item => item[field]))
  return <div className={`fx-dashboard-chart-panel is-${accent}`}><h3>{t(title)}</h3>{valid.length ? <div className="fx-dashboard-month-chart"><div className="fx-dashboard-chart-axis">{[max, max / 2, 0].map((value, index) => <span key={index}>{dashboardNumber(value, rate ? '%' : '')}</span>)}</div><div className="fx-dashboard-chart-scroll" tabIndex={0} role="region" aria-label={t('{title}, cuộn ngang để xem các tháng', { title })}><div className="fx-dashboard-month-bars" role="img" aria-label={`${title}: ${valid.map(item => `${item.month}: ${rate ? dashboardNumber(item[field], '%') : t('{count} giao dịch', { count: dashboardNumber(item[field]) })}`).join('; ')}`}>{valid.map(item => <div className="fx-dashboard-month-column" key={item.month}><div className="fx-dashboard-bar-track"><div className="fx-dashboard-bar" style={{ height: `${item[field] / max * 100}%` }} title={`${item.month}: ${dashboardNumber(item[field], rate ? '%' : '')}`}><span>{dashboardNumber(item[field], rate ? '%' : '')}</span></div></div><span className="fx-dashboard-month-label">{item.month.slice(5)}/{item.month.slice(0, 4)}</span></div>)}</div></div></div> : <div className="fx-dashboard-empty-chart">{t("Chưa có dữ liệu theo tháng.")}</div>}</div>
}

function SymbolChart({ items }) {
  const dashboardNumber = (value, suffix = '') => value == null || value === '' || typeof value === 'boolean' || !Number.isFinite(Number(value)) ? '—' : `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(Number(value))}${suffix}`

  const { t, locale } = useTestingLocale()

  const max = Math.max(1, ...items.map(item => item.closed_trade_count || 0))
  return <div className="fx-dashboard-chart-panel is-purple"><h3>{t("Trades by symbol")}</h3>{items.length ? <div className="fx-dashboard-symbol-chart" role="img" aria-label={t('Giao dịch theo symbol: {values}', { values: items.map(item => `${item.symbol}: ${dashboardNumber(item.closed_trade_count)}`).join('; ') })}>{items.map(item => <div className="fx-dashboard-symbol-row" key={item.symbol}><span>{item.symbol}</span><div className="fx-dashboard-symbol-track"><div className="fx-dashboard-symbol-bar" style={{ width: `${(item.closed_trade_count || 0) / max * 100}%` }} /></div><strong>{dashboardNumber(item.closed_trade_count)}</strong></div>)}<div className="fx-dashboard-symbol-axis"><span>0</span><span>{dashboardNumber(max / 2)}</span><span>{t('{count} giao dịch', { count: dashboardNumber(max) })}</span></div></div> : <div className="fx-dashboard-empty-chart">{t("Chưa có giao dịch theo symbol.")}</div>}</div>
}

export default function DashboardPerformance({ workspace, filters, reload, controls, dateControls, sourceHeading, previewPayload }) {
  const dashboardNumber = (value, suffix = '') => value == null || value === '' || typeof value === 'boolean' || !Number.isFinite(Number(value)) ? '—' : `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(Number(value))}${suffix}`

  const { t, locale } = useTestingLocale()

  const [retry, setRetry] = useState(0)
  const [state, setState] = useState({ status: 'loading', payload: null, error: '', key: '' })
  const key = JSON.stringify([workspace, filters.session, filters.from, filters.to])
  const filterError = dashboardFilterError(filters)
  useEffect(() => {
    if (filterError) return
    if (previewPayload) { setState({ status: 'ready', payload: previewPayload, error: '', key }); return }
    const controller = new AbortController()
    setState(current => current.key === key && current.payload ? { ...current, refreshing: true, error: '' } : { status: 'loading', payload: null, error: '', key })
    readDashboardOverview(workspace, filters, controller.signal).then(payload => {
      if (!controller.signal.aborted) setState({ status: 'ready', payload, error: '', key })
    }).catch(error => {
      if (!controller.signal.aborted) setState(current => current.key === key && current.payload ? { ...current, status: 'stale', refreshing: false, error: error.message } : { status: 'error', payload: null, error: error.message, key })
    })
    return () => controller.abort()
  }, [key, reload, retry, filterError, previewPayload])
  // Hide results immediately when scope changes, before its request completes.
  const performance = !filterError && state.key === key ? state.payload?.performance : null
  const metrics = performance?.metrics
  const loading = !filterError && (state.key !== key || state.status === 'loading')
  const partial = performance?.status === 'partial'
  const blocked = performance?.status === 'blocked' || performance?.scope?.readable_session_count === 0 && performance?.scope?.session_count > 0
  const partialNotice = partial && !blocked ? t("Performance chỉ tổng hợp {readable}/{total} phiên có dữ liệu.", { readable: performance.scope.readable_session_count, total: performance.scope.session_count }) : ''
  const notice = filterError || (loading ? 'Đang tải Performance…' : state.status === 'error' ? 'Chưa tải được Performance.' : state.status === 'stale' ? 'Dữ liệu chưa cập nhật.' : blocked ? 'Chưa đủ dữ liệu thực thi để tính Performance.' : metrics?.closed_trade_count === 0 ? 'Không có giao dịch đóng trong phạm vi này.' : '')
  return <section className="fx-dashboard-results" aria-label={t("Performance")} aria-busy={loading || Boolean(state.refreshing)} aria-description={partialNotice || undefined}>
    <div className="fx-dashboard-section-head"><h2 className="fx-dashboard-performance-heading">{t("Performance")}</h2><div className="fx-dashboard-performance-filters">{controls}{dateControls}</div></div>
    {sourceHeading && <h3 className="fx-dashboard-source-heading">{sourceHeading}</h3>}
    <div className={`fx-dashboard-data-state${filterError || state.status === 'error' || partial || blocked ? ' is-warning' : ''}`} data-testid="dashboard-data-state" role={filterError || state.status === 'error' ? 'alert' : 'status'}>{notice && <span>{t(notice)}</span>}{['error', 'stale'].includes(state.status) && <button type="button" className="fxa-button" onClick={() => setRetry(value => value + 1)}>{t('Thử lại')}</button>}</div>
    {loading ? <TestingSkeleton label="Đang tải Performance…" /> : <><div className="fx-dashboard-performance-layout" data-testid="dashboard-performance"><div className="fx-dashboard-performance">
      <Metric title={t("Time invested")} value={previewPayload ? performance?.preview_times?.invested || '—' : '—'} detail={previewPayload ? t("Thời gian luyện tập mẫu") : t("Chưa có dữ liệu thời gian luyện tập")} icon="clock" />
      <Metric title={t("Historical time replayed")} value={previewPayload ? performance?.preview_times?.replayed || '—' : '—'} detail={previewPayload ? t("Thời gian replay mẫu") : t("Chưa có dữ liệu thời gian replay")} icon="history" />
      <Metric title={t("Trades taken")} value={dashboardNumber(metrics?.closed_trade_count)} detail={t("Giao dịch đã đóng · đã loại trùng")} icon="trades" />
      <Metric title={t("Overall win rate")} value={dashboardNumber(metrics?.win_rate_pct, '%')} detail={metrics?.wins != null ? t("{wins} thắng · {losses} thua · {breakeven} hòa", { wins: dashboardNumber(metrics.wins), losses: dashboardNumber(metrics.losses), breakeven: dashboardNumber(metrics.breakeven) }) : t("Chưa có kết quả giao dịch")} icon="target" tone="is-positive" />
    </div><MonthlyChart title={t("Giao dịch theo tháng")} items={performance?.months || []} field="closed_trade_count" /></div>
    <div className="fx-dashboard-secondary-charts"><MonthlyChart title={t("Win rate by month")} items={performance?.months || []} field="win_rate_pct" rate accent="blue" /><SymbolChart items={performance?.symbols || []} /></div></>}
  </section>
}
