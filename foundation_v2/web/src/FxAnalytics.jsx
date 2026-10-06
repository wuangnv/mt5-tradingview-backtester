import { useTestingLocale } from './testingLocale.jsx'
import { useEffect, useId, useMemo, useState } from 'react'
import { advancedAnalytics, known, number, outcomeOf } from './tradingAnalyticsModel.js'
import './fx-analytics.css'
import AnalyticsFilterBar from './AnalyticsFilterBar.jsx'
import LedgerFilterDrawer from './LedgerFilterDrawer.jsx'
import FxSelect from './FxSelect.jsx'

export const fmt = (value, suffix = '', digits = 2) => known(value) ? `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: digits }).format(Number(value))}${suffix}` : '—'
export function SelectField({ label, value, onChange, options, disabled }) {
  const { t } = useTestingLocale()

  return <label className="fxa-field"><span>{t(label)}</span><FxSelect label={label} value={value} onChange={onChange} disabled={disabled} options={options.map(([value, label]) => ({ value, label }))} /></label>
}
export function FxAnalyticsFilters({ filters, onChange, extra, onExtra, rows, onExport, pending, ledgerOnly, sessionControl, onClearSessions, columnControl, facets, persistInUrl, sourceType }) {
  if (!ledgerOnly) return <AnalyticsFilterBar {...{ filters, onChange, extra, onExtra, rows, onExport, pending, sessionControl, persistInUrl, sourceType }} />
  return <LedgerFilters {...{ filters, onChange, extra, onExtra, rows, onExport, pending, sessionControl, onClearSessions, columnControl, facets }} />
}
function LedgerFilters({ filters, onChange, extra, onExtra, rows, sessionControl, columnControl, facets }) {
  const { t } = useTestingLocale()

  const [drawer, setDrawer] = useState('')
  return <section className="fxa-filters" aria-label={t("Bộ lọc giao dịch")} data-testid="analytics-filters">
    <div className="fxa-filter-toolbar is-ledger">{sessionControl}<div className="fxa-filter-actions">{columnControl}{columnControl && <span className="fxa-filter-divider" aria-hidden="true" />}<span className="fxa-filter-label">{t("Filter by")}</span>{['Basic', 'Tags'].map(tab => <button key={tab} className="fxa-button" type="button" aria-haspopup="dialog" aria-expanded={drawer === tab} onClick={() => setDrawer(tab)}>{t(tab)}</button>)}</div></div>
    {drawer && <LedgerFilterDrawer initialTab={drawer} {...{ filters, extra, rows, facets }} onApply={(next, nextExtra) => { onChange(next); onExtra(nextExtra) }} onClose={() => setDrawer('')} />}
  </section>
}

export function Metric({ label, value, note, tone = '' }) {
  const { t } = useTestingLocale()

  return <div className={`fxa-metric ${tone}`}><span>{t(label)}</span><strong>{value}</strong>{note && <small>{t(note)}</small>}</div>
}
function Section({ title, note, children, actions, className = '' }) {
  const { t } = useTestingLocale()

  return <section className={`fxa-section ${className}`}><div className="fxa-section-heading"><div><h2>{t(title)}</h2>{note && <small>{t(note)}</small>}</div>{actions}</div>{children}</section>
}
export function AnalyticsCurve({ series, label, suffix = '', onSelect, selected, negative = false, closedTradeCount }) {


  const { t, fmt } = useTestingLocale()

  const id = useId().replaceAll(':', '')
  const [hover, setHover] = useState(null)
  const paths = series.filter(path => path.length).map(path => path.filter(point => known(point.value)))
  const all = paths.flat()
  if (!all.length) return <p className="fxa-empty">{t("Chưa có đường dữ liệu được xác minh.")}</p>
  const low = Math.min(...all.map(point => point.value)), high = Math.max(...all.map(point => point.value))
  const pad = (high - low || Math.abs(high) * .01 || 1) * .1
  const min = negative ? Math.min(0, low - pad) : low - pad, max = negative ? 0 : high + pad
  const span = max - min || 1, count = Math.max(...paths.map(path => path.length))
  const x = index => 80 + index / Math.max(1, count - 1) * 730
  const y = value => 240 - (value - min) / span * 220
  const point = paths.length === 1 && hover !== null ? paths[0][hover] : null
  const selectedIndex = paths.length === 1 ? paths[0].findIndex(point => point.tradeId === selected) : -1
  return <div className={`fxa-curve ${negative ? 'is-negative' : ''}`}><svg viewBox="0 0 840 280" role="img" aria-label={t(label)}>
    <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="currentColor" stopOpacity=".18" /><stop offset="100%" stopColor="currentColor" stopOpacity=".01" /></linearGradient></defs>
    {Array.from({ length: 5 }, (_, index) => { const value = min + (max - min) * index / 4; return <g key={index}><line x1="80" x2="810" y1={y(value)} y2={y(value)} className="fxa-gridline" /><text x="70" y={y(value) + 4} textAnchor="end">{fmt(value)}</text></g> })}
    {paths.map((path, index) => { const sampled = path.filter((_, at) => at === 0 || at === path.length - 1 || at % Math.max(1, Math.ceil(path.length / 240)) === 0); const d = sampled.map(point => `${x(path.indexOf(point))},${y(point.value)}`).join(' '); return <g key={index}>{paths.length === 1 && <polygon points={`80,240 ${d} ${x(path.length - 1)},240`} fill={`url(#${id})`} />}<polyline points={d} fill="none" stroke="currentColor" strokeWidth={paths.length === 1 ? 2 : 1} opacity={paths.length === 1 ? 1 : .35} /></g> })}
    {paths.length === 1 && <>{selectedIndex >= 0 && <circle cx={x(selectedIndex)} cy={y(paths[0][selectedIndex].value)} r="5" fill="currentColor" />}{point && <><line x1={x(hover)} x2={x(hover)} y1="20" y2="240" className="fxa-gridline" /><circle cx={x(hover)} cy={y(point.value)} r="4" fill="currentColor" /></>}<rect x="80" y="20" width="730" height="220" fill="transparent" onMouseMove={event => { const bounds = event.currentTarget.getBoundingClientRect(); setHover(Math.max(0, Math.min(count - 1, Math.round((event.clientX - bounds.left) / bounds.width * (count - 1))))) }} onMouseLeave={() => setHover(null)} onClick={() => point?.tradeId && onSelect?.(point.tradeId)} /></>}
    <text x="80" y="271">{t("Bắt đầu")}</text><text x="810" y="271" textAnchor="end">{t("{count} lệnh đóng", { count: closedTradeCount ?? count - 1 })}</text>
  </svg><div className="fxa-chart-mobile-scale"><span>{t("Thấp nhất")} {fmt(low, suffix)}</span><span>{t("Cao nhất")} {fmt(high, suffix)}</span><span>{t("Bắt đầu")}</span><span>{t("{count} lệnh đóng", { count: closedTradeCount ?? count - 1 })}</span></div><div className="fxa-chart-caption">{point ? t('Lệnh #{index} · {value}', { index: hover, value: fmt(point.value, suffix) }) : `${label} · ${suffix || t('Đơn vị tài khoản')}`}</div>{onSelect && <label className="fxa-chart-drilldown"><span>{t('Chi tiết điểm')}</span><FxSelect label="Chọn giao dịch trên biểu đồ" value={selected || ''} triggerContent={selected ? undefined : t('Chọn giao dịch')} onChange={onSelect} localizeOptions={false} options={paths[0].filter(point => point.tradeId).map(point => ({ value: point.tradeId, label: point.tradeId + ' · ' + fmt(point.value, suffix) }))} /></label>}</div>
}

function GroupBars({ items, metric = 'net', suffix = '', digits = 2, horizontal = false, label }) {
  const { t, fmt } = useTestingLocale()

  const values = items.map(item => number(item[metric]) ?? 0)
  const low = Math.min(0, ...values), high = Math.max(0, ...values), span = high - low || 1
  const zero = -low / span * 100
  return !items.length ? <p className="fxa-empty">{t("Chưa đủ ngày đóng và Net P/L.")}</p> : <div className={`fxa-bars ${horizontal ? 'is-horizontal' : ''}`} role="img" tabIndex={0} aria-label={`${label}: ${items.map(item => `${item.label} ${fmt(item[metric], suffix, digits)}`).join('; ')}`}>
    {items.map(item => { const value = number(item[metric]); return <div className="fxa-bar-item" key={item.label}><span>{t(item.label)}</span><div className="fxa-bar-track"><i className="fxa-bar-zero" style={horizontal ? { left: `${zero}%` } : { bottom: `${zero}%` }} /><i className={`fxa-bar-fill ${value < 0 ? 'is-negative' : ''}`} style={horizontal ? { left: `${(Math.min(0, value || 0) - low) / span * 100}%`, width: `${Math.abs(value || 0) / span * 100}%` } : { bottom: `${(Math.min(0, value || 0) - low) / span * 100}%`, height: `${Math.abs(value || 0) / span * 100}%` }} /></div><strong>{fmt(value, suffix, digits)}</strong></div> })}
  </div>
}
function SideBreakdown({ data }) {
  const { t, fmt } = useTestingLocale()

  const total = data.side.reduce((sum, item) => sum + item.count, 0) + data.unknownSide
  const buy = total ? data.side[0].count / total * 100 : 0, sell = total ? data.side[1].count / total * 100 : 0
  return <div className="fxa-side-grid"><div className="fxa-donut" style={{ background: `conic-gradient(var(--report-positive) 0% ${buy}%, var(--report-blue) ${buy}% ${buy + sell}%, var(--wm-border) ${buy + sell}% 100%)` }} role="img" aria-label={`Buy ${data.side[0].count}, Sell ${data.side[1].count}, chưa rõ ${data.unknownSide}`}><span><strong>{total}</strong><small>{t("giao dịch")}</small></span></div><div className="fxa-side-table">{data.side.map(item => <div key={item.label}><strong>{item.label}</strong><span>{t("{count} lệnh", { count: item.count })}</span><span>{fmt(item.winRate, '%')} {t("thắng")}</span><span>{fmt(item.net)}</span></div>)}{data.unknownSide > 0 && <p>{data.unknownSide} {t("lệnh chưa có side.")}</p>}</div></div>
}
function PerformanceCalendar({ items, timezone, currency }) {


  const { t, fmt } = useTestingLocale()

  const available = [...new Set(items.map(item => item.label.slice(0, 7)))].sort()
  const [chosen, setChosen] = useState('')
  const month = available.includes(chosen) ? chosen : available.at(-1)
  if (!month) return <p className="fxa-empty">{t("Chưa có lịch giao dịch.")}</p>
  const [year, m] = month.split('-').map(Number), days = new Date(Date.UTC(year, m, 0)).getUTCDate(), offset = (new Date(Date.UTC(year, m - 1, 1)).getUTCDay() + 6) % 7
  return <><SelectField label={t("Tháng trên lịch")} value={month} onChange={setChosen} options={available.map(value => [value, value])} /><div className="fxa-calendar" role="group" aria-label={t("Lịch performance {month}, {timezone}", { month: month, timezone: timezone })}>
    {['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].map(day => <span className="fxa-calendar-weekday" key={day}>{t(day)}</span>)}{Array.from({ length: offset }, (_, index) => <span aria-hidden="true" key={`empty-${index}`} />)}
    {Array.from({ length: days }, (_, index) => { const day = index + 1, item = items.find(item => item.label === `${month}-${String(day).padStart(2, '0')}`); return <div key={day} className={`fxa-calendar-day ${item?.net > 0 ? 'is-positive' : item?.net < 0 ? 'is-negative' : ''}`}><span>{day}</span>{item ? <><strong>{fmt(item.net)}</strong><small>{t("{count} lệnh", { count: item.count })}</small></> : <small>—</small>}</div> })}
  </div><small>{currency || t("Đơn vị tài khoản")} {t("· ngày đóng theo")} {timezone} {t("· — = không có lệnh trong phạm vi đã chọn")}</small></>
}

function OutcomeStats({ data, currency }) {


  const { t, fmt } = useTestingLocale()

  return <div className="fxa-two-columns">{[['Winners', 'win', data.wins, data.averageWin, data.bestWin, data.winDuration, data.maxWinStreak], ['Losers', 'loss', data.losses, data.averageLoss, data.worstLoss, data.lossDuration, data.maxLossStreak]].map(([label, type, count, average, best, duration, streak]) => <article className={`fxa-outcomes is-${type}`} key={type}><h3>{t(label)}</h3><dl><div><dt>{t("Tổng lệnh")}</dt><dd>{fmt(count, '', 0)}</dd></div><div><dt>{type === 'win' ? t("Lãi lớn nhất") : t("Lỗ lớn nhất")}</dt><dd>{fmt(best, ` ${currency}`)}</dd></div><div><dt>{t("Trung bình")}</dt><dd>{fmt(average, ` ${currency}`)}</dd></div><div><dt>{t("Thời gian giữ trung bình")}</dt><dd>{fmt(duration, t(" phút"))}</dd></div><div><dt>{t("Chuỗi dài nhất")}</dt><dd>{fmt(streak, t(" lệnh"), 0)}</dd></div></dl></article>)}</div>
}

export function AnalyticsPerformance({ model, data, extra, onSelect, selected }) {


  const { t, locale, fmt } = useTestingLocale()

  const [metric, setMetric] = useState('net')
  const [basis, setBasis] = useState('balance')
  const currency = model.result?.account_currency || t('Đơn vị tài khoản')
  const suffix = metric === 'winRate' ? '%' : metric === 'net' ? ` ${currency}` : ''
  const curve = basis === 'balance' ? data.curve : data.curve.map(point => ({ ...point, value: point.value - Number(model.startBalance) }))
  const averagePayoff = data.averageLoss ? data.averageWin / Math.abs(data.averageLoss) : null
  return <div className="fxa-report" data-testid="analytics-performance">
    <Section title={t("Profit and loss")} note={data.localFiltered || model.result?.scope?.active_filters ? t("Lệnh đã lọc, tính từ vốn ban đầu · không phải lịch sử tài khoản") : t("Balance từ lệnh đóng · không gồm floating P/L")} actions={<SelectField label={t("Biểu đồ")} value={basis} onChange={setBasis} options={[["balance", 'Balance'], ['profit', 'Net P/L']]} />}>
      <div className="fxa-metrics"><Metric label={t("Total P/L")} value={fmt(data.net, ` ${currency}`)} tone={data.net < 0 ? 'is-negative' : 'is-positive'} /><Metric label={t("Closed balance")} value={fmt(data.endingBalance, ` ${currency}`)} /><Metric label={t("Win rate")} value={fmt(data.winRate, '%')} /><Metric label={t("Total trades")} value={fmt(data.count, '', 0)} /><Metric label={t("Breakeven")} value={fmt(data.breakeven, t(" lệnh"), 0)} /></div>
      <AnalyticsCurve series={[curve]} label={basis === 'balance' ? t("Balance sau lệnh đóng") : t("Net P/L tích lũy")} suffix={` ${currency}`} selected={selected} onSelect={onSelect} />
    </Section>
    <div className="fxa-metrics fxa-stat-row"><Metric label={t("Average realized R")} value={fmt(data.averageR, t(" R"))} note={t("{readable}/{total} lệnh có risk", { readable: data.rCount, total: data.count })} /><Metric label={t("Max realized R")} value={fmt(data.maxR, t(" R"))} /><Metric label={t("Lãi/lỗ trung bình")} value={fmt(averagePayoff)} note={t("Lãi TB / độ lớn lỗ TB")} /></div>
    <Section title={t("Expectancy & Profit factor")}><div className="fxa-metrics"><Metric label={t("Expectancy")} value={fmt(data.expectancy, ` ${currency} / ${t("lệnh")}`)} note={t("Net P/L / số lệnh đóng")} /><Metric label={t("Profit factor")} value={fmt(data.profitFactor)} note={!data.losses ? t("Chưa có tổng lỗ để chia") : t("Tổng lãi net / độ lớn tổng lỗ net")} /></div></Section>
    <Section title={t("Winners and losers")}><OutcomeStats data={data} currency={currency} /></Section>
    <Section title={t("Performance by side")} note={`Net · ${currency}`}><SideBreakdown data={data} /></Section>
    <Section title={t("Performance by session")} note={t("Các khoảng giờ đóng cố định theo UTC; không điều chỉnh DST")}><div className="fxa-metrics">{data.sessions.map(item => <Metric key={item.label} label={`${item.label} UTC`} value={fmt(item.net, ` ${currency}`)} note={`${t("{count} lệnh", { count: item.count })} · ${fmt(item.winRate, "%")} ${t("thắng")}`} />)}</div>{!data.sessions.length && <p className="fxa-empty">{t("Chưa đủ thời gian đóng lệnh.")}</p>}</Section>
    <div className="fxa-section-heading fxa-time-metric"><small>{t("Phân tích theo ngày đóng · {timezone}", { timezone: extra.timezone })}</small><SelectField label={t("Chỉ số theo thời gian")} value={metric} onChange={setMetric} options={[["net", 'Net P/L'], ['winRate', 'Win rate'], ['count', 'Số giao dịch']]} /></div>
    <Section title={t("Performance by time")}><GroupBars items={data.hours} metric={metric} suffix={suffix} label={t("Performance by time")} /></Section>
    <div className="fxa-two-columns"><Section title={t("Performance by day")}><GroupBars items={data.weekdays} metric={metric} suffix={suffix} horizontal label={t("Performance by day")} /></Section><Section title={t("Performance by month")}><GroupBars items={data.months} metric={metric} suffix={suffix} horizontal label={t("Performance by month")} /></Section></div>
    <Section title={t("Performance calendar")}><PerformanceCalendar items={data.calendar} timezone={extra.timezone} currency={currency} /></Section>
    <Section title={t("Average trade frequency")} note={t("Tính cả kỳ không có lệnh giữa ngày đóng đầu/cuối trong phạm vi đã chọn")}><div className="fxa-metrics">{data.frequency.map(item => <Metric key={item.label} label={`${t('Lệnh')} / ${t(item.label).toLocaleLowerCase(locale)}`} value={fmt(item.count)} />)}</div>{!data.frequency.length && <p className="fxa-empty">{t("Chưa đủ ngày để tính tần suất.")}</p>}</Section>
  </div>
}

export function AnalyticsDrawdown({ model, data, experiments, experimentStatus }) {


  const { t, fmt } = useTestingLocale()

  const currency = model.result?.account_currency || t('Đơn vị tài khoản')
  const rows = (experiments?.rows || []).filter(row => data.rows.some(trade => trade.tradeId === row.trade_id))
  const mae = rows.filter(row => known(row.excursion?.mae_price)).map(row => ({ label: row.trade_id.slice(-8), net: -Number(row.excursion.mae_price) }))
  const winningExcursions = rows.filter(row => known(row.excursion?.mae_price) && data.rows.some(trade => trade.tradeId === row.trade_id && outcomeOf(trade.pnl) === 'win')).map(row => Number(row.excursion.mae_price))
  return <div className="fxa-report" data-testid="analytics-drawdown">
    <Section title={t("Drawdown on closed balance")} note={t("Peak-to-trough sau lệnh đóng; chưa phải drawdown trên equity thả nổi")}><AnalyticsCurve series={[data.drawdown.map(point => ({ value: -point.drawdown }))]} closedTradeCount={data.count} label={t("Drawdown sau lệnh đóng")} suffix={` ${currency}`} negative /><div className="fxa-metrics"><Metric label={t("Max drawdown")} value={fmt(data.maxDrawdown, ` ${currency}`)} note={fmt(data.maxDrawdownPct, '%')} /><Metric label={t("Average drawdown")} value={fmt(data.averageDrawdown, ` ${currency}`)} note={t("Chỉ lấy các điểm dưới đỉnh")} /><Metric label={t("Recovery")} value={fmt(data.recoveryTrades, t(" lệnh"))} note={data.unrecovered ? t("Còn {count} lệnh chưa hồi đỉnh", { count: data.unrecovered }) : t("Trung bình các chu kỳ đã phục hồi")} /><Metric label={t("Drawdown frequency")} value={fmt(data.episodes, t(" đợt"), 0)} /></div></Section>
    <Section title={t("Maximum Adverse Excursion")} note={t("Biên giá bất lợi quan sát được trong lệnh; nến đóng intrabar bị loại để tránh dùng giá sau khi thoát")}>
      {mae.length ? <><GroupBars items={mae.slice(0, 50)} label={t("Observed adverse excursion")} digits={6} horizontal /><small>{mae.length} {t("lệnh có biên quan sát · tối đa 50 dòng · đơn vị giá, không phải tiền")}</small></> : <p className="fxa-empty">{experimentStatus === 'loading' ? t("Đang đọc đường giá…") : t("Nguồn chưa đủ đường giá để đo excursion.")}</p>}
    </Section>
    <Section title={t("Drawdown on winning trades")} note={t("Biên bất lợi quan sát của những lệnh có Net P/L > 0")}><div className="fxa-metrics"><Metric label={t("Lệnh thắng có đường giá")} value={fmt(winningExcursions.length, t(" lệnh"), 0)} /><Metric label={t("Max adverse price")} value={fmt(winningExcursions.length ? Math.max(...winningExcursions) : null, '', 6)} note={t("Lower bound khi chưa có thứ tự intrabar")} /></div></Section>
  </div>
}

export function AnalyticsSimulation({ model, data, experiments, experimentStatus, experimentError, config, onConfig }) {


  const { t, fmt } = useTestingLocale()

  const currency = model.result?.account_currency || t('Đơn vị tài khoản')
  const initialConfig = () => ({ method: 'ledger', simulations: 200, trades: Math.max(1, Math.min(200, data.count)), capital: number(model.startBalance) ?? 100000, averageWin: data.averageWin ?? 100, averageLoss: Math.abs(data.averageLoss ?? 100), winRate: data.winRate ?? 50, seed: 42 })
  const [mc, setMc] = useState(initialConfig), [result, setResult] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState(config)
  useEffect(() => { setDraft(config) }, [config])
  const scenarioRows = (experiments?.rows || []).filter(row => data.rows.some(trade => trade.tradeId === row.trade_id))
  const run = async event => { event.preventDefault(); setError(''); setBusy(true); try { const { monteCarlo } = await import('./analyticsSimulation.js'); setResult(monteCarlo(mc, data.rows)) } catch (err) { setError(err.message); setResult(null) } finally { setBusy(false) } }
  const dirty = result && JSON.stringify(result.config) !== JSON.stringify(mc)
  const scenario = (key, title) => { const available = scenarioRows.filter(row => known(row[key]?.net_pnl)); return <Section title={title} note={t("What-if offline trong thời gian giữ lệnh gốc · không sửa kết quả đã lưu")}><div className="fxa-metrics"><Metric label={t("Lệnh tính được")} value={`${available.length}/${data.count}`} /><Metric label={t("Scenario net P/L")} value={fmt(available.length ? available.reduce((sum, row) => sum + Number(row[key].net_pnl), 0) : null, ` ${currency}`)} note={available.length !== data.count ? t("Chỉ mẫu tính được, không phải tổng toàn phiên") : t("Toàn bộ lệnh trong phạm vi")} /></div>{experimentStatus === 'loading' ? <p role="status">{t("Đang mô phỏng từ đường giá…")}</p> : experimentError ? <p role="alert">{t(experimentError)}</p> : <details className="fxa-scenario-details"><summary>{t("Kết quả từng lệnh và phạm vi tính")}</summary><div className="fxa-table-scroll" tabIndex={0} role="region" aria-label={`${title} chi tiết`}><table><thead><tr><th>{t("Lệnh")}</th><th>{t("Trạng thái")}</th><th>{t("Giá thoát")}</th><th>{t("Net P/L")}</th></tr></thead><tbody>{scenarioRows.map(row => <tr key={row.trade_id}><td>{row.trade_id}</td><td>{row[key]?.status || t("Không đủ dữ liệu")}<small>{row[key]?.reason || row[key]?.blocked_reason}</small></td><td>{fmt(row[key]?.exit_price, '', 6)}</td><td>{fmt(row[key]?.net_pnl)}</td></tr>)}</tbody></table></div></details>}</Section> }
  return <div className="fxa-report" data-testid="analytics-simulation">
    <form className="fxa-simulator-config" onSubmit={event => { event.preventDefault(); onConfig(draft) }}><label className="fxa-field"><span>{t("Stop distance (ticks)")}</span><input aria-label={t("Stop distance (ticks)")} type="number" min="1" max="100000" required value={draft.stop_distance_ticks} onChange={event => setDraft({ ...draft, stop_distance_ticks: event.target.value })} /></label><label className="fxa-field"><span>{t("Stop multiplier")}</span><input aria-label={t("Stop multiplier")} type="number" min="0.1" max="10" step="0.1" required value={draft.stop_multiplier} onChange={event => setDraft({ ...draft, stop_multiplier: event.target.value })} /></label><label className="fxa-field"><span>{t("Target R")}</span><input aria-label={t("Target R")} type="number" min="0.1" max="100" step="0.1" required value={draft.target_r} onChange={event => setDraft({ ...draft, target_r: event.target.value })} /></label><button className="fxa-button is-primary" type="submit" disabled={Boolean(model.result?.preview)} title={model.result?.preview ? t("Mẫu này chưa có đường giá để tính SL / RR") : undefined}>{t("Chạy SL / RR")}</button><small>{t("Stop cấu hình là giả định mới, không phải SL gốc. Trường hợp SL và TP cùng nến giữ “ambiguous”.")}</small></form>
    {scenario('stop_loss', 'Stop Loss Simulator')}{scenario('risk_reward', 'RR Simulator')}
    <Section title={t("Monte Carlo Simulation")} note={t("Kịch bản ngẫu nhiên có seed · độc lập giữa các lệnh · vốn về 0 thì dừng giao dịch")}>
      <form onSubmit={run} className="fxa-monte-form"><SelectField label={t("Phương pháp")} value={mc.method} onChange={value => setMc({ ...mc, method: value })} options={[["ledger", 'Lấy mẫu Net P/L từ ledger'], ['configured', 'Win / loss cấu hình']]} />{[['simulations', 'Số lượt mô phỏng', 1, 1000, 1], ['trades', 'Lệnh mỗi lượt', 1, 1000, 1], ['capital', t("Vốn ban đầu ({currency})", { currency: currency }), .01, undefined, .01], ['seed', 'Seed', 0, 4294967295, 1], ...(mc.method === 'configured' ? [['averageWin', 'Lãi trung bình', 0, undefined, .01], ['averageLoss', 'Độ lớn lỗ trung bình', 0, undefined, .01], ['winRate', 'Win rate (%)', 0, 100, .01]] : [])].map(([key, label, min, max, step]) => <label className="fxa-field" key={key}><span>{t(label)}</span><input aria-label={t(label)} type="number" min={min} max={max} step={step} required value={mc[key]} onChange={event => setMc({ ...mc, [key]: event.target.value })} /></label>)}<div className="fxa-form-actions"><button className="fxa-button" type="button" onClick={() => { setMc(initialConfig()); setResult(null); setError('') }}>{t("Đặt lại cấu hình")}</button><button className="fxa-button is-primary" type="submit" disabled={busy}>{busy ? t("Đang tính…") : t("Chạy Monte Carlo")}</button></div></form>
      {error && <p role="alert" className="fxa-error">{t(error)}</p>}{dirty && <p role="status">{t("Cấu hình đã đổi; chạy lại để cập nhật kết quả.")}</p>}{result ? <><AnalyticsCurve series={result.paths.map(path => path.map(value => ({ value })))} label={t("Monte Carlo · {runs} lượt · seed {seed}", { runs: result.config.simulations, seed: result.config.seed })} suffix={` ${currency}`} /><div className="fxa-metrics"><Metric label={t("Average balance")} value={fmt(result.average, ` ${currency}`)} /><Metric label={t("P05 / Median / P95")} value={`${fmt(result.p05)} / ${fmt(result.median)} / ${fmt(result.p95)}`} /><Metric label={t("Worst drawdown")} value={fmt(result.maxDD, ` ${currency}`)} /><Metric label={t("Xác suất kết thúc có lãi")} value={fmt(result.probabilityProfit, '%')} /><Metric label={t("Tỷ lệ cạn vốn")} value={fmt(result.ruinRate, '%')} /></div><small>{t("Hiển thị tối đa 30 đường; thống kê tính trên tất cả")} {result.config.simulations} {t("lượt. Không dự báo lợi nhuận tương lai.")}</small></> : <p className="fxa-empty">{t("Chọn phương pháp và chạy mô phỏng để xem phân phối kết quả.")}</p>}
    </Section>
  </div>
}

export function FxAnalyticsReport({ model, extra, experiments, experimentStatus, experimentError, config, onConfig, selected, onSelect, onTabChange }) {
  const { t } = useTestingLocale()

  const data = useMemo(() => advancedAnalytics(model, extra), [model, extra])
  const [tab, setTab] = useState(() => { const tab = new URLSearchParams(window.location.search).get('analytics_tab'); return ['performance', 'drawdown', 'simulation'].includes(tab) ? tab : 'performance' })
  const choose = value => { setTab(value); onTabChange?.(value); if (model.result?.preview) return; const url = new URL(window.location.href); url.searchParams.set('analytics_tab', value); window.history.replaceState({}, '', url) }
  return <><div className="fxa-report-tabs" role="tablist" aria-label={t("Phân tích")}><>{[['performance', 'Performance'], ['drawdown', 'Drawdown'], ['simulation', 'Simulation']].map(([value, label]) => <button className="fxa-tab" id={`fxa-tab-${value}`} role="tab" key={value} aria-selected={tab === value} aria-controls="fxa-report-panel" tabIndex={tab === value ? 0 : -1} onKeyDown={event => { const tabs = ['performance', 'drawdown', 'simulation']; if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const index = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (tabs.indexOf(tab) + (event.key === 'ArrowRight' ? 1 : 2)) % 3; choose(tabs[index]); document.getElementById(`fxa-tab-${tabs[index]}`)?.focus() } }} onClick={() => choose(value)}>{t(label)}</button>)}</></div><div id="fxa-report-panel" role="tabpanel" aria-labelledby={`fxa-tab-${tab}`} tabIndex={0}>{tab === 'performance' ? <AnalyticsPerformance model={model} data={data} extra={extra} onSelect={onSelect} selected={selected} /> : tab === 'drawdown' ? <AnalyticsDrawdown model={model} data={data} experiments={experiments} experimentStatus={experimentStatus} /> : <AnalyticsSimulation key={JSON.stringify([model.result?.session_id, model.result?.revision, model.result?.cursor_index, model.result?.execution_event_sequence, model.result?.filters, extra])} model={model} data={data} experiments={experiments} experimentStatus={experimentStatus} experimentError={experimentError} config={config} onConfig={onConfig} />}</div></>
}
