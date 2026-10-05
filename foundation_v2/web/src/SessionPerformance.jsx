import React, { useId, useMemo, useState } from 'react'
import { dashboardCurve, dashboardMoney, dashboardNumber } from './dashboardModel.js'
import { closeTime, sessionPeriods } from './sessionPerformanceModel.js'
import FxSelect from './FxSelect.jsx'

const dateFormat = new Intl.DateTimeFormat('vi-VN', { timeZone: 'UTC', dateStyle: 'short', timeStyle: 'short' })

function PeriodBars({ title, items, currency, horizontal = false }) {
  const shown = horizontal ? items.slice(-12) : items
  const low = Math.min(0, ...shown.map(item => item.value))
  const high = Math.max(0, ...shown.map(item => item.value))
  const span = high - low || 1
  const zero = -low / span * 100
  return <section className="fxs-chart-panel"><h3>{title}</h3><small>{currency || 'Đơn vị tài khoản'} · net · UTC</small>{shown.length ? <div className={`fxs-bars ${horizontal ? 'is-horizontal' : ''}`} role="img" aria-label={`${title}: ${shown.map(item => `${item.label}: ${dashboardMoney(item.value, currency)}`).join('; ')}`}>
    {shown.map(item => <div className="fxs-bar-item" key={item.label}><span>{item.label}</span><div className="fxs-bar-track"><i className="fxs-bar-zero" style={horizontal ? { left: `${zero}%` } : { bottom: `${zero}%` }} /><i className={`fxs-bar ${item.value < 0 ? 'is-negative' : ''}`} style={horizontal ? { left: `${(Math.min(0, item.value) - low) / span * 100}%`, width: `${Math.abs(item.value) / span * 100}%` } : { bottom: `${(Math.min(0, item.value) - low) / span * 100}%`, height: `${Math.abs(item.value) / span * 100}%` }} /></div><strong>{dashboardNumber(item.value)}</strong></div>)}
  </div> : <p className="fxs-chart-empty">Chưa có dữ liệu giao dịch đóng.</p>}{horizontal && items.length > 12 && <small>12 tháng gần nhất · đầy đủ tại Analytics</small>}</section>
}

function Metric({ title, value, detail }) {
  return <div className="fxs-metric"><span>{title}<span className="fxs-metric-info" role="img" tabIndex={0} aria-label={detail} title={detail}>ⓘ</span></span><strong>{value}</strong></div>
}

export default function SessionPerformance({ model, payload, item, href, chartsOnly = false }) {
  const gradientId = useId()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(5)
  const periods = useMemo(() => sessionPeriods(model?.ledger || []), [model?.ledger])
  const curve = useMemo(() => dashboardCurve(model?.metrics), [model?.metrics])
  const currency = model?.result?.account_currency
  const rows = useMemo(() => [...(model?.ledger || [])].sort((a, b) => (closeTime(b.close_time_utc)?.getTime() || 0) - (closeTime(a.close_time_utc)?.getTime() || 0) || b.rowIndex - a.rowIndex), [model?.ledger])
  const pages = Math.max(1, Math.ceil(rows.length / pageSize))
  const current = Math.min(page, pages)
  const visible = rows.slice((current - 1) * pageSize, current * pageSize)
  const anchor = periods.anchor?.toISOString().slice(0, 10)
  const limited = payload.partial || payload.stale || ['partial', 'stale'].includes(payload.freshness) || ['partial', 'stale'].includes(payload.provenance?.status) || payload.provenance?.freshness === 'stale'
  return <section className="fxs-performance" data-testid="session-performance">
    {limited && <p role="status">{payload.stale || payload.freshness === 'stale' || payload.provenance?.freshness === 'stale' || payload.provenance?.status === 'stale' ? 'Dữ liệu chưa cập nhật.' : 'Dữ liệu một phần.'} Kết quả chỉ phản ánh phạm vi nguồn đã đọc.</p>}
    {rows.length || chartsOnly ? <div className="fxs-charts">
      <section className="fxs-chart-panel"><h3>Số dư từ lệnh đóng</h3><small>{currency || 'Đơn vị tài khoản'} · không gồm lãi/lỗ thả nổi</small>{curve ? <svg className="fxs-balance-curve" viewBox="0 0 380 230" role="img" aria-label={`Số dư từ lệnh đóng: ${dashboardMoney(model.startBalance, currency)} → ${dashboardMoney(model.endingBalance, currency)}`}>
        <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop stopColor="var(--wm-primary)" stopOpacity=".22" /><stop offset="1" stopColor="var(--wm-primary)" stopOpacity=".02" /></linearGradient></defs>
        {curve.ticks.map((tick, index) => <g key={index}><line x1="74" x2="342" y1={tick.y * .8} y2={tick.y * .8} className="fxs-gridline" /><text x="69" y={tick.y * .8 + 4} textAnchor="end">{dashboardNumber(tick.value + Number(model.metrics.starting_balance))}</text></g>)}
        <g transform="translate(50 0) scale(.3 .8)"><path d={`${curve.path} L ${curve.lastX} 250 L 80 250 Z`} fill={`url(#${gradientId})`} /><path d={curve.path} className="fxs-curve-path" /></g><circle cx={50 + curve.lastX * .3} cy={curve.lastY * .8} r="3" className="fxs-curve-dot" /><text x="74" y="213">Bắt đầu</text><text x="342" y="213" textAnchor="end">{curve.count} lệnh đóng</text>
      </svg> : <p className="fxs-chart-empty">Chưa có đường số dư được xác minh.</p>}</section>
      <PeriodBars title="Kết quả theo tháng" items={periods.months} currency={currency} horizontal />
      <PeriodBars title="Kết quả theo thứ" items={periods.weekdays} currency={currency} />
    </div> : <p className="fxs-no-analytics">Chưa có phân tích giao dịch.</p>}
    {periods.incomplete && <p role="status">Chưa đủ ngày đóng hoặc Net P/L để tính kết quả theo thời gian.</p>}
    {!chartsOnly && <><section className="fxs-metrics" aria-label="Chỉ số phiên">
      <Metric title="Total P/L" value={dashboardMoney(model?.netPnl, currency)} detail="Net · giao dịch đóng" />
      <Metric title="Win rate" value={dashboardNumber(model?.winRate, '%')} detail={`${dashboardNumber(model?.wins)} thắng · ${dashboardNumber(model?.losses)} thua`} />
      <Metric title="Lời/lỗ trung bình" value={dashboardNumber(model?.payoffRatio)} detail="Lãi TB / độ lớn lỗ TB · chưa biết nếu thiếu nguồn" />
      <Metric title="P/L tháng" value={dashboardMoney(periods.month, currency)} detail={anchor ? `Tháng ${anchor.slice(0, 7)} · UTC` : 'Chưa có ngày đóng'} />
      <Metric title="P/L tuần" value={dashboardMoney(periods.week, currency)} detail={anchor ? `Tuần T2–CN chứa ${anchor} · UTC` : 'Chưa có ngày đóng'} />
      <Metric title="P/L ngày" value={dashboardMoney(periods.day, currency)} detail={anchor ? `${anchor} · UTC` : 'Chưa có ngày đóng'} />
    </section>
    <section className="fxs-recent"><div className="fxs-section-heading"><h2>Recent Trades</h2>{href && <a className="fxr-button fxr-button-secondary fxs-journal" href={href('journal')}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1m0-15c3-2 6-2 9-1v15c-3-1-6-1-9 1Zm0 0v15" /></svg>Journal</a>}</div>
      {rows.length ? <><div className="fxs-table-scroll" role="region" aria-label="Giao dịch gần đây" tabIndex={0}><table><thead><tr><th>Phiên / lệnh</th><th>Đóng lệnh (UTC)</th><th>Symbol</th><th>Net P/L</th></tr></thead><tbody>{visible.map(trade => <tr key={trade.tradeId}><td>{model?.result?.preview ? <span>{item.name || item.record_id}<small>{trade.side || '—'}</small></span> : <a href={href('analytics', { trade: trade.tradeId })}>{item.name || item.record_id}<small>{trade.tradeId} · {trade.side || '—'}</small></a>}</td><td>{closeTime(trade.close_time_utc) ? dateFormat.format(closeTime(trade.close_time_utc)) : '—'}</td><td>{trade.symbol || model.result?.instrument_id || '—'}</td><td className={trade.pnl > 0 ? 'is-positive' : trade.pnl < 0 ? 'is-negative' : ''}>{dashboardMoney(trade.pnl, currency)}</td></tr>)}</tbody></table></div>
      <div className="fxs-pagination"><label>Số dòng<FxSelect label="Số dòng Recent Trades" value={pageSize} onChange={value => { setPageSize(Number(value)); setPage(1) }} options={[5, 10, 20].map(size => ({ value: size, label: String(size) }))} /></label>{pages > 1 && <div><button className="fxr-button fxr-button-secondary" type="button" aria-label="Trang giao dịch trước" disabled={current === 1} onClick={() => setPage(current - 1)}>‹</button><FxSelect label="Trang Recent Trades" value={current} onChange={value => setPage(Number(value))} options={Array.from({ length: pages }, (_, index) => ({ value: index + 1, label: String(index + 1) }))} /><span>/ {pages}</span><button className="fxr-button fxr-button-secondary" type="button" aria-label="Trang giao dịch sau" disabled={current === pages} onClick={() => setPage(current + 1)}>›</button></div>}</div></> : <div className="fxs-trades-empty" data-testid="session-trades-empty"><svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M10 12h28v24H10ZM10 20h28M16 27h8m-8 5h16" /></svg><h3>Chưa có giao dịch đóng</h3><p>{!model ? 'Mở chart để bắt đầu phiên luyện tập.' : 'Giao dịch đã đóng sẽ xuất hiện tại đây.'}</p>{!model?.result?.preview && !item.archived && item.dataset_available && <a className="fxr-button fxr-button-primary" href={href('replay', { select: null, surface: 'workspace' })}>Mở chart →</a>}</div>}
    </section></>}
  </section>
}
