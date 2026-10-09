import TestingReadState, { TestingSkeleton } from './TestingReadState.jsx'
import TestingIcon from './TestingIcon.jsx'
import { useTestingLocale } from './testingLocale.jsx'
import { useEffect, useState } from 'react'
import { dashboardDurationParts, dashboardFilterError, readDashboardOverview } from './dashboardModel.js'

function Duration({ seconds }) {
  const { t, locale } = useTestingLocale()
  const parts = dashboardDurationParts(seconds)
  return parts ? <span className="fx-dashboard-duration">{parts.map(([value, unit]) => <span key={unit}><span>{value.toLocaleString(locale)}</span><small>{t(`duration.${unit}`)}</small></span>)}</span> : '—'
}

function Metric({ title, value, detail, icon, children }) {
  const { t } = useTestingLocale()

  return <div className="fx-dashboard-metric"><span title={detail || undefined}><span className="fx-dashboard-metric-icon" aria-hidden="true"><TestingIcon kind={icon} /></span>{t(title)}</span><strong>{value}</strong>{children}{detail && <small>{t(detail)}</small>}</div>
}

function timingDetail(performance, kind, t) {
  const scope = performance?.timing_scope
  if (!scope) return t('Thời gian đã ghi nhận')
  const measured = scope[`${kind}_measured_session_count`], unknown = scope[`unknown_${kind}_session_count`]
  return unknown > 0 ? t('{measured}/{total} phiên được ghi nhận', { measured, total: measured + unknown }) : t('Từ khi bật theo dõi · toàn phiên')
}

function SideSplit({ counts, total }) {
  const { t, locale } = useTestingLocale()
  const buy = counts?.buy, sell = counts?.sell
  if (!Number.isSafeInteger(buy) || !Number.isSafeInteger(sell) || buy < 0 || sell < 0 || !Number.isSafeInteger(total) || total <= 0 || buy + sell !== total) return null
  const buyRate = buy / total * 100, sellRate = sell / total * 100
  const percent = value => new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value) + '%'
  return <div className="fx-dashboard-side-split">
    <div className="fx-dashboard-side-bar" aria-hidden="true"><span className="is-buy" style={{ width: `${buyRate}%` }} /><span className="is-sell" style={{ width: `${sellRate}%` }} /></div>
    <small><span className="is-buy">{percent(buyRate)} {t('Buy')}</span><span aria-hidden="true"> · </span><span className="is-sell">{percent(sellRate)} {t('Sell')}</span></small>
  </div>
}

function MonthlyChart({ title, items, field, rate = false, accent = 'gold' }) {
  const dashboardNumber = (value, suffix = '') => value == null || value === '' || typeof value === 'boolean' || !Number.isFinite(Number(value)) ? '—' : `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(Number(value))}${suffix}`

  const { t, locale } = useTestingLocale()

  const valid = items.filter(item => typeof item[field] === 'number' && Number.isFinite(item[field]) && item[field] >= 0 && (!rate || item[field] <= 100))
  const max = rate ? 100 : Math.max(2, Math.ceil(Math.max(0, ...valid.map(item => item[field])) / 2) * 2)
  const ticks = rate ? [100, 80, 60, 40, 20, 0] : [max, max / 2, 0]
  return <div className={`fx-dashboard-chart-panel is-${accent}`}>
    <h3>{t(title)}</h3>
    {valid.length ? <div className="fx-dashboard-month-chart">
      <div className="fx-dashboard-chart-scroll" tabIndex={0} role="region" aria-label={t('{title}, cuộn ngang để xem các tháng', { title })}>
        <div className="fx-dashboard-chart-axis">{ticks.map(value => <span key={value}>{dashboardNumber(value, rate ? '%' : '')}</span>)}</div>
        <div className="fx-dashboard-month-bars" role="img" aria-label={`${title}: ${valid.map(item => `${item.month}: ${rate ? dashboardNumber(item[field], '%') : t('{count} giao dịch', { count: dashboardNumber(item[field]) })}`).join('; ')}`}>
          <div className="fx-dashboard-plot-grid" aria-hidden="true">{ticks.map(value => <i key={value} style={{ top: `${(1 - value / max) * 100}%` }} />)}</div>
          {valid.map(item => <div className="fx-dashboard-month-column" key={item.month}>
            <div className="fx-dashboard-bar-track"><div className={`fx-dashboard-bar${item[field] === 0 ? ' is-zero' : ''}`} style={{ height: `${item[field] / max * 100}%` }} title={`${item.month}: ${dashboardNumber(item[field], rate ? '%' : '')}`}><span>{dashboardNumber(item[field], rate ? '%' : '')}</span></div></div>
            <span className="fx-dashboard-month-label">{item.month.slice(5)}/{item.month.slice(0, 4)}</span>
          </div>)}
        </div>
      </div>
    </div> : <div className="fx-dashboard-empty-chart">{t("Chưa có dữ liệu theo tháng.")}</div>}
  </div>
}

function SymbolChart({ items }) {
  const dashboardNumber = (value, suffix = '') => value == null || value === '' || typeof value === 'boolean' || !Number.isFinite(Number(value)) ? '—' : `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(Number(value))}${suffix}`

  const { t, locale } = useTestingLocale()

  const valid = items.filter(item => Number.isInteger(item.closed_trade_count) && item.closed_trade_count >= 0)
  const max = Math.max(2, Math.ceil(Math.max(0, ...valid.map(item => item.closed_trade_count)) / 2) * 2)
  return <div className="fx-dashboard-chart-panel is-purple"><h3>{t("Trades by symbol")}</h3>{valid.length ? <div className="fx-dashboard-symbol-chart" role="img" aria-label={t('Giao dịch theo symbol: {values}', { values: valid.map(item => `${item.symbol}: ${dashboardNumber(item.closed_trade_count)}`).join('; ') })}>{valid.map(item => <div className="fx-dashboard-symbol-row" key={item.symbol}><span>{item.symbol}</span><div className="fx-dashboard-symbol-track"><div className="fx-dashboard-symbol-bar" style={{ width: `${item.closed_trade_count / max * 100}%` }} /></div><strong>{dashboardNumber(item.closed_trade_count)}</strong></div>)}<div className="fx-dashboard-symbol-axis"><span>0</span><span>{dashboardNumber(max / 2)}</span><span>{dashboardNumber(max)}</span></div></div> : <div className="fx-dashboard-empty-chart">{t("Chưa có giao dịch theo symbol.")}</div>}</div>
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
      if (!controller.signal.aborted) setState(current => current.key === key && current.payload && ![401, 403].includes(error.status) ? { ...current, status: 'stale', refreshing: false, error: error.message } : { status: 'error', payload: null, error: error.message, httpStatus: error.status, key })
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
  const failed = !loading && state.key === key && state.status === 'error'
  const denied = failed && [401, 403].includes(state.httpStatus)
  const unavailable = failed && state.error === 'dashboard_performance_unavailable'
  const noSessions = performance?.scope?.session_count === 0
  const noTrades = !blocked && !noSessions && metrics?.closed_trade_count === 0
  const groupMessage = filterError || (denied ? 'Bạn không có quyền xem Performance.' : unavailable ? 'Nguồn Performance chưa khả dụng.' : failed ? 'Chưa tải được Performance.' : blocked ? 'Chưa đủ dữ liệu thực thi để tính Performance.' : noSessions ? 'Chưa có phiên backtest trong phạm vi này. Tạo phiên đầu tiên để xem kết quả.' : '')
  const notice = state.key === key && state.status === 'stale' ? 'Dữ liệu chưa cập nhật.' : state.key === key && state.refreshing ? 'Đang cập nhật Performance…' : ''
  const groupState = filterError ? 'invalid' : loading ? 'loading' : denied ? 'denied' : unavailable || blocked ? 'unavailable' : failed ? 'error' : noSessions ? 'empty' : noTrades ? 'no-trades' : 'ready'
  return <section className="fx-dashboard-results" aria-label={t("Performance")} aria-busy={loading || (!filterError && state.key === key && Boolean(state.refreshing))} aria-description={partialNotice || undefined}>
    <div className="fx-dashboard-section-head"><h2 className="fx-dashboard-performance-heading">{t("Performance")}</h2><div className="fx-dashboard-performance-filters">{controls}{dateControls}</div></div>
    {sourceHeading && <h3 className="fx-dashboard-source-heading">{sourceHeading}</h3>}
    {(notice || partialNotice) && !groupMessage && <div className={`fx-dashboard-data-state${partial || state.status === 'stale' ? ' is-warning' : ''}`} data-testid="dashboard-data-state" role="status"><span>{t(notice)}{notice && partialNotice ? ' ' : ''}{partialNotice}</span>{state.status === 'stale' && <button type="button" className="fxa-button" onClick={() => setRetry(value => value + 1)}>{t('Thử lại')}</button>}</div>}
    <div data-testid="dashboard-result-group" data-state={groupState}>
    {loading ? <TestingSkeleton label="Đang tải Performance…" /> : groupMessage ? <TestingReadState message={groupMessage} error={Boolean(filterError || failed)} onRetry={failed && !denied ? () => setRetry(value => value + 1) : undefined} /> : <><div className={`fx-dashboard-performance-layout${noTrades ? ' has-no-trades' : ''}`} data-testid="dashboard-performance"><div className="fx-dashboard-performance">
      <Metric title={t("Time invested")} value={<Duration seconds={performance?.time_invested_seconds} />} detail={dashboardDurationParts(performance?.time_invested_seconds) ? previewPayload ? t("Thời gian luyện tập mẫu") : timingDetail(performance, 'practice', t) : t("Chưa có dữ liệu thời gian luyện tập")} icon="clock" />
      <Metric title={t("Historical time replayed")} value={<Duration seconds={performance?.historical_time_replayed_seconds} />} detail={dashboardDurationParts(performance?.historical_time_replayed_seconds) ? previewPayload ? t("Thời gian replay mẫu") : timingDetail(performance, 'historical', t) : t("Chưa có dữ liệu thời gian replay")} icon="history" />
      <Metric title={t("Trades taken")} value={dashboardNumber(metrics?.closed_trade_count)} icon="trades">
        <SideSplit counts={performance?.side_counts} total={metrics?.closed_trade_count} />
      </Metric>
      <Metric title={t("Overall win rate")} value={dashboardNumber(metrics?.win_rate_pct, '%')} icon="target" />
    </div>{!noTrades && <MonthlyChart title={t("Giao dịch theo tháng")} items={performance?.months || []} field="closed_trade_count" />}</div>
    {noTrades ? <TestingReadState message={filters.from || filters.to ? 'Không có giao dịch đóng trong khoảng ngày đã chọn. Đổi khoảng ngày để xem kết quả.' : 'Chưa có giao dịch đóng. Biểu đồ sẽ xuất hiện sau giao dịch đầu tiên.'} /> : <div className="fx-dashboard-secondary-charts"><MonthlyChart title={t("Win rate by month")} items={performance?.months || []} field="win_rate_pct" rate accent="blue" /><SymbolChart items={performance?.symbols || []} /></div>}</>}
    </div>
  </section>
}
