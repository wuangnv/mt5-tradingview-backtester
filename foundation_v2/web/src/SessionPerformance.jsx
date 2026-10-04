import React, { useMemo, useState } from 'react'
import { dashboardCurve, dashboardMoney, dashboardNumber } from './dashboardModel.js'
import { closeTime, sessionPeriods } from './sessionPerformanceModel.js'

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
  return <div className="fxs-metric"><span>{title}</span><strong>{value}</strong><small>{detail}</small></div>
}

export default function SessionPerformance({ model, payload, item, href }) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(5)
  const periods = useMemo(() => sessionPeriods(model.ledger), [model.ledger])
  const curve = useMemo(() => dashboardCurve(model.metrics), [model.metrics])
  const currency = model.result?.account_currency
  const rows = useMemo(() => [...model.ledger].sort((a, b) => (closeTime(b.close_time_utc)?.getTime() || 0) - (closeTime(a.close_time_utc)?.getTime() || 0) || b.rowIndex - a.rowIndex), [model.ledger])
  const pages = Math.max(1, Math.ceil(rows.length / pageSize))
  const current = Math.min(page, pages)
  const visible = rows.slice((current - 1) * pageSize, current * pageSize)
  const anchor = periods.anchor?.toISOString().slice(0, 10)
  const limited = payload.partial || payload.stale || ['partial', 'stale'].includes(payload.freshness) || ['partial', 'stale'].includes(payload.provenance?.status) || payload.provenance?.freshness === 'stale'
  return <section className="fxs-performance" data-testid="session-performance">
    <div className="fxs-scope"><span>Replay mô phỏng · {model.tradeCount} giao dịch đóng · UTC</span><a href={href('analytics')}>Analytics đầy đủ ↗</a></div>
    {limited && <p role="status">{payload.stale || payload.freshness === 'stale' || payload.provenance?.freshness === 'stale' || payload.provenance?.status === 'stale' ? 'Dữ liệu chưa cập nhật.' : 'Dữ liệu một phần.'} Kết quả chỉ phản ánh phạm vi nguồn đã đọc.</p>}
    <div className="fxs-charts">
      <section className="fxs-chart-panel"><h3>Số dư từ lệnh đóng</h3><small>{currency || 'Đơn vị tài khoản'} · không gồm lãi/lỗ thả nổi</small>{curve ? <svg className="fxs-balance-curve" viewBox="0 0 380 230" role="img" aria-label={`Số dư từ lệnh đóng: ${dashboardMoney(model.startBalance, currency)} → ${dashboardMoney(model.endingBalance, currency)}`}>
        {curve.ticks.map((tick, index) => <g key={index}><line x1="74" x2="342" y1={tick.y * .8} y2={tick.y * .8} className="fxs-gridline" /><text x="69" y={tick.y * .8 + 4} textAnchor="end">{dashboardNumber(tick.value + Number(model.metrics.starting_balance))}</text></g>)}
        <g transform="translate(50 0) scale(.3 .8)"><path d={curve.path} className="fxs-curve-path" /></g><circle cx={50 + curve.lastX * .3} cy={curve.lastY * .8} r="3" className="fxs-curve-dot" /><text x="74" y="213">Bắt đầu</text><text x="342" y="213" textAnchor="end">{curve.count} lệnh đóng</text>
      </svg> : <p className="fxs-chart-empty">Chưa có đường số dư được xác minh.</p>}</section>
      <PeriodBars title="Kết quả theo tháng" items={periods.months} currency={currency} horizontal />
      <PeriodBars title="Kết quả theo thứ" items={periods.weekdays} currency={currency} />
    </div>
    {periods.incomplete && <p role="status">Chưa đủ ngày đóng hoặc Net P/L để tính kết quả theo thời gian.</p>}
    <section className="fxs-metrics" aria-label="Chỉ số phiên">
      <Metric title="Total P/L" value={dashboardMoney(model.netPnl, currency)} detail="Net · giao dịch đóng" />
      <Metric title="Win rate" value={dashboardNumber(model.winRate, '%')} detail={`${dashboardNumber(model.wins)} thắng · ${dashboardNumber(model.losses)} thua`} />
      <Metric title="Lời/lỗ trung bình" value={dashboardNumber(model.payoffRatio)} detail="Lãi TB / độ lớn lỗ TB · chưa biết nếu thiếu nguồn" />
      <Metric title="P/L tháng" value={dashboardMoney(periods.month, currency)} detail={anchor ? `Tháng ${anchor.slice(0, 7)} · UTC` : 'Chưa có ngày đóng'} />
      <Metric title="P/L tuần" value={dashboardMoney(periods.week, currency)} detail={anchor ? `Tuần T2–CN chứa ${anchor} · UTC` : 'Chưa có ngày đóng'} />
      <Metric title="P/L ngày" value={dashboardMoney(periods.day, currency)} detail={anchor ? `${anchor} · UTC` : 'Chưa có ngày đóng'} />
    </section>
    <section className="fxs-recent"><div className="fxs-section-heading"><h2>Recent Trades</h2><a className="fxr-button fxr-button-secondary" href={href('journal')}>Journal ↗</a></div>
      <div className="fxs-table-scroll" role="region" aria-label="Giao dịch gần đây" tabIndex={0}><table><thead><tr><th>Phiên / lệnh</th><th>Đóng lệnh (UTC)</th><th>Symbol</th><th>Net P/L</th></tr></thead><tbody>{visible.map(trade => <tr key={trade.tradeId}><td><a href={href('analytics', { trade: trade.tradeId })}>{item.name || item.record_id}<small>{trade.tradeId} · {trade.side || '—'}</small></a></td><td>{closeTime(trade.close_time_utc) ? dateFormat.format(closeTime(trade.close_time_utc)) : '—'}</td><td>{trade.symbol || model.result?.instrument_id || '—'}</td><td className={trade.pnl > 0 ? 'is-positive' : trade.pnl < 0 ? 'is-negative' : ''}>{dashboardMoney(trade.pnl, currency)}</td></tr>)}</tbody></table></div>
      {!rows.length && <p>Chưa có giao dịch đóng trong phiên này.</p>}
      <div className="fxs-pagination"><label>Số dòng<select aria-label="Số dòng Recent Trades" value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setPage(1) }}>{[5, 10, 20].map(size => <option value={size} key={size}>{size}</option>)}</select></label><div><button className="fxr-button fxr-button-secondary" type="button" aria-label="Trang giao dịch trước" disabled={current === 1} onClick={() => setPage(current - 1)}>‹</button><label>Trang<select aria-label="Trang Recent Trades" value={current} onChange={event => setPage(Number(event.target.value))}>{Array.from({ length: pages }, (_, index) => <option value={index + 1} key={index}>{index + 1}</option>)}</select></label><span>/ {pages}</span><button className="fxr-button fxr-button-secondary" type="button" aria-label="Trang giao dịch sau" disabled={current === pages} onClick={() => setPage(current + 1)}>›</button></div></div>
    </section>
  </section>
}
