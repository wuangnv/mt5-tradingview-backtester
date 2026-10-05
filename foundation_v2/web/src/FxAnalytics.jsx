import React, { useEffect, useId, useMemo, useState } from 'react'
import { advancedAnalytics, DEFAULT_EXTRA_FILTERS, known, monteCarlo, number, outcomeOf, WEEKDAYS } from './tradingAnalyticsModel.js'
import './fx-analytics.css'

export const fmt = (value, suffix = '', digits = 2) => known(value) ? `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: digits }).format(Number(value))}${suffix}` : '—'
export function SelectField({ label, value, onChange, options, disabled }) {
  return <label className="fxa-field"><span>{label}</span><select aria-label={label} value={value} onChange={event => onChange(event.target.value)} disabled={disabled}><button type="button" inert><selectedcontent /></button>{options.map(([key, text]) => <option value={key} key={key}>{text}</option>)}</select></label>
}
export function FxAnalyticsFilters({ filters, onChange, extra, onExtra, rows, onExport, pending, ledgerOnly, sessionControl, onClearSessions }) {
  const unique = key => [...new Set(rows.flatMap(row => key === 'tags' ? row.tags || [] : row[key] ? [row[key]] : []))].sort()
  const [basic, setBasic] = useState(!ledgerOnly)
  const [tags, setTags] = useState(false)
  const [searchOpen, setSearchOpen] = useState(!ledgerOnly || Boolean(extra.search))
  const clear = () => { onChange({ side: 'all', outcome: 'all', from: '', to: '' }); onExtra(DEFAULT_EXTRA_FILTERS); onClearSessions?.() }
  return <section className="fxa-filters" aria-label="Bộ lọc analytics" data-testid="analytics-filters">
    <div className={`fxa-filter-toolbar${ledgerOnly ? ' is-ledger' : ''}`}>{ledgerOnly && sessionControl}{searchOpen && <label className="fxa-search"><span className="sr-only">Tìm giao dịch</span><input type="search" placeholder="Tìm giao dịch, symbol…" aria-label="Tìm giao dịch" value={extra.search} onChange={event => onExtra({ search: event.target.value })} /></label>}{ledgerOnly && <button type="button" className="fxa-button fxa-icon-button" aria-label="Mở tìm giao dịch" title="Tìm giao dịch" aria-expanded={searchOpen} onClick={() => setSearchOpen(!searchOpen)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="10" cy="10" r="6" /><path d="m15 15 6 6" /></svg></button>}<div className="fxa-filter-actions"><button className="fxa-button fxa-icon-button" type="button" aria-label="Xóa lọc" title="Xóa lọc" onClick={clear}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M4 11a8 8 0 1 1 2 7M4 4v7h7" /></svg></button><button className="fxa-button fxa-icon-button" type="button" aria-label="Xuất CSV" title={pending ? 'Đang tạo CSV…' : 'Xuất CSV'} disabled={pending} onClick={onExport}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5" /></svg></button>{ledgerOnly && <><span className="fxa-filter-label">Filter by</span><button className="fxa-button" type="button" aria-expanded={basic} aria-controls="fxa-basic-filters" onClick={() => setBasic(!basic)}>Basic{filters.side !== 'all' || filters.outcome !== 'all' || extra.asset !== 'all' || filters.from || filters.to ? ' •' : ''}</button><button className="fxa-button" type="button" aria-expanded={tags} aria-controls="fxa-tag-filters" onClick={() => setTags(!tags)}>Tags{extra.tag !== 'all' ? ' •' : ''}</button></>}</div></div>
    {basic && <div className="fxa-filter-grid" id="fxa-basic-filters">
      {!ledgerOnly && sessionControl && <div className="fxa-field"><span>Session</span>{sessionControl}</div>}
      <SelectField label="Asset" value={extra.asset} onChange={value => onExtra({ asset: value })} options={[["all", 'Tất cả assets'], ...unique('symbol').map(value => [value, value])]} />
      <SelectField label="Side" value={filters.side} onChange={value => onChange({ side: value })} options={[["all", 'Tất cả sides'], ['buy', 'Buy'], ['sell', 'Sell']]} />
      <SelectField label="Outcome" value={filters.outcome} onChange={value => onChange({ outcome: value })} options={[["all", 'Tất cả kết quả'], ['win', 'Thắng'], ['loss', 'Thua'], ['breakeven', 'Hòa vốn']]} />
      {!ledgerOnly && <><SelectField label="Thứ đóng lệnh" value={extra.weekday} onChange={value => onExtra({ weekday: value })} options={[["all", 'Mọi thứ'], ...WEEKDAYS.map((value, index) => [String(index), value])]} /><SelectField label="Giờ đóng lệnh" value={extra.hour} onChange={value => onExtra({ hour: value })} options={[["all", 'Mọi giờ'], ...Array.from({ length: 24 }, (_, hour) => [String(hour), `${String(hour).padStart(2, '0')}:00–${String(hour).padStart(2, '0')}:59`])]} /><SelectField label="Timezone" value={extra.timezone} onChange={value => onExtra({ timezone: value })} options={[["UTC", 'UTC'], ['Asia/Ho_Chi_Minh', 'Asia/Ho_Chi_Minh'], ['America/New_York', 'America/New_York'], ['Europe/London', 'Europe/London']]} /></>}
      <label className="fxa-field"><span>Từ ngày đóng (UTC)</span><input aria-label="Analytics from date" type="date" value={filters.from} onChange={event => onChange({ from: event.target.value })} /></label><label className="fxa-field"><span>Đến ngày đóng (UTC)</span><input aria-label="Analytics to date" type="date" value={filters.to} onChange={event => onChange({ to: event.target.value })} /></label>
      {!ledgerOnly && <SelectField label="Tags" value={extra.tag} onChange={value => onExtra({ tag: value })} options={[["all", 'Tất cả tags'], ...unique('tags').map(value => [value, value])]} />}
    </div>}
    {tags && <div id="fxa-tag-filters" className="fxa-tags"><SelectField label="Tags" value={extra.tag} onChange={value => onExtra({ tag: value })} options={[["all", 'Tất cả tags'], ...unique('tags').map(value => [value, value])]} />{!unique('tags').length && <span>Ledger chưa có tag. Gắn ghi chú qua Journal của từng giao dịch.</span>}</div>}
  </section>
}

export function Metric({ label, value, note, tone = '' }) {
  return <div className={`fxa-metric ${tone}`}><span>{label}</span><strong>{value}</strong>{note && <small>{note}</small>}</div>
}
function Section({ title, note, children, actions, className = '' }) {
  return <section className={`fxa-section ${className}`}><div className="fxa-section-heading"><div><h2>{title}</h2>{note && <small>{note}</small>}</div>{actions}</div>{children}</section>
}
export function AnalyticsCurve({ series, label, suffix = '', onSelect, selected, negative = false, closedTradeCount }) {
  const id = useId().replaceAll(':', '')
  const [hover, setHover] = useState(null)
  const paths = series.filter(path => path.length).map(path => path.filter(point => known(point.value)))
  const all = paths.flat()
  if (!all.length) return <p className="fxa-empty">Chưa có đường dữ liệu được xác minh.</p>
  const low = Math.min(...all.map(point => point.value)), high = Math.max(...all.map(point => point.value))
  const pad = (high - low || Math.abs(high) * .01 || 1) * .1
  const min = negative ? Math.min(0, low - pad) : low - pad, max = negative ? 0 : high + pad
  const span = max - min || 1, count = Math.max(...paths.map(path => path.length))
  const x = index => 80 + index / Math.max(1, count - 1) * 730
  const y = value => 240 - (value - min) / span * 220
  const point = paths.length === 1 && hover !== null ? paths[0][hover] : null
  const selectedIndex = paths.length === 1 ? paths[0].findIndex(point => point.tradeId === selected) : -1
  return <div className={`fxa-curve ${negative ? 'is-negative' : ''}`}><svg viewBox="0 0 840 280" role="img" aria-label={label}>
    <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="currentColor" stopOpacity=".18" /><stop offset="100%" stopColor="currentColor" stopOpacity=".01" /></linearGradient></defs>
    {Array.from({ length: 5 }, (_, index) => { const value = min + (max - min) * index / 4; return <g key={index}><line x1="80" x2="810" y1={y(value)} y2={y(value)} className="fxa-gridline" /><text x="70" y={y(value) + 4} textAnchor="end">{fmt(value)}</text></g> })}
    {paths.map((path, index) => { const sampled = path.filter((_, at) => at === 0 || at === path.length - 1 || at % Math.max(1, Math.ceil(path.length / 240)) === 0); const d = sampled.map(point => `${x(path.indexOf(point))},${y(point.value)}`).join(' '); return <g key={index}>{paths.length === 1 && <polygon points={`80,240 ${d} ${x(path.length - 1)},240`} fill={`url(#${id})`} />}<polyline points={d} fill="none" stroke="currentColor" strokeWidth={paths.length === 1 ? 2 : 1} opacity={paths.length === 1 ? 1 : .35} /></g> })}
    {paths.length === 1 && <>{selectedIndex >= 0 && <circle cx={x(selectedIndex)} cy={y(paths[0][selectedIndex].value)} r="5" fill="currentColor" />}{point && <><line x1={x(hover)} x2={x(hover)} y1="20" y2="240" className="fxa-gridline" /><circle cx={x(hover)} cy={y(point.value)} r="4" fill="currentColor" /></>}<rect x="80" y="20" width="730" height="220" fill="transparent" onMouseMove={event => { const bounds = event.currentTarget.getBoundingClientRect(); setHover(Math.max(0, Math.min(count - 1, Math.round((event.clientX - bounds.left) / bounds.width * (count - 1))))) }} onMouseLeave={() => setHover(null)} onClick={() => point?.tradeId && onSelect?.(point.tradeId)} /></>}
    <text x="80" y="271">Bắt đầu</text><text x="810" y="271" textAnchor="end">{closedTradeCount ?? count - 1} lệnh đóng</text>
  </svg><div className="fxa-chart-mobile-scale"><span>Thấp nhất {fmt(low, suffix)}</span><span>Cao nhất {fmt(high, suffix)}</span><span>Bắt đầu</span><span>{closedTradeCount ?? count - 1} lệnh đóng</span></div><div className="fxa-chart-caption">{point ? `Lệnh #${hover} · ${fmt(point.value, suffix)}` : `${label} · ${suffix || 'đơn vị tài khoản'}`}</div>{onSelect && <label className="fxa-chart-drilldown">Chi tiết điểm<select aria-label="Chọn giao dịch trên biểu đồ" value={selected || ''} onChange={event => onSelect(event.target.value)}><button type="button" inert><selectedcontent /></button><option value="">Chọn giao dịch</option>{paths[0].filter(point => point.tradeId).map(point => <option key={point.tradeId} value={point.tradeId}>{point.tradeId} · {fmt(point.value, suffix)}</option>)}</select></label>}</div>
}

function GroupBars({ items, metric = 'net', suffix = '', digits = 2, horizontal = false, label }) {
  const values = items.map(item => number(item[metric]) ?? 0)
  const low = Math.min(0, ...values), high = Math.max(0, ...values), span = high - low || 1
  const zero = -low / span * 100
  return !items.length ? <p className="fxa-empty">Chưa đủ ngày đóng và Net P/L.</p> : <div className={`fxa-bars ${horizontal ? 'is-horizontal' : ''}`} role="img" tabIndex={0} aria-label={`${label}: ${items.map(item => `${item.label} ${fmt(item[metric], suffix, digits)}`).join('; ')}`}>
    {items.map(item => { const value = number(item[metric]); return <div className="fxa-bar-item" key={item.label}><span>{item.label}</span><div className="fxa-bar-track"><i className="fxa-bar-zero" style={horizontal ? { left: `${zero}%` } : { bottom: `${zero}%` }} /><i className={`fxa-bar-fill ${value < 0 ? 'is-negative' : ''}`} style={horizontal ? { left: `${(Math.min(0, value || 0) - low) / span * 100}%`, width: `${Math.abs(value || 0) / span * 100}%` } : { bottom: `${(Math.min(0, value || 0) - low) / span * 100}%`, height: `${Math.abs(value || 0) / span * 100}%` }} /></div><strong>{fmt(value, suffix, digits)}</strong></div> })}
  </div>
}
function SideBreakdown({ data }) {
  const total = data.side.reduce((sum, item) => sum + item.count, 0) + data.unknownSide
  const buy = total ? data.side[0].count / total * 100 : 0, sell = total ? data.side[1].count / total * 100 : 0
  return <div className="fxa-side-grid"><div className="fxa-donut" style={{ background: `conic-gradient(var(--wm-positive) 0% ${buy}%, var(--wm-primary) ${buy}% ${buy + sell}%, var(--wm-border) ${buy + sell}% 100%)` }} role="img" aria-label={`Buy ${data.side[0].count}, Sell ${data.side[1].count}, chưa rõ ${data.unknownSide}`}><span><strong>{total}</strong><small>giao dịch</small></span></div><div className="fxa-side-table">{data.side.map(item => <div key={item.label}><strong>{item.label}</strong><span>{item.count} lệnh</span><span>{fmt(item.winRate, '%')} thắng</span><span>{fmt(item.net)}</span></div>)}{data.unknownSide > 0 && <p>{data.unknownSide} lệnh chưa có side.</p>}</div></div>
}
function PerformanceCalendar({ items, timezone, currency }) {
  const available = [...new Set(items.map(item => item.label.slice(0, 7)))].sort()
  const [chosen, setChosen] = useState('')
  const month = available.includes(chosen) ? chosen : available.at(-1)
  if (!month) return <p className="fxa-empty">Chưa có lịch giao dịch.</p>
  const [year, m] = month.split('-').map(Number), days = new Date(Date.UTC(year, m, 0)).getUTCDate(), offset = (new Date(Date.UTC(year, m - 1, 1)).getUTCDay() + 6) % 7
  return <><SelectField label="Tháng trên lịch" value={month} onChange={setChosen} options={available.map(value => [value, value])} /><div className="fxa-calendar" role="group" aria-label={`Lịch performance ${month}, ${timezone}`}>
    {['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].map(day => <span className="fxa-calendar-weekday" key={day}>{day}</span>)}{Array.from({ length: offset }, (_, index) => <span aria-hidden="true" key={`empty-${index}`} />)}
    {Array.from({ length: days }, (_, index) => { const day = index + 1, item = items.find(item => item.label === `${month}-${String(day).padStart(2, '0')}`); return <div key={day} className={`fxa-calendar-day ${item?.net > 0 ? 'is-positive' : item?.net < 0 ? 'is-negative' : ''}`}><span>{day}</span>{item ? <><strong>{fmt(item.net)}</strong><small>{item.count} lệnh</small></> : <small>—</small>}</div> })}
  </div><small>{currency || 'Đơn vị tài khoản'} · ngày đóng theo {timezone} · — = không có lệnh trong phạm vi đã chọn</small></>
}

function OutcomeStats({ data, currency }) {
  return <div className="fxa-two-columns">{[['Winners', 'win', data.wins, data.averageWin, data.bestWin, data.winDuration, data.maxWinStreak], ['Losers', 'loss', data.losses, data.averageLoss, data.worstLoss, data.lossDuration, data.maxLossStreak]].map(([label, type, count, average, best, duration, streak]) => <article className={`fxa-outcomes is-${type}`} key={type}><h3>{label}</h3><dl><div><dt>Tổng lệnh</dt><dd>{fmt(count, '', 0)}</dd></div><div><dt>{type === 'win' ? 'Lãi lớn nhất' : 'Lỗ lớn nhất'}</dt><dd>{fmt(best, ` ${currency}`)}</dd></div><div><dt>Trung bình</dt><dd>{fmt(average, ` ${currency}`)}</dd></div><div><dt>Thời gian giữ trung bình</dt><dd>{fmt(duration, ' phút')}</dd></div><div><dt>Chuỗi dài nhất</dt><dd>{fmt(streak, ' lệnh', 0)}</dd></div></dl></article>)}</div>
}

export function AnalyticsPerformance({ model, data, extra, onSelect, selected }) {
  const [metric, setMetric] = useState('net')
  const [basis, setBasis] = useState('balance')
  const currency = model.result?.account_currency || 'đơn vị tài khoản'
  const suffix = metric === 'winRate' ? '%' : metric === 'net' ? ` ${currency}` : ''
  const curve = basis === 'balance' ? data.curve : data.curve.map(point => ({ ...point, value: point.value - Number(model.startBalance) }))
  const averagePayoff = data.averageLoss ? data.averageWin / Math.abs(data.averageLoss) : null
  return <div className="fxa-report" data-testid="analytics-performance">
    <Section title="Profit and loss" note={data.localFiltered || model.result?.scope?.active_filters ? 'Lệnh đã lọc, tính từ vốn ban đầu · không phải lịch sử tài khoản' : 'Balance từ lệnh đóng · không gồm floating P/L'} actions={<SelectField label="Biểu đồ" value={basis} onChange={setBasis} options={[["balance", 'Balance'], ['profit', 'Net P/L']]} />}>
      <div className="fxa-metrics"><Metric label="Total P/L" value={fmt(data.net, ` ${currency}`)} tone={data.net < 0 ? 'is-negative' : 'is-positive'} /><Metric label="Closed balance" value={fmt(data.endingBalance, ` ${currency}`)} /><Metric label="Win rate" value={fmt(data.winRate, '%')} /><Metric label="Total trades" value={fmt(data.count, '', 0)} /><Metric label="Breakeven" value={fmt(data.breakeven, ' lệnh', 0)} /></div>
      <AnalyticsCurve series={[curve]} label={basis === 'balance' ? 'Balance sau lệnh đóng' : 'Net P/L tích lũy'} suffix={` ${currency}`} selected={selected} onSelect={onSelect} />
    </Section>
    <div className="fxa-metrics fxa-stat-row"><Metric label="Average realized R" value={fmt(data.averageR, ' R')} note={`${data.rCount}/${data.count} lệnh có risk`} /><Metric label="Max realized R" value={fmt(data.maxR, ' R')} /><Metric label="Lãi/lỗ trung bình" value={fmt(averagePayoff)} note="Lãi TB / độ lớn lỗ TB" /></div>
    <Section title="Expectancy & Profit factor"><div className="fxa-metrics"><Metric label="Expectancy" value={fmt(data.expectancy, ` ${currency} / lệnh`)} note="Net P/L / số lệnh đóng" /><Metric label="Profit factor" value={fmt(data.profitFactor)} note={!data.losses ? 'Chưa có tổng lỗ để chia' : 'Tổng lãi net / độ lớn tổng lỗ net'} /></div></Section>
    <Section title="Winners and losers"><OutcomeStats data={data} currency={currency} /></Section>
    <Section title="Performance by side" note={`Net · ${currency}`}><SideBreakdown data={data} /></Section>
    <Section title="Performance by session" note="Các khoảng giờ đóng cố định theo UTC; không điều chỉnh DST"><div className="fxa-metrics">{data.sessions.map(item => <Metric key={item.label} label={`${item.label} UTC`} value={fmt(item.net, ` ${currency}`)} note={`${item.count} lệnh · ${fmt(item.winRate, '%')} thắng`} />)}</div>{!data.sessions.length && <p className="fxa-empty">Chưa đủ thời gian đóng lệnh.</p>}</Section>
    <div className="fxa-section-heading fxa-time-metric"><small>Phân tích theo ngày đóng · {extra.timezone}</small><SelectField label="Chỉ số theo thời gian" value={metric} onChange={setMetric} options={[["net", 'Net P/L'], ['winRate', 'Win rate'], ['count', 'Số giao dịch']]} /></div>
    <Section title="Performance by time"><GroupBars items={data.hours} metric={metric} suffix={suffix} label="Performance by time" /></Section>
    <div className="fxa-two-columns"><Section title="Performance by day"><GroupBars items={data.weekdays} metric={metric} suffix={suffix} horizontal label="Performance by day" /></Section><Section title="Performance by month"><GroupBars items={data.months} metric={metric} suffix={suffix} horizontal label="Performance by month" /></Section></div>
    <Section title="Performance calendar"><PerformanceCalendar items={data.calendar} timezone={extra.timezone} currency={currency} /></Section>
    <Section title="Average trade frequency" note="Tính cả kỳ không có lệnh giữa ngày đóng đầu/cuối trong phạm vi đã chọn"><div className="fxa-metrics">{data.frequency.map(item => <Metric key={item.label} label={`Lệnh / ${item.label.toLowerCase()}`} value={fmt(item.count)} />)}</div>{!data.frequency.length && <p className="fxa-empty">Chưa đủ ngày để tính tần suất.</p>}</Section>
  </div>
}

export function AnalyticsDrawdown({ model, data, experiments, experimentStatus }) {
  const currency = model.result?.account_currency || 'đơn vị tài khoản'
  const rows = (experiments?.rows || []).filter(row => data.rows.some(trade => trade.tradeId === row.trade_id))
  const mae = rows.filter(row => known(row.excursion?.mae_price)).map(row => ({ label: row.trade_id.slice(-8), net: -Number(row.excursion.mae_price) }))
  const winningExcursions = rows.filter(row => known(row.excursion?.mae_price) && data.rows.some(trade => trade.tradeId === row.trade_id && outcomeOf(trade.pnl) === 'win')).map(row => Number(row.excursion.mae_price))
  return <div className="fxa-report" data-testid="analytics-drawdown">
    <Section title="Drawdown on closed balance" note="Peak-to-trough sau lệnh đóng; chưa phải drawdown trên equity thả nổi"><AnalyticsCurve series={[data.drawdown.map(point => ({ value: -point.drawdown }))]} closedTradeCount={data.count} label="Drawdown sau lệnh đóng" suffix={` ${currency}`} negative /><div className="fxa-metrics"><Metric label="Max drawdown" value={fmt(data.maxDrawdown, ` ${currency}`)} note={fmt(data.maxDrawdownPct, '%')} /><Metric label="Average drawdown" value={fmt(data.averageDrawdown, ` ${currency}`)} note="Chỉ lấy các điểm dưới đỉnh" /><Metric label="Recovery" value={fmt(data.recoveryTrades, ' lệnh')} note={data.unrecovered ? `Còn ${data.unrecovered} lệnh chưa hồi đỉnh` : 'Trung bình các chu kỳ đã phục hồi'} /><Metric label="Drawdown frequency" value={fmt(data.episodes, ' đợt', 0)} /></div></Section>
    <Section title="Maximum Adverse Excursion" note="Biên giá bất lợi quan sát được trong lệnh; nến đóng intrabar bị loại để tránh dùng giá sau khi thoát">
      {mae.length ? <><GroupBars items={mae.slice(0, 50)} label="Observed adverse excursion" digits={6} horizontal /><small>{mae.length} lệnh có biên quan sát · tối đa 50 dòng · đơn vị giá, không phải tiền</small></> : <p className="fxa-empty">{experimentStatus === 'loading' ? 'Đang đọc đường giá…' : 'Nguồn chưa đủ đường giá để đo excursion.'}</p>}
    </Section>
    <Section title="Drawdown on winning trades" note="Biên bất lợi quan sát của những lệnh có Net P/L > 0"><div className="fxa-metrics"><Metric label="Lệnh thắng có đường giá" value={fmt(winningExcursions.length, ' lệnh', 0)} /><Metric label="Max adverse price" value={fmt(winningExcursions.length ? Math.max(...winningExcursions) : null, '', 6)} note="Lower bound khi chưa có thứ tự intrabar" /></div></Section>
  </div>
}

export function AnalyticsSimulation({ model, data, experiments, experimentStatus, experimentError, config, onConfig }) {
  const currency = model.result?.account_currency || 'đơn vị tài khoản'
  const initialConfig = () => ({ method: 'ledger', simulations: 200, trades: Math.max(1, Math.min(200, data.count)), capital: number(model.startBalance) ?? 100000, averageWin: data.averageWin ?? 100, averageLoss: Math.abs(data.averageLoss ?? 100), winRate: data.winRate ?? 50, seed: 42 })
  const [mc, setMc] = useState(initialConfig), [result, setResult] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState(config)
  useEffect(() => { setDraft(config) }, [config])
  const scenarioRows = (experiments?.rows || []).filter(row => data.rows.some(trade => trade.tradeId === row.trade_id))
  const run = event => { event.preventDefault(); setError(''); setBusy(true); window.setTimeout(() => { try { setResult(monteCarlo(mc, data.rows)) } catch (err) { setError(err.message); setResult(null) } finally { setBusy(false) } }, 0) }
  const dirty = result && JSON.stringify(result.config) !== JSON.stringify(mc)
  const scenario = (key, title) => { const available = scenarioRows.filter(row => known(row[key]?.net_pnl)); return <Section title={title} note="What-if offline trong thời gian giữ lệnh gốc · không sửa kết quả đã lưu"><div className="fxa-metrics"><Metric label="Lệnh tính được" value={`${available.length}/${data.count}`} /><Metric label="Scenario net P/L" value={fmt(available.length ? available.reduce((sum, row) => sum + Number(row[key].net_pnl), 0) : null, ` ${currency}`)} note={available.length !== data.count ? 'Chỉ mẫu tính được, không phải tổng toàn phiên' : 'Toàn bộ lệnh trong phạm vi'} /></div>{experimentStatus === 'loading' ? <p role="status">Đang mô phỏng từ đường giá…</p> : experimentError ? <p role="alert">{experimentError}</p> : <details className="fxa-scenario-details"><summary>Kết quả từng lệnh và phạm vi tính</summary><div className="fxa-table-scroll" tabIndex={0} role="region" aria-label={`${title} chi tiết`}><table><thead><tr><th>Lệnh</th><th>Trạng thái</th><th>Giá thoát</th><th>Net P/L</th></tr></thead><tbody>{scenarioRows.map(row => <tr key={row.trade_id}><td>{row.trade_id}</td><td>{row[key]?.status || 'Không đủ dữ liệu'}<small>{row[key]?.reason || row[key]?.blocked_reason}</small></td><td>{fmt(row[key]?.exit_price, '', 6)}</td><td>{fmt(row[key]?.net_pnl)}</td></tr>)}</tbody></table></div></details>}</Section> }
  return <div className="fxa-report" data-testid="analytics-simulation">
    <form className="fxa-simulator-config" onSubmit={event => { event.preventDefault(); onConfig(draft) }}><label className="fxa-field"><span>Stop distance (ticks)</span><input aria-label="Stop distance (ticks)" type="number" min="1" max="100000" required value={draft.stop_distance_ticks} onChange={event => setDraft({ ...draft, stop_distance_ticks: event.target.value })} /></label><label className="fxa-field"><span>Stop multiplier</span><input aria-label="Stop multiplier" type="number" min="0.1" max="10" step="0.1" required value={draft.stop_multiplier} onChange={event => setDraft({ ...draft, stop_multiplier: event.target.value })} /></label><label className="fxa-field"><span>Target R</span><input aria-label="Target R" type="number" min="0.1" max="100" step="0.1" required value={draft.target_r} onChange={event => setDraft({ ...draft, target_r: event.target.value })} /></label><button className="fxa-button is-primary" type="submit" disabled={Boolean(model.result?.preview)} title={model.result?.preview ? 'Mẫu này chưa có đường giá để tính SL / RR' : undefined}>Chạy SL / RR</button><small>Stop cấu hình là giả định mới, không phải SL gốc. Trường hợp SL và TP cùng nến giữ “ambiguous”.</small></form>
    {scenario('stop_loss', 'Stop Loss Simulator')}{scenario('risk_reward', 'RR Simulator')}
    <Section title="Monte Carlo Simulation" note="Kịch bản ngẫu nhiên có seed · độc lập giữa các lệnh · vốn về 0 thì dừng giao dịch">
      <form onSubmit={run} className="fxa-monte-form"><SelectField label="Phương pháp" value={mc.method} onChange={value => setMc({ ...mc, method: value })} options={[["ledger", 'Lấy mẫu Net P/L từ ledger'], ['configured', 'Win / loss cấu hình']]} />{[['simulations', 'Số lượt mô phỏng', 1, 1000, 1], ['trades', 'Lệnh mỗi lượt', 1, 1000, 1], ['capital', `Vốn ban đầu (${currency})`, .01, undefined, .01], ['seed', 'Seed', 0, 4294967295, 1], ...(mc.method === 'configured' ? [['averageWin', 'Lãi trung bình', 0, undefined, .01], ['averageLoss', 'Độ lớn lỗ trung bình', 0, undefined, .01], ['winRate', 'Win rate (%)', 0, 100, .01]] : [])].map(([key, label, min, max, step]) => <label className="fxa-field" key={key}><span>{label}</span><input aria-label={label} type="number" min={min} max={max} step={step} required value={mc[key]} onChange={event => setMc({ ...mc, [key]: event.target.value })} /></label>)}<div className="fxa-form-actions"><button className="fxa-button" type="button" onClick={() => { setMc(initialConfig()); setResult(null); setError('') }}>Đặt lại cấu hình</button><button className="fxa-button is-primary" type="submit" disabled={busy}>{busy ? 'Đang tính…' : 'Chạy Monte Carlo'}</button></div></form>
      {error && <p role="alert" className="fxa-error">{error}</p>}{dirty && <p role="status">Cấu hình đã đổi; chạy lại để cập nhật kết quả.</p>}{result ? <><AnalyticsCurve series={result.paths.map(path => path.map(value => ({ value })))} label={`Monte Carlo · ${result.config.simulations} lượt · seed ${result.config.seed}`} suffix={` ${currency}`} /><div className="fxa-metrics"><Metric label="Average balance" value={fmt(result.average, ` ${currency}`)} /><Metric label="P05 / Median / P95" value={`${fmt(result.p05)} / ${fmt(result.median)} / ${fmt(result.p95)}`} /><Metric label="Worst drawdown" value={fmt(result.maxDD, ` ${currency}`)} /><Metric label="Xác suất kết thúc có lãi" value={fmt(result.probabilityProfit, '%')} /><Metric label="Tỷ lệ cạn vốn" value={fmt(result.ruinRate, '%')} /></div><small>Hiển thị tối đa 30 đường; thống kê tính trên tất cả {result.config.simulations} lượt. Không dự báo lợi nhuận tương lai.</small></> : <p className="fxa-empty">Chọn phương pháp và chạy mô phỏng để xem phân phối kết quả.</p>}
    </Section>
  </div>
}

export function FxAnalyticsReport({ model, extra, experiments, experimentStatus, experimentError, config, onConfig, selected, onSelect }) {
  const data = useMemo(() => advancedAnalytics(model, extra), [model, extra])
  const [tab, setTab] = useState(() => { const tab = new URLSearchParams(window.location.search).get('analytics_tab'); return ['performance', 'drawdown', 'simulation'].includes(tab) ? tab : 'performance' })
  const choose = value => { setTab(value); if (model.result?.preview) return; const url = new URL(window.location.href); url.searchParams.set('analytics_tab', value); window.history.replaceState({}, '', url) }
  return <><div className="fxa-report-scope"><span>{data.count} / {model.ledger.length} lệnh trong phạm vi · {model.result?.account_currency || 'đơn vị tài khoản'} · {extra.timezone}</span><small>— = nguồn chưa cung cấp</small></div><div className="fxa-report-tabs" role="tablist" aria-label="Phân tích"><>{[['performance', 'Performance'], ['drawdown', 'Drawdown'], ['simulation', 'Simulation']].map(([value, label]) => <button className="fxa-tab" id={`fxa-tab-${value}`} role="tab" key={value} aria-selected={tab === value} aria-controls="fxa-report-panel" tabIndex={tab === value ? 0 : -1} onKeyDown={event => { const tabs = ['performance', 'drawdown', 'simulation']; if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const index = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (tabs.indexOf(tab) + (event.key === 'ArrowRight' ? 1 : 2)) % 3; choose(tabs[index]); document.getElementById(`fxa-tab-${tabs[index]}`)?.focus() } }} onClick={() => choose(value)}>{label}</button>)}</></div><div id="fxa-report-panel" role="tabpanel" aria-labelledby={`fxa-tab-${tab}`} tabIndex={0}>{tab === 'performance' ? <AnalyticsPerformance model={model} data={data} extra={extra} onSelect={onSelect} selected={selected} /> : tab === 'drawdown' ? <AnalyticsDrawdown model={model} data={data} experiments={experiments} experimentStatus={experimentStatus} /> : <AnalyticsSimulation key={JSON.stringify([model.result?.session_id, model.result?.revision, model.result?.cursor_index, model.result?.execution_event_sequence, model.result?.filters, extra])} model={model} data={data} experiments={experiments} experimentStatus={experimentStatus} experimentError={experimentError} config={config} onConfig={onConfig} />}</div></>
}
