import React, { useEffect, useState } from 'react'
import { buildAnalyticsModel } from './AnalyticsWorkspace.jsx'
import { dashboardNumber, dashboardMoney, readDashboardAnalytics, dashboardCurve } from './dashboardModel.js'

function Metric({ title, value, detail, tone }) {
  return <div className="fx-dashboard-metric"><span>{title}</span><strong className={tone || ''}>{value}</strong><small>{detail}</small></div>
}

export default function DashboardPerformance({ workspace, session, reload, analyticsHref }) {
  const [state, setState] = useState({ status: 'idle', payload: null, error: '', id: '' })
  const [retry, setRetry] = useState(0)
  const id = session?.record_id || ''
  useEffect(() => {
    if (!id) return
    const controller = new AbortController()
    setState(previous => ({ status: 'loading', payload: previous.id === id ? previous.payload : null, error: '', id }))
    readDashboardAnalytics(workspace, id, controller.signal).then(payload => {
      if (!controller.signal.aborted) setState({ status: 'ready', payload, error: '', id })
    }).catch(error => {
      if (!controller.signal.aborted) setState(previous => ({ ...previous, status: 'error', error: error.message }))
    })
    return () => controller.abort()
  }, [workspace, id, reload, retry])
  // A new scope must never display the previous session's successful response.
  const payload = state.id === id && id ? state.payload : null
  const blocked = payload?.analytics_available === false || payload?.blocked_by_data?.length > 0
  const result = payload && !blocked ? { ...payload.provenance, account_currency: payload.account_currency || payload.provenance?.account_currency, metrics: payload.metrics, ledger: payload.ledger } : null
  const model = buildAnalyticsModel(result)
  const currency = result?.account_currency || 'đơn vị tài khoản'
  const chart = dashboardCurve(payload?.metrics)
  const stale = payload?.stale === true || payload?.freshness === 'stale' || payload?.provenance?.freshness === 'stale' || payload?.provenance?.status === 'stale'
  const partial = payload?.partial === true || payload?.freshness === 'partial' || payload?.provenance?.status === 'partial'
  const notice = !id ? 'Chọn một phiên để xem kết quả.' : state.status === 'loading' ? payload ? 'Đang cập nhật · kết quả đang hiển thị là lần đọc trước.' : 'Đang tải kết quả phiên…' : state.status === 'error' ? payload ? 'Chưa cập nhật được · kết quả đang hiển thị là lần đọc trước.' : 'Chưa tải được kết quả phiên.' : blocked ? 'Kết quả chưa khả dụng: dữ liệu nguồn chưa đủ.' : stale ? 'Dữ liệu cũ · làm mới trước khi đánh giá kết quả.' : partial ? 'Dữ liệu chưa đầy đủ · các chỉ số phản ánh phần đọc được.' : payload?.scope?.selected_trade_count === 0 ? 'Phiên chưa có giao dịch đóng.' : ''
  const money = value => dashboardMoney(value, currency)
  return <section className="fx-dashboard-results" aria-label="Kết quả phiên" aria-busy={state.status === 'loading'}>
    <div className="fx-dashboard-performance" data-testid="dashboard-performance">
      <Metric title="Net P/L" value={money(model.netPnl)} detail="Sau chi phí · lệnh đã đóng" tone={model.netPnl > 0 ? 'is-positive' : model.netPnl < 0 ? 'is-negative' : ''} />
      <Metric title="Giao dịch đã đóng" value={dashboardNumber(model.tradeCount)} detail="Toàn bộ phiên đang chọn" />
      <Metric title="Tỷ lệ thắng" value={dashboardNumber(model.winRate, '%')} detail={model.wins !== null ? `${model.wins} thắng · ${model.losses} thua · ${model.breakeven} hòa` : 'Chưa đủ dữ liệu kết quả lệnh'} />
      <Metric title="Max drawdown" value={money(result?.metrics?.closed_trade_balance_max_drawdown)} detail="Sụt giảm balance sau đóng lệnh" />
    </div>
    <div className="fx-dashboard-section-head"><div><h2>Kết quả theo giao dịch</h2><p>P/L tích lũy · {currency} · sau mỗi lệnh đóng</p></div>{session && <a className="fx-dashboard-text-link" href={analyticsHref}>Phân tích chi tiết <span aria-hidden="true">↗</span></a>}</div>
    <div className={`fx-dashboard-data-state ${state.status === 'error' || blocked || stale || partial ? 'is-warning' : ''}`} data-testid="dashboard-data-state" role={state.status === 'error' || blocked ? 'alert' : 'status'}>{notice && <span>{notice}</span>}{state.status === 'error' && <button type="button" onClick={() => setRetry(value => value + 1)}>Thử lại kết quả</button>}</div>
    {!blocked && chart ? <svg className="fx-dashboard-result-chart" viewBox="0 0 1000 280" role="img" aria-labelledby="dashboard-curve-title" aria-describedby="dashboard-curve-desc">
      <title id="dashboard-curve-title">P/L tích lũy theo giao dịch đã đóng</title><desc id="dashboard-curve-desc">{chart.count} lệnh; từ {dashboardNumber(chart.first)} đến {dashboardNumber(chart.last)} {currency}. Chỉ balance sau đóng lệnh; không gồm floating P/L.</desc>
      {chart.ticks.map(tick => <g key={tick.value}><line x1="80" x2="974" y1={tick.y} y2={tick.y} className="fx-dashboard-chart-grid" /><text x="66" y={tick.y + 4} textAnchor="end">{dashboardNumber(tick.value)}</text></g>)}
      <line x1="80" x2="974" y1={chart.zeroY} y2={chart.zeroY} className="fx-dashboard-chart-zero" />
      <path d={chart.path} className="fx-dashboard-chart-path" />
      <circle cx={chart.lastX} cy={chart.lastY} r="4" className="fx-dashboard-chart-end" />
      {[0, Math.floor(chart.count / 2), chart.count].map((value, index) => <text key={index} x={80 + 894 * index / 2} y="266" textAnchor={index === 0 ? 'start' : index === 2 ? 'end' : 'middle'}>#{value}</text>)}
    </svg> : <div className="fx-dashboard-empty-chart">{state.status === 'loading' && id ? 'Đang đọc chuỗi kết quả…' : 'Chưa có chuỗi balance hợp lệ để vẽ biểu đồ.'}</div>}
    <div className="fx-dashboard-chart-foot"><span>Balance sau đóng lệnh · không gồm floating P/L</span><span>{payload?.provenance?.revision ? `Revision ${payload.provenance.revision}` : 'Chưa có nguồn kết quả'}</span></div>
    {(state.error || blocked) && <details className="fx-dashboard-provenance"><summary>Chi tiết dữ liệu</summary><p>{state.error || payload.blocked_by_data?.join('; ') || 'Analytics chưa khả dụng cho phiên này.'}</p></details>}
  </section>
}
