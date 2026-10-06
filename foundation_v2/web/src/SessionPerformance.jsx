import { useTestingLocale } from './testingLocale.jsx'
import { useId, useMemo, useState } from 'react'
import { dashboardCurve } from './dashboardModel.js'
import { closeTime, sessionPeriods } from './sessionPerformanceModel.js'
import FxSelect from './FxSelect.jsx'
import TestingIcon from './TestingIcon.jsx'
import { SessionChartLink } from './SessionDetails.jsx'



function PeriodBars({ title, items, currency, horizontal = false }) {
  const dashboardNumber = (value, suffix = '') => value == null || value === '' || typeof value === 'boolean' || !Number.isFinite(Number(value)) ? '—' : `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(Number(value))}${suffix}`
  const dashboardMoney = (value, currency) => fmt(value, ` ${currency || t('Đơn vị tài khoản')}`)

  const { t, locale, fmt } = useTestingLocale()

  const shown = horizontal ? items.slice(-12) : items
  const low = Math.min(0, ...shown.map(item => item.value))
  const high = Math.max(0, ...shown.map(item => item.value))
  const span = high - low || 1
  const zero = -low / span * 100
  return <section className="fxs-chart-panel"><h3>{t(title)}</h3><small>{currency || t("Đơn vị tài khoản")} {t("· net · UTC")}</small>{shown.length ? <div className={`fxs-bars ${horizontal ? 'is-horizontal' : ''}`} role="img" aria-label={`${title}: ${shown.map(item => `${t(item.label)}: ${dashboardMoney(item.value, currency)}`).join('; ')}`}>
    {shown.map(item => <div className="fxs-bar-item" key={item.label}><span>{t(item.label)}</span><div className="fxs-bar-track"><i className="fxs-bar-zero" style={horizontal ? { left: `${zero}%` } : { bottom: `${zero}%` }} /><i className={`fxs-bar ${item.value < 0 ? 'is-negative' : ''}`} style={horizontal ? { left: `${(Math.min(0, item.value) - low) / span * 100}%`, width: `${Math.abs(item.value) / span * 100}%` } : { bottom: `${(Math.min(0, item.value) - low) / span * 100}%`, height: `${Math.abs(item.value) / span * 100}%` }} /></div><strong>{dashboardNumber(item.value)}</strong></div>)}
  </div> : <p className="fxs-chart-empty">{t("Chưa có dữ liệu giao dịch đóng.")}</p>}{horizontal && items.length > 12 && <small>{t("12 tháng gần nhất · đầy đủ tại Analytics")}</small>}</section>
}

function Metric({ title, value, detail }) {
  const { t } = useTestingLocale()

  return <div className="fxs-metric"><span title={detail}>{t(title)}</span><strong>{value}</strong></div>
}

export default function SessionPerformance({ model, payload, item, href, chartsOnly = false }) {
  const dashboardNumber = (value, suffix = '') => value == null || value === '' || typeof value === 'boolean' || !Number.isFinite(Number(value)) ? '—' : `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(Number(value))}${suffix}`
  const dashboardMoney = (value, currency) => fmt(value, ` ${currency || t('Đơn vị tài khoản')}`)

  const { t, locale, fmt } = useTestingLocale()

  const dateFormat = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', dateStyle: 'short', timeStyle: 'short' })
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
    {limited && <p role="status">{payload.stale || payload.freshness === 'stale' || payload.provenance?.freshness === 'stale' || payload.provenance?.status === 'stale' ? t("Dữ liệu chưa cập nhật.") : t("Dữ liệu một phần.")}{t("Kết quả chỉ phản ánh phạm vi nguồn đã đọc.")}</p>}
    {rows.length || chartsOnly ? <div className="fxs-charts">
      <section className="fxs-chart-panel"><h3>{t("Số dư từ lệnh đóng")}</h3><small>{currency || t("Đơn vị tài khoản")} {t("· không gồm lãi/lỗ thả nổi")}</small>{curve ? <svg className="fxs-balance-curve" viewBox="0 0 380 230" role="img" aria-label={t('Số dư từ lệnh đóng: {start} → {end}', { start: dashboardMoney(model.startBalance, currency), end: dashboardMoney(model.endingBalance, currency) })}>
        <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop stopColor="var(--wm-primary)" stopOpacity=".22" /><stop offset="1" stopColor="var(--wm-primary)" stopOpacity=".02" /></linearGradient></defs>
        {curve.ticks.map((tick, index) => <g key={index}><line x1="74" x2="342" y1={tick.y * .8} y2={tick.y * .8} className="fxs-gridline" /><text x="69" y={tick.y * .8 + 4} textAnchor="end">{dashboardNumber(tick.value + Number(model.metrics.starting_balance))}</text></g>)}
        <g transform="translate(50 0) scale(.3 .8)"><path d={`${curve.path} L ${curve.lastX} 250 L 80 250 Z`} fill={`url(#${gradientId})`} /><path d={curve.path} className="fxs-curve-path" /></g><circle cx={50 + curve.lastX * .3} cy={curve.lastY * .8} r="3" className="fxs-curve-dot" /><text x="74" y="213">{t("Bắt đầu")}</text><text x="342" y="213" textAnchor="end">{t("{count} lệnh đóng", { count: curve.count })}</text>
      </svg> : <p className="fxs-chart-empty">{t("Chưa có đường số dư được xác minh.")}</p>}</section>
      <PeriodBars title={t("Kết quả theo tháng")} items={periods.months} currency={currency} horizontal />
      <PeriodBars title={t("Kết quả theo thứ")} items={periods.weekdays} currency={currency} />
    </div> : <p className="fxs-no-analytics">{t("Chưa có phân tích giao dịch.")}</p>}
    {periods.incomplete && <p role="status">{t("Chưa đủ ngày đóng hoặc Net P/L để tính kết quả theo thời gian.")}</p>}
    {!chartsOnly && <><section className="fxs-metrics" aria-label={t("Chỉ số phiên")}>
      <Metric title={t("Total P/L")} value={dashboardMoney(model?.netPnl, currency)} detail={t("Net · giao dịch đóng")} />
      <Metric title={t("Win rate")} value={dashboardNumber(model?.winRate, '%')} detail={t('{wins} thắng · {losses} thua', { wins: dashboardNumber(model?.wins), losses: dashboardNumber(model?.losses) })} />
      <Metric title={t("Lời/lỗ trung bình")} value={dashboardNumber(model?.payoffRatio)} detail={t("Lãi TB / độ lớn lỗ TB · chưa biết nếu thiếu nguồn")} />
      <Metric title={t("P/L tháng")} value={dashboardMoney(periods.month, currency)} detail={anchor ? t("Tháng {month} · UTC", { month: anchor.slice(0, 7) }) : t("Chưa có ngày đóng")} />
      <Metric title={t("P/L tuần")} value={dashboardMoney(periods.week, currency)} detail={anchor ? t("Tuần T2–CN chứa {date} · UTC", { date: anchor }) : t("Chưa có ngày đóng")} />
      <Metric title={t("P/L ngày")} value={dashboardMoney(periods.day, currency)} detail={anchor ? `${anchor} · UTC` : t("Chưa có ngày đóng")} />
    </section>
    <section className="fxs-recent"><div className="fxs-section-heading"><h2>{t("Recent Trades")}</h2>{href && <a className="fxr-button fxr-button-secondary fxs-journal" href={href('journal')}><TestingIcon kind="journal" size={16} />{t("Journal")}</a>}</div>
      {rows.length ? <><div className="fxs-table-scroll" role="region" aria-label={t("Giao dịch gần đây")} tabIndex={0}><table><thead><tr><th>{t("Phiên / lệnh")}</th><th>{t("Đóng lệnh (UTC)")}</th><th>{t("Symbol")}</th><th>{t("Net P/L")}</th></tr></thead><tbody>{visible.map(trade => <tr key={trade.tradeId}><td>{model?.result?.preview ? <span>{item.name || item.record_id}<small>{trade.side ? t(String(trade.side).toLowerCase() === "buy" ? "Buy" : "Sell") : "—"}</small></span> : <a href={href('analytics', { trade: trade.tradeId })}>{item.name || item.record_id}<small>{trade.tradeId} · {trade.side ? t(String(trade.side).toLowerCase() === 'buy' ? 'Buy' : 'Sell') : '—'}</small></a>}</td><td>{closeTime(trade.close_time_utc) ? dateFormat.format(closeTime(trade.close_time_utc)) : '—'}</td><td>{trade.symbol || model.result?.instrument_id || '—'}</td><td className={trade.pnl > 0 ? 'is-positive' : trade.pnl < 0 ? 'is-negative' : ''}>{dashboardMoney(trade.pnl, currency)}</td></tr>)}</tbody></table></div>
      <div className="fxs-pagination"><label>{t("Số dòng")}<FxSelect label={t("Số dòng Recent Trades")} value={pageSize} onChange={value => { setPageSize(Number(value)); setPage(1) }} options={[5, 10, 20].map(size => ({ value: size, label: String(size) }))} /></label>{pages > 1 && <div><button className="fxr-button fxr-button-secondary" type="button" aria-label={t("Trang giao dịch trước")} disabled={current === 1} onClick={() => setPage(current - 1)}>‹</button><FxSelect label={t("Trang Recent Trades")} value={current} onChange={value => setPage(Number(value))} options={Array.from({ length: pages }, (_, index) => ({ value: index + 1, label: String(index + 1) }))} /><span>/ {pages}</span><button className="fxr-button fxr-button-secondary" type="button" aria-label={t("Trang giao dịch sau")} disabled={current === pages} onClick={() => setPage(current + 1)}>›</button></div>}</div></> : <div className="fxs-trades-empty" data-testid="session-trades-empty"><svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M10 12h28v24H10ZM10 20h28M16 27h8m-8 5h16" /></svg><h3>{t("Chưa có giao dịch đóng")}</h3><p>{!model ? t("Mở chart để bắt đầu phiên luyện tập.") : t("Giao dịch đã đóng sẽ xuất hiện tại đây.")}</p>{!model?.result?.preview && !item.archived && item.dataset_available && <SessionChartLink href={href('replay', { select: null, surface: 'workspace' })} />}</div>}
    </section></>}
  </section>
}
