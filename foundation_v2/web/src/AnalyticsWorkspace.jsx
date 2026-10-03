import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './analytics-story.css'

function finite(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
}

function firstKnown(...values) {
  return values.find((value) => finite(value))
}

const DATE_TIME_FORMATTER_VI = new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'medium', timeZone: 'UTC' })
const DATE_FORMATTER_VI_UTC = new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeZone: 'UTC' })
const SHORT_DATE_FORMATTER_VI_UTC = new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeZone: 'UTC' })

function dateFromValue(value) {
  if (value === null || value === undefined || value === '') return null
  const numericInput = typeof value === 'number' || (typeof value === 'string' && /^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(value.trim()))
  if (numericInput && finite(value)) {
    const numeric = Number(value)
    const milliseconds = Math.abs(numeric) >= 100000000000 ? numeric : numeric * 1000
    const parsed = new Date(milliseconds)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function formatDate(value) {
  const parsed = dateFromValue(value)
  return !parsed ? 'N/A' : DATE_TIME_FORMATTER_VI.format(parsed)
}

function formatNumber(value, digits = 2, suffix = '') {
  if (!finite(value)) return 'N/A'
  return `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: digits }).format(Number(value))}${suffix}`
}

const MAX_CHART_POINTS = 240
const LEDGER_PAGE_SIZE = 50

function sampleSeries(values, maxPoints = MAX_CHART_POINTS, isPriority = () => false) {
  if (!Array.isArray(values) || values.length <= maxPoints) return values || []
  const indexes = new Set([0, values.length - 1])
  const regularSlots = Math.max(0, maxPoints - 2)
  for (let slot = 0; slot < regularSlots; slot += 1) {
    const ratio = regularSlots <= 1 ? 0 : slot / (regularSlots - 1)
    indexes.add(Math.round(1 + ratio * Math.max(0, values.length - 3)))
  }
  values.forEach((value, index) => { if (isPriority(value, index)) indexes.add(index) })
  return [...indexes].sort((left, right) => left - right).map((index) => values[index])
}

function netFromLedger(ledger) {
  if (!Array.isArray(ledger) || !ledger.length || !ledger.every((trade) => finite(trade?.net_pnl))) return null
  return ledger.reduce((total, trade) => total + Number(trade.net_pnl), 0)
}

export function buildAnalyticsModel(result) {
  const metrics = result?.metrics && typeof result.metrics === 'object' ? result.metrics : {}
  const ledger = Array.isArray(result?.ledger) ? result.ledger : []
  const providedNet = firstKnown(metrics.net_pnl, metrics.net_profit, result?.net_pnl)
  const netPnl = providedNet ?? netFromLedger(ledger)
  const providedTradeCount = firstKnown(result?.trade_count, metrics.trade_count, metrics.closed_trade_count)
  const tradeCount = providedTradeCount ?? (Array.isArray(result?.ledger) ? ledger.length : null)
  const ledgerHasCompletePnl = ledger.length > 0 && ledger.every((trade) => finite(trade?.net_pnl))
  const providedWins = firstKnown(metrics.wins, metrics.winning_trades)
  const providedLosses = firstKnown(metrics.losses, metrics.losing_trades)
  const providedBreakeven = firstKnown(metrics.breakeven, metrics.breakeven_trades)
  const wins = finite(providedWins) ? Number(providedWins) : (ledgerHasCompletePnl ? ledger.filter((trade) => Number(trade.net_pnl) > 0).length : null)
  const losses = finite(providedLosses) ? Number(providedLosses) : (ledgerHasCompletePnl ? ledger.filter((trade) => Number(trade.net_pnl) < 0).length : null)
  const breakeven = finite(providedBreakeven) ? Number(providedBreakeven) : (ledgerHasCompletePnl ? ledger.filter((trade) => Number(trade.net_pnl) === 0).length : null)
  const providedWinRate = firstKnown(metrics.win_rate_pct, metrics.win_rate, result?.win_rate_pct)
  const winRate = providedWinRate ?? (ledgerHasCompletePnl ? (wins / ledger.length) * 100 : null)
  const providedExpectancy = firstKnown(metrics.expectancy, metrics.expectancy_account, metrics.expectancy_net_per_trade)
  const expectancy = providedExpectancy ?? (finite(netPnl) && finite(tradeCount) && Number(tradeCount) > 0 ? Number(netPnl) / Number(tradeCount) : null)
  const rawCurve = Array.isArray(metrics.closed_trade_balance_curve) ? metrics.closed_trade_balance_curve : Array.isArray(metrics.equity_curve) ? metrics.equity_curve : []
  const curve = rawCurve.map((point, index) => ({ index, value: finite(point?.closed_trade_balance ?? point?.balance ?? point?.value ?? point) ? Number(point?.closed_trade_balance ?? point?.balance ?? point?.value ?? point) : null, tradeId: point?.trade_id || null })).filter((point) => point.value !== null)
  const rawDrawdown = Array.isArray(metrics.closed_trade_balance_drawdown_curve) ? metrics.closed_trade_balance_drawdown_curve : []
  let peak = null
  const drawdown = rawDrawdown.length ? rawDrawdown.map((point, index) => ({ index, drawdown: finite(point?.drawdown) ? Number(point.drawdown) : null, drawdownPct: finite(point?.drawdown_pct) ? Number(point.drawdown_pct) : null })) : curve.map((point, index) => { peak = peak === null ? point.value : Math.max(peak, point.value); const value = Math.max(0, peak - point.value); return { index, drawdown: value, drawdownPct: peak ? (value / peak) * 100 : null } })
  const knownDrawdown = drawdown.map((point) => point.drawdown).filter(Number.isFinite)
  const maxDrawdown = firstKnown(metrics.closed_trade_balance_max_drawdown, metrics.max_drawdown, metrics.max_dd) ?? (knownDrawdown.length ? Math.max(...knownDrawdown) : null)
  const observedRange = result?.observed_range || result?.range || {}
  const observedStart = observedRange.start_utc || observedRange.start || observedRange.from_utc || observedRange.from
  const observedEnd = observedRange.end_utc || observedRange.end || observedRange.to_utc || observedRange.to
  const ledgerDates = ledger.flatMap((trade) => [trade?.open_time_utc, trade?.close_time_utc]).map(dateFromValue).filter(Boolean).sort((a, b) => a - b)
  const dateLabel = (value) => { const date = dateFromValue(value); return !date ? 'N/A' : DATE_FORMATTER_VI_UTC.format(date) }
  const rows = ledger.map((trade, index) => { const pnl = finite(trade?.net_pnl) ? Number(trade.net_pnl) : null; const date = dateFromValue(trade?.close_time_utc); return { ...trade, rowIndex: index, tradeId: trade?.trade_id || `trade-${index + 1}`, pnl, outcome: pnl === null ? 'unknown' : pnl > 0 ? 'win' : pnl < 0 ? 'loss' : 'breakeven', source: trade?.source?.session_id || trade?.session_id || trade?.source_id || 'research ledger', closeDate: date ? DATE_TIME_FORMATTER_VI.format(date) : 'N/A' } })
  const realizedRValues = (Array.isArray(metrics.realized_r_values) ? metrics.realized_r_values : rows.map((trade) => trade.realized_r)).filter(finite).map(Number)
  const metricDefinitions = metrics.definitions && typeof metrics.definitions === 'object'
    ? Object.entries(metrics.definitions).slice(0, 16).reduce((out, [key, value]) => {
      if (typeof value === 'string' && value.trim()) out[key] = value.trim().slice(0, 240)
      else if (value && typeof value === 'object') {
        const detail = [value.question, value.unit && `unit=${value.unit}`, value.formula && `formula=${value.formula}`, value.source && `source=${value.source}`, value.version && `v=${value.version}`].filter((item) => typeof item === 'string' && item.trim()).join(' · ')
        if (detail) out[key] = detail.slice(0, 240)
      }
      return out
    }, {})
    : {}
  const startBalance = firstKnown(metrics.starting_balance, result?.starting_balance, curve[0]?.value)
  const endingBalance = firstKnown(metrics.ending_closed_trade_balance, metrics.ending_balance, curve[curve.length - 1]?.value)
  const strategy = result?.strategy_version || result?.playbook_id || result?.engine_version || 'N/A'
  const range = { start: dateLabel(observedStart || ledgerDates[0]?.toISOString()), end: dateLabel(observedEnd || ledgerDates[ledgerDates.length - 1]?.toISOString()) }
  const takeaway = !tradeCount ? 'Chưa có giao dịch đóng.' : !finite(netPnl) ? `${formatNumber(tradeCount, 0)} giao dịch đóng · Net P/L chưa có dữ liệu.` : `${formatNumber(tradeCount, 0)} giao dịch đóng · Net P/L ${formatNumber(netPnl, 2, result?.account_currency || 'account units')}`
  return {
    result: result || null,
    metrics,
    ledger: rows,
    tradeCount,
    netPnl,
    winRate,
    expectancy,
    maxDrawdown,
    profitFactor: firstKnown(metrics.profit_factor, metrics.profit_factor_after_cost),
    payoffRatio: firstKnown(metrics.payoff_ratio_after_cost, metrics.payoff_ratio),
    wins,
    losses,
    breakeven,
    curve,
    drawdown,
    realizedRValues,
    metricDefinitions,
    startBalance,
    endingBalance,
    observed: range,
    strategy,
    sourceHash: result?.artifact_sha256 || 'N/A',
    derivedNet: !finite(providedNet) && finite(netPnl),
    derivedWinRate: !finite(providedWinRate) && finite(winRate),
    derivedExpectancy: !finite(providedExpectancy) && finite(expectancy),
    takeaway,
  }
}

async function readJson(response) {
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(String(payload?.detail || `HTTP ${response.status}`))
    error.status = response.status
    error.payload = payload
    throw error
  }
  return payload
}

const DEFAULT_ANALYTICS_FILTERS = { side: 'all', outcome: 'all', from: '', to: '' }

function readAnalyticsFilters(query) {
  const from = query?.get('from_close_utc') || query?.get('from') || ''
  const to = query?.get('to_close_utc') || query?.get('to') || ''
  return {
    side: (query?.get('side') || 'all').toLowerCase(),
    outcome: (query?.get('outcome') || 'all').toLowerCase(),
    from: from ? String(from).slice(0, 10) : '',
    to: to ? String(to).slice(0, 10) : '',
  }
}

function dateBoundary(value, endOfDay = false) {
  if (!value) return ''
  return `${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`
}

function analyticsQuery(filters) {
  const params = new URLSearchParams()
  if (filters.side && filters.side !== 'all') params.set('side', filters.side)
  if (filters.outcome && filters.outcome !== 'all') params.set('outcome', filters.outcome)
  if (filters.from) params.set('from_close_utc', dateBoundary(filters.from))
  if (filters.to) params.set('to_close_utc', dateBoundary(filters.to, true))
  return params
}

function analyticsViewResult(view) {
  if (!view || typeof view !== 'object') return null
  const provenance = view.provenance && typeof view.provenance === 'object' ? view.provenance : {}
  const scope = view.scope && typeof view.scope === 'object' ? view.scope : {}
  const observed = scope.observed_range && typeof scope.observed_range === 'object' ? scope.observed_range : {}
  return {
    ...provenance,
    dataset_id: provenance.dataset_id,
    dataset_sha256: provenance.dataset_sha256,
    protocol_sha256: provenance.protocol_sha256,
    metrics_schema_version: provenance.metrics_schema_version,
    split: provenance.split,
    playbook_id: provenance.playbook_id,
    strategy_version: provenance.playbook_id || provenance.playbook_revision || 'N/A',
    observed_range: { start_utc: observed.first_close_utc, end_utc: observed.last_close_utc },
    metrics: view.metrics && typeof view.metrics === 'object' ? view.metrics : {},
    ledger: Array.isArray(view.ledger) ? view.ledger : [],
    analytics_available: view.analytics_available,
    blocked_by_data: Array.isArray(view.blocked_by_data) ? view.blocked_by_data : [],
    filters: view.filters && typeof view.filters === 'object' ? view.filters : {},
    scope,
  }
}

function analyticsViewStatus(view) {
  if (!view) return 'empty'
  if (Array.isArray(view.blocked_by_data) && view.blocked_by_data.length) return 'blocked_by_data'
  if (view.analytics_available === false) return 'blocked_by_data'
  if (view.stale === true || view.freshness === 'stale' || view.provenance?.freshness === 'stale' || view.provenance?.status === 'stale') return 'stale'
  if (view.partial === true || view.freshness === 'partial' || view.provenance?.status === 'partial') return 'partial'
  if (view.scope?.selected_trade_count === 0) return 'empty'
  return 'ready'
}

function filterDateLabel(value) {
  return value ? `UTC ${value}` : 'mọi ngày'
}

function AnalyticsFilters({ filters, onChange, csvUrl, onExport, exportPending }) {
  return <section className="as-filter-bar" aria-label="Bộ lọc analytics" data-testid="analytics-filters">
    <div className="as-filter-heading"><span className="as-eyebrow">FILTER / CLOSED TRADES</span><strong>Thu hẹp ledger trước khi đọc metric</strong><small>Ngày được hiểu theo UTC và chỉ áp dụng khi nguồn có close time.</small></div>
    <div className="as-filter-controls">
      <label><span>Side</span><select aria-label="Analytics side" value={filters.side} onChange={(event) => onChange({ side: event.target.value })}><option value="all">Tất cả</option><option value="buy">BUY</option><option value="sell">SELL</option></select></label>
      <label><span>Outcome</span><select aria-label="Analytics outcome" value={filters.outcome} onChange={(event) => onChange({ outcome: event.target.value })}><option value="all">Tất cả</option><option value="win">Thắng</option><option value="loss">Thua</option><option value="breakeven">Hòa vốn</option></select></label>
      <label><span>Từ ngày (UTC)</span><input aria-label="Analytics from date" type="date" value={filters.from} onChange={(event) => onChange({ from: event.target.value })} /></label>
      <label><span>Đến ngày (UTC)</span><input aria-label="Analytics to date" type="date" value={filters.to} onChange={(event) => onChange({ to: event.target.value })} /></label>
      <button className="as-filter-reset" type="button" onClick={() => onChange(DEFAULT_ANALYTICS_FILTERS)}>Xóa lọc</button>
      <a className="as-export-link" href={csvUrl} download onClick={onExport} aria-disabled={exportPending}>{exportPending ? 'Đang tạo CSV…' : 'Tải CSV'}</a>
    </div>
    <p className="as-filter-summary">Side: <strong>{filters.side.toUpperCase()}</strong> · Outcome: <strong>{filters.outcome}</strong> · Close: <strong>{filterDateLabel(filters.from)} → {filterDateLabel(filters.to)}</strong></p>
  </section>
}

function BalanceEvidence({ model, selectedTradeId, onSelect }) {
  const points = model.curve
  const chartRef = useRef(null)
  const [chartSize, setChartSize] = useState({ width: 800, height: 320 })
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      if (width > 0 && height > 0) setChartSize({ width, height })
    })
    observer.observe(chart)
    return () => observer.disconnect()
  }, [points.length])
  if (points.length < 2) return <div className="as-chart-empty">Chưa có đường balance đóng đủ dữ liệu để vẽ.</div>
  const renderPoints = sampleSeries(points, MAX_CHART_POINTS, (point) => point.tradeId === selectedTradeId)
  const renderDrawdown = sampleSeries(model.drawdown, MAX_CHART_POINTS)
  const values = renderPoints.map((point) => point.value)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const y = (value) => chartSize.height * (.92 - ((value - min) / span) * .76)
  const x = (index) => 4 + (index / Math.max(1, points.length - 1)) * Math.max(0, chartSize.width - 8)
  const line = renderPoints.map((point) => `${x(point.index)},${y(point.value)}`).join(' ')
  const knownDrawdowns = model.drawdown.map((point) => point.drawdown).filter(finite).map(Number)
  const maxDrawdown = knownDrawdowns.length ? Math.max(1, ...knownDrawdowns) : null
  return (
    <div className="as-chart-frame">
      <svg ref={chartRef} className="as-balance-chart" viewBox={`0 0 ${chartSize.width} ${chartSize.height}`} role="group" aria-label="Closed-trade balance evidence">
        {[.2, .44, .68, .92].map((grid) => <line className="as-chart-grid" key={grid} x1="0" x2={chartSize.width} y1={chartSize.height * grid} y2={chartSize.height * grid} />)}
        <polyline className="as-balance-line" points={line} />
        {renderPoints.map((point, index) => {
          const trade = model.ledger[point.index - 1]
          const tradeId = point.tradeId || trade?.tradeId || null
          const selected = tradeId && tradeId === selectedTradeId
          return <circle key={`${point.index}-${tradeId || 'start'}`} className={`as-chart-point ${selected ? 'is-selected' : ''}`} cx={x(point.index)} cy={y(point.value)} r={selected ? 4 : 3} tabIndex={tradeId ? 0 : undefined} role={tradeId ? 'button' : 'img'} aria-pressed={tradeId ? selected : undefined} aria-label={tradeId ? `${tradeId}, balance ${formatNumber(point.value)}` : `Starting balance ${formatNumber(point.value)}`} onClick={() => tradeId && onSelect(tradeId)} onKeyDown={(event) => { if (tradeId && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onSelect(tradeId) } }} />
        })}
      </svg>
      <div className="as-chart-axis"><span>{formatNumber(min)}</span><span>{formatNumber(max)}</span></div>
      <div className="as-drawdown-strip" role="group" aria-label="Closed-trade drawdown">
        {renderDrawdown.map((point) => {
          const drawdown = finite(point.drawdown) ? Number(point.drawdown) : null
          if (drawdown === null || maxDrawdown === null) return <span key={point.index} className="as-drawdown-bar is-unknown" role="img" title="DD N/A" aria-label="Drawdown chưa có dữ liệu" />
          return <span key={point.index} className="as-drawdown-bar" style={{ '--as-dd-height': `${Math.max(2, (drawdown / maxDrawdown) * 100)}%` }} title={`DD ${formatNumber(drawdown)}`} />
        })}
      </div>
      <div className="as-chart-legend"><span><i className="as-legend-line" /> Balance sau trade đóng</span><span><i className="as-legend-dd" /> Drawdown đóng</span><small>{points.length > renderPoints.length ? `Hiển thị ${renderPoints.length}/${points.length} điểm đại diện · ` : ''}Không phải floating equity · scope UTC</small></div>
    </div>
  )
}

function StoryMetric({ label, value, detail, source, tone = '' }) {
  return <dl className={'as-story-metric ' + tone}><dt>{label}</dt><dd>{value}</dd><dd className="as-metric-detail"><small>{detail}</small><em>{source}</em></dd></dl>
}

function ContextValue({ label, value, code = false }) {
  const displayValue = value === null || value === undefined || value === '' ? 'N/A' : value
  return <div className="as-context-value"><dt>{label}</dt><dd className={code ? 'as-code' : ''}>{displayValue}</dd></div>
}

function ProvenanceInspector({ model, selectedTrade, journalCount, links }) {
  return (
    <aside className="as-inspector" aria-label="Provenance và drilldown">
      {selectedTrade && <div className="as-section-head"><h2>{selectedTrade.tradeId}</h2><span className="as-inspector-state">Chỉ đọc</span></div>}
      {selectedTrade ? (
        <section className="as-inspector-selection" aria-label="Trade detail">
          <div className="as-selection-outcome"><span className={'as-outcome-dot is-' + selectedTrade.outcome} />{selectedTrade.outcome === 'win' ? 'Thắng' : selectedTrade.outcome === 'loss' ? 'Thua' : selectedTrade.outcome === 'breakeven' ? 'Hòa vốn' : 'Chưa xác định'}<strong>{formatNumber(selectedTrade.pnl)}</strong></div>
          <dl className="as-detail-list"><ContextValue label="Đóng (UTC)" value={selectedTrade.closeDate} /><ContextValue label="Side" value={selectedTrade.side} /><ContextValue label="Symbol" value={selectedTrade.symbol} /><ContextValue label="Khối lượng" value={formatNumber(selectedTrade.quantity, 4)} /><ContextValue label="Giá mở" value={formatNumber(selectedTrade.price_open, 6)} /><ContextValue label="Giá đóng" value={formatNumber(selectedTrade.price_close, 6)} /><ContextValue label="Net R" value={formatNumber(selectedTrade.realized_r, 2, 'R')} /><ContextValue label="Risk budget" value={formatNumber(selectedTrade.planned_risk_budget)} /></dl>
          <p className="as-inspector-note">{selectedTrade.source === 'closed balance curve' ? 'Result chỉ cung cấp trade ID trên balance curve; full ledger record chưa có nên các field còn lại giữ N/A.' : 'Trade được đọc từ ledger đã lưu theo phiên hoặc research job. Chọn Journal để ghi nhận diễn giải riêng; không sửa fill/result trong Analytics.'}</p>
          <details className="as-raw-details"><summary>Xem record gốc</summary><pre>{JSON.stringify(selectedTrade, null, 2)}</pre></details>
        </section>
      ) : null}
      <details className="as-provenance-details"><summary>Nguồn và giới hạn</summary>
      <dl className="as-provenance-list"><ContextValue label="Session revision" value={model.result?.revision} /><ContextValue label="Cutoff UTC" value={formatDate(model.result?.cutoff_timestamp)} /><ContextValue label="Dataset" value={model.result?.dataset_id} code /><ContextValue label="Dataset SHA" value={model.result?.dataset_sha256} code /><ContextValue label="Protocol SHA" value={model.result?.protocol_sha256} code /><ContextValue label="Artifact SHA" value={model.sourceHash} code /><ContextValue label="Strategy / engine" value={model.strategy} /><ContextValue label="Split" value={model.result?.split} /><ContextValue label="Metric schema" value={model.result?.metrics_schema_version || model.metrics.metric_schema_version} code /><ContextValue label="Observed range" value={model.observed.start + ' → ' + model.observed.end} /><ContextValue label="Journal context" value={journalCount === null ? 'N/A' : journalCount + ' entries'} /></dl>
      <p className="as-limit-note">N/A nghĩa là nguồn chưa cung cấp dữ liệu cần thiết. Research/simulation đang broker locked; không có đường nào gửi lệnh.</p>
      </details>
      <div className="as-inspector-actions"><a href={links.journal}>Mở Journal →</a>{links.replay && <a href={links.replay}>Mở Replay →</a>}</div>
    </aside>
  )
}

function TradeLedger({ model, selectedTradeId, onSelect }) {
  const [page, setPage] = useState(0)
  const pageCount = Math.max(1, Math.ceil(model.ledger.length / LEDGER_PAGE_SIZE))
  const selectedIndex = model.ledger.findIndex((trade) => trade.tradeId === selectedTradeId)
  useEffect(() => {
    setPage((current) => Math.min(current, pageCount - 1))
  }, [pageCount])
  useEffect(() => {
    if (selectedIndex >= 0) setPage(Math.floor(selectedIndex / LEDGER_PAGE_SIZE))
  }, [selectedIndex])
  const start = page * LEDGER_PAGE_SIZE
  const visibleRows = model.ledger.slice(start, start + LEDGER_PAGE_SIZE)
  return <section className="as-ledger-section" aria-label="Trade ledger"><div className="as-section-head"><div><h2>{model.ledger.length ? `${model.ledger.length} trade đóng` : 'Chưa có trade ledger'}</h2></div><span className="as-source-note">N/A = source chưa cung cấp</span></div>{!model.ledger.length ? <div className="as-empty-inline">Phạm vi này chưa có giao dịch đóng để xem chi tiết.</div> : <><div className="as-table-wrap" tabIndex={0} role="region" aria-label="Trade ledger, cuộn ngang để xem các cột"><table className="as-table"><thead><tr><th>Trade</th><th>Đóng UTC</th><th>Source / session</th><th>Net P/L</th><th>Net R</th><th>Kết quả</th></tr></thead><tbody>{visibleRows.map((trade) => <tr key={trade.tradeId} className={trade.tradeId === selectedTradeId ? 'is-selected' : ''} onClick={() => onSelect(trade.tradeId)}><td><button type="button" className="as-trade-select" aria-label={`Chọn trade ${trade.tradeId}`} aria-pressed={trade.tradeId === selectedTradeId} onClick={() => onSelect(trade.tradeId)}><code>{trade.tradeId}</code></button></td><td>{trade.closeDate}</td><td>{trade.source}</td><td className={trade.pnl > 0 ? 'is-positive' : trade.pnl < 0 ? 'is-negative' : ''}>{formatNumber(trade.pnl)}</td><td>{formatNumber(trade.realized_r, 2, 'R')}</td><td><span className={'as-outcome-text is-' + trade.outcome}>{trade.outcome === 'win' ? 'Thắng' : trade.outcome === 'loss' ? 'Thua' : trade.outcome === 'breakeven' ? 'Hòa' : 'N/A'}</span></td></tr>)}</tbody></table></div><nav className="as-ledger-pagination" aria-label="Trade ledger pagination" data-testid="analytics-ledger-pagination"><button type="button" onClick={() => setPage((current) => Math.max(0, current - 1))} disabled={page === 0} aria-label="Trang trước">←</button><span aria-live="polite">Trang {page + 1}/{pageCount} · hiển thị {start + 1}–{Math.min(start + LEDGER_PAGE_SIZE, model.ledger.length)} / {model.ledger.length}</span><button type="button" onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))} disabled={page >= pageCount - 1} aria-label="Trang sau">→</button></nav></>}</section>
}

function AnalyticsMetricDisclosure({ model }) {
  const values = model.realizedRValues || []
  const distribution = {
    positive: values.filter((value) => value > 0).length,
    negative: values.filter((value) => value < 0).length,
    breakeven: values.filter((value) => value === 0).length,
  }
  const definitionEntries = Object.entries(model.metricDefinitions || {})
  return (
    <section className="as-definition as-metric-disclosure" data-testid="analytics-metric-disclosure">
      <details>
        <summary>Định nghĩa metrics và phân phối R</summary>
        <div className="as-secondary-metrics as-r-distribution" role="group" aria-label="Phân phối realized R">
          <div><span>R dương</span><strong>{values.length ? distribution.positive : 'N/A'}</strong><small>realized R &gt; 0</small></div>
          <div><span>R âm</span><strong>{values.length ? distribution.negative : 'N/A'}</strong><small>realized R &lt; 0</small></div>
          <div><span>Hòa vốn</span><strong>{values.length ? distribution.breakeven : 'N/A'}</strong><small>realized R = 0</small></div>
          <div><span>Mẫu R</span><strong>{values.length || 'N/A'}</strong><small>nguồn metrics-v2/ledger</small></div>
        </div>
        {definitionEntries.length > 0 ? <dl className="as-metric-definitions">{definitionEntries.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl> : <p>Backend chưa cung cấp metric dictionary cho result này; các label trên chỉ mô tả phạm vi hiển thị và không thay thế công thức nguồn.</p>}
      </details>
    </section>
  )
}

function AnalyticsStoryWorkspace({ workspace = 'tenant-a', query = new URLSearchParams(), ledgerOnly = false, summaryOnly = false, embedded = false }) {
  const jobId = query?.get('job') || query?.get('job_id') || ''
  const sessionId = query?.get('session') || query?.get('replay_session') || ''
  const resourceId = jobId || sessionId
  const resourceKind = jobId ? 'research/jobs' : 'replay/sessions'
  const sourceLabel = jobId ? 'Research' : 'Replay'
  const replayCursor = jobId ? null : query?.get('cursor') ?? query?.get('cursor_index')
  const replayCutoff = jobId ? null : query?.get('cutoff') ?? query?.get('decision_cutoff')
  const tradeId = query?.get('trade') || query?.get('trade_id') || ''
  const [filters, setFilters] = useState(() => readAnalyticsFilters(query))
  const [state, setState] = useState({ status: resourceId ? 'loading' : 'idle', payload: null, error: null })
  const [journalCount, setJournalCount] = useState(null)
  const [selectedTradeId, setSelectedTradeId] = useState(tradeId)
  const [exportPending, setExportPending] = useState(false)
  const [exportError, setExportError] = useState('')
  const requestSequence = useRef(0)

  const filterParams = useMemo(() => {
    const params = analyticsQuery(filters)
    if (replayCursor !== null && replayCursor !== undefined) params.set('cursor_index', replayCursor)
    if (replayCutoff !== null && replayCutoff !== undefined) params.set('cutoff_timestamp', replayCutoff)
    return params
  }, [filters, replayCursor, replayCutoff])
  const analyticsPath = useMemo(() => {
    const suffix = filterParams.toString()
    return `/api/v2/${resourceKind}/${encodeURIComponent(resourceId)}/analytics${suffix ? `?${suffix}` : ''}`
  }, [filterParams, resourceId, resourceKind])
  const csvPath = useMemo(() => {
    const suffix = filterParams.toString()
    return `/api/v2/${resourceKind}/${encodeURIComponent(resourceId)}/analytics.csv${suffix ? `?${suffix}` : ''}`
  }, [filterParams, resourceId, resourceKind])

  const load = useCallback(async ({ signal } = {}) => {
    const requestId = ++requestSequence.current
    if (!resourceId) {
      setState({ status: 'idle', payload: null, error: null })
      return
    }
    const controller = new AbortController()
    setState((current) => ({ ...current, status: 'loading', error: null }))
    try {
      const requestSignal = signal || controller.signal
      const response = await fetch(analyticsPath, { headers: { 'X-Workspace-Id': workspace }, signal: requestSignal })
      const payload = await readJson(response)
      if (requestSignal?.aborted || requestId !== requestSequence.current) return
      const selectedCount = payload?.scope?.selected_trade_count
      const totalCount = payload?.scope?.total_trade_count
      const metricTradeCount = payload?.metrics?.closed_trade_count
      const countConsistent = metricTradeCount === undefined || (typeof metricTradeCount === 'number' && Number.isSafeInteger(metricTradeCount) && metricTradeCount === selectedCount)
      const hasReadyShape = payload?.analytics_available === false || (payload?.provenance && typeof payload.provenance === 'object' && payload?.metrics && typeof payload.metrics === 'object' && Array.isArray(payload.ledger) && typeof selectedCount === 'number' && Number.isSafeInteger(selectedCount) && selectedCount >= 0 && selectedCount === payload.ledger.length && typeof totalCount === 'number' && Number.isSafeInteger(totalCount) && totalCount >= selectedCount && countConsistent)
      if (payload?.schema_version !== 'analytics-read-model-v1' || typeof payload.analytics_available !== 'boolean' || !payload.scope || typeof payload.scope !== 'object' || !hasReadyShape) {
        const schemaError = new Error('analytics_read_model_invalid')
        schemaError.status = 422
        schemaError.payload = payload
        throw schemaError
      }
      setState({ status: analyticsViewStatus(payload), payload, error: null })
    } catch (error) {
      if (error?.name === 'AbortError' || requestId !== requestSequence.current) return
      const status = error?.status === 409 || error?.status === 503 ? 'blocked_by_data' : 'error'
      setState({ status, payload: error?.payload || null, error: String(error.message || error) })
    }
  }, [analyticsPath, resourceId, workspace])

  useEffect(() => {
    const controller = new AbortController()
    load({ signal: controller.signal })
    return () => controller.abort()
  }, [load])
  useEffect(() => {
    if (typeof window === 'undefined' || !resourceId || summaryOnly) return
    const next = new URL(window.location.href)
    for (const key of ['side', 'outcome', 'from', 'to', 'from_close_utc', 'to_close_utc']) next.searchParams.delete(key)
    if (filters.side !== 'all') next.searchParams.set('side', filters.side)
    if (filters.outcome !== 'all') next.searchParams.set('outcome', filters.outcome)
    if (filters.from) next.searchParams.set('from', filters.from)
    if (filters.to) next.searchParams.set('to', filters.to)
    window.history.replaceState({}, '', next)
  }, [filters, resourceId, summaryOnly])
  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/v2/journal', { headers: { 'X-Workspace-Id': workspace }, signal: controller.signal })
      .then((response) => readJson(response))
      .then((payload) => {
        const items = Array.isArray(payload.items) ? payload.items : []
        const matching = items.filter((record) => {
          const source = record.payload?.source || {}
          return (!sessionId || [source.session_id, source.replay_session_id, source.id].includes(sessionId)) && (!selectedTradeId || [source.trade_id, source.id].includes(selectedTradeId))
        })
        setJournalCount(sessionId || selectedTradeId ? matching.length : items.length)
      })
      .catch((error) => { if (error?.name !== 'AbortError') setJournalCount(null) })
    return () => controller.abort()
  }, [sessionId, selectedTradeId, workspace])

  const result = useMemo(() => state.payload?.schema_version === 'analytics-read-model-v1' ? analyticsViewResult(state.payload) : null, [state.payload])
  const model = useMemo(() => buildAnalyticsModel(result), [result])
  useEffect(() => {
    if (!selectedTradeId || !result) return
    const isKnown = model.ledger.some((trade) => trade.tradeId === selectedTradeId) || model.curve.some((point) => point.tradeId === selectedTradeId)
    if (!isKnown) setSelectedTradeId('')
  }, [model, result, selectedTradeId])
  const updateFilters = useCallback((patch) => setFilters((current) => ({ ...current, ...patch })), [])
  useEffect(() => {
    if (!result || summaryOnly || typeof window === 'undefined') return
    const next = new URL(window.location.href)
    next.searchParams.delete('trade_id')
    if (selectedTradeId) next.searchParams.set('trade', selectedTradeId)
    else next.searchParams.delete('trade')
    window.history.replaceState({}, '', next)
  }, [result, selectedTradeId, summaryOnly])
  const exportCsv = useCallback(async (event) => {
    event.preventDefault()
    if (!resourceId || exportPending) return
    setExportPending(true)
    setExportError('')
    try {
      const response = await fetch(csvPath, { headers: { 'X-Workspace-Id': workspace } })
      const blob = await response.blob()
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const objectUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = `analytics-${resourceId}.csv`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(objectUrl)
    } catch (error) {
      setExportError(`Không tạo được CSV: ${String(error.message || error)}`)
    } finally {
      setExportPending(false)
    }
  }, [csvPath, exportPending, resourceId, workspace])
  const selectedTrade = model.ledger.find((trade) => trade.tradeId === selectedTradeId) || (() => {
    const point = model.curve.find((item) => item.tradeId === selectedTradeId)
    return point ? { tradeId: point.tradeId, pnl: null, realized_r: null, planned_risk_budget: null, closeDate: 'N/A', source: 'closed balance curve', outcome: 'unknown', balance: point.value } : null
  })()
  const replayParams = new URLSearchParams({ workspace, view: 'replay', surface: 'workspace' })
  if (sessionId) replayParams.set('session', sessionId)
  if (result?.dataset_id) replayParams.set('dataset', result.dataset_id)
  if (Number.isInteger(selectedTrade?.close_cursor_index)) replayParams.set('cursor', String(selectedTrade.close_cursor_index))
  else if (Number.isInteger(result?.cursor_index)) replayParams.set('cursor', String(result.cursor_index))
  const journalParams = new URLSearchParams({ workspace, view: 'journal' })
  if (sessionId) journalParams.set('session', sessionId)
  if (selectedTradeId) journalParams.set('trade', selectedTradeId)
  const researchParams = new URLSearchParams({ workspace, view: 'research' })
  if (jobId) researchParams.set('job', jobId)
  const links = { journal: '/?' + journalParams.toString(), replay: sessionId ? '/?' + replayParams.toString() : '', research: '/?' + researchParams.toString() }

  return <section className={`as-page ${embedded ? 'as-embedded' : 'wm-page'}`} data-testid="analytics-workspace">
    {(!embedded || summaryOnly) && <header className={`as-page-header ${embedded ? '' : 'wm-page-header'}`}><div>{summaryOnly ? <h2>Kết quả phiên</h2> : <h1>{ledgerOnly ? 'Trades' : 'Analytics'}</h1>}</div><div className="as-header-status"><span className="as-status-dot" />{sourceLabel} / local · broker locked</div></header>}
    <section hidden={summaryOnly || !jobId} className="as-context-bar" aria-label="Ngữ cảnh analytics"><dl className="as-context-grid">{jobId && <ContextValue label="Research job" value={jobId} code />}<ContextValue label="Replay" value={sessionId || 'Không gắn session'} code /><ContextValue label="Trade focus" value={selectedTradeId || 'Chưa chọn'} code /></dl><div className="as-context-actions">{jobId && <a href={'/?' + researchParams.toString()}>Mở Research</a>}{sessionId && <a href={'/?' + replayParams.toString()}>Mở Replay</a>}<a href={'/?' + journalParams.toString()}>Mở Journal</a></div></section>

    {resourceId && !summaryOnly && <AnalyticsFilters filters={filters} onChange={updateFilters} csvUrl={csvPath} onExport={exportCsv} exportPending={exportPending} />}
    {exportError && <div className="as-message as-error" role="alert" data-testid="analytics-export-error">{exportError}</div>}
    {result?.historical_view && <p className="as-message" data-testid="analytics-historical-scope">Kết quả tới nến #{result.cursor_index}. Phiên hiện ở nến #{result.canonical_cursor_index}; bảng và CSV không gồm giao dịch sau mốc đang xem.</p>}
    {!resourceId && <section className="as-empty-state as-large-empty"><span className="as-eyebrow">START WITH CONTEXT</span><h2>Chưa chọn phiên hoặc research job</h2><p>Chọn một phiên replay hoặc mở Analytics từ kết quả Research để xem metric, đường balance đóng và trade ledger. Không có dữ liệu thì không dựng số 0 thay thế.</p><a className="as-primary-button" href={'/?' + researchParams.toString()}>Đi tới Research</a></section>}
    {state.status === 'loading' && <div className="as-message" role="status">Đang tải kết quả…</div>}
    {state.status === 'error' && <div className="as-message as-error" role="alert">Không đọc được kết quả: {state.error}<button className="as-inline-button" type="button" onClick={() => load()}>Thử lại</button></div>}
    {state.status === 'blocked_by_data' && <section className="as-empty-state as-large-empty as-blocked-state" data-testid="analytics-blocked"><span className="as-eyebrow">BLOCKED BY DATA</span><h2>Chưa đủ dữ liệu để tính analytics</h2><p>{Array.isArray(state.payload?.blocked_by_data) && state.payload.blocked_by_data.length ? state.payload.blocked_by_data.join(', ') : state.error || 'Job chưa hoàn tất hoặc research result chưa được phát hành.'}</p><button className="as-inline-button" type="button" onClick={() => load()}>Kiểm tra lại</button></section>}
    {state.status === 'empty' && <section className="as-empty-state as-large-empty" data-testid="analytics-empty"><span className="as-eyebrow">NO SELECTED TRADES</span><h2>Bộ lọc không còn trade đóng</h2><p>Không có dòng ledger nào khớp bộ lọc hiện tại. Xóa lọc hoặc chọn khoảng UTC rộng hơn; không dựng metric thay thế.</p></section>}
    {state.status === 'stale' && <div className="as-stale-banner" role="status"><strong>Dữ liệu có thể đã cũ.</strong> Provenance vẫn được giữ nguyên; tải lại để kiểm tra result mới nhất.<button className="as-inline-button" type="button" onClick={() => load()}>Tải lại</button></div>}
    {state.status === 'partial' && <div className="as-stale-banner" role="status"><strong>Kết quả mới chỉ một phần.</strong> Các metric không có bằng chứng vẫn giữ N/A; kiểm tra provenance trước khi dùng làm kết luận.</div>}

    {result && (state.status === 'ready' || state.status === 'stale' || state.status === 'partial' || state.status === 'empty') && <>
      {!summaryOnly && <details className="as-scope-details"><summary>Phạm vi và nguồn dữ liệu</summary><dl className="as-scope-strip" aria-label="Phạm vi kết quả"><ContextValue label="Dataset" value={model.result?.dataset_id} code /><ContextValue label="Instrument" value={model.result?.instrument_id || model.result?.instrument} /><ContextValue label="Timeframe" value={model.result?.timeframe} /><ContextValue label="Strategy / playbook" value={model.strategy} /><ContextValue label="Observed UTC" value={model.observed.start + ' → ' + model.observed.end} /><ContextValue label="Timezone" value={model.result?.timezone || 'UTC'} /><ContextValue label="Data quality" value={model.result?.data_quality || model.result?.quality} /><ContextValue label="Trades in scope" value={model.result?.scope?.selected_trade_count} /><ContextValue label="Trades total" value={model.result?.scope?.total_trade_count} /><ContextValue label="Balance basis" value={model.result?.scope?.balance_curve_scope} /><ContextValue label="Mode" value={sourceLabel + " / simulation"} /><ContextValue label="Broker" value="Locked" /></dl></details>}
      <section className="as-metric-strip" aria-label="Metrics chính"><StoryMetric label="Net P/L" value={formatNumber(model.netPnl)} detail={(result?.account_currency || 'account units') + ' · net'} source={model.derivedNet ? 'derived from ledger' : sourceLabel} tone={model.netPnl > 0 ? 'is-positive' : model.netPnl < 0 ? 'is-negative' : ''} /><StoryMetric label="Win rate" value={formatNumber(model.winRate, 1, '%')} detail={formatNumber(model.wins, 0) + ' thắng · ' + formatNumber(model.losses, 0) + ' thua · ' + formatNumber(model.breakeven, 0) + ' hòa'} source={model.derivedWinRate ? 'derived from ledger' : sourceLabel} /><StoryMetric label="Trades" value={formatNumber(model.tradeCount, 0)} detail="closed-trade ledger" source={sourceLabel} /><StoryMetric label="Max DD" value={formatNumber(model.maxDrawdown)} detail={(result?.account_currency || 'account units') + ' · closed-trade balance'} source={sourceLabel + " / ledger"} /></section>
      {!summaryOnly && !ledgerOnly && <section className="as-evidence-grid"><article className="as-evidence-panel"><div className="as-section-head"><div><h2>Balance sau trade đóng</h2></div><span className="as-source-note">{model.curve.length ? model.curve.length + ' points' : 'N/A'}</span></div><BalanceEvidence model={model} selectedTradeId={selectedTradeId} onSelect={setSelectedTradeId} /><div className="as-secondary-metrics"><div><span>Starting balance</span><strong>{formatNumber(model.startBalance)}</strong></div><div><span>Ending balance</span><strong>{formatNumber(model.endingBalance)}</strong></div><div><span>Expectancy</span><strong>{formatNumber(model.expectancy)}</strong><small>{model.derivedExpectancy ? 'derived from ledger' : sourceLabel}</small></div><div><span>Profit factor</span><strong>{formatNumber(model.profitFactor)}</strong><small>gross profit / loss</small></div></div><details className="as-definition"><summary>Cách đọc đường này</summary><p>Đường chỉ nối balance sau từng trade đóng. Dataset hiện tại không cung cấp floating path, nên không gọi đây là equity curve hay intratrade drawdown.</p></details></article><ProvenanceInspector model={model} selectedTrade={selectedTrade} journalCount={journalCount} links={links} /></section>}
      {!summaryOnly && <TradeLedger model={model} selectedTradeId={selectedTradeId} onSelect={setSelectedTradeId} />}
      {ledgerOnly && <ProvenanceInspector model={model} selectedTrade={selectedTrade} journalCount={journalCount} links={links} />}
      {!summaryOnly && !ledgerOnly && <AnalyticsMetricDisclosure model={model} />}
      {!summaryOnly && selectedTrade && <section className="as-next-action" aria-label="Next action"><span>Review trade đang chọn</span><div className="as-next-links"><a className="as-primary-button" href={links.journal}>Mở Journal</a>{sessionId && <a className="as-secondary-button" href={links.replay}>Mở Replay</a>}</div></section>}
    </>}
  </section>
}

export default AnalyticsStoryWorkspace

