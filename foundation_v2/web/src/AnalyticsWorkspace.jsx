import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './analytics-story.css'
import { FxAnalyticsFilters, FxAnalyticsReport } from './FxAnalytics.jsx'
import FxTradeLedger, { TradeInspector } from './FxTradeLedger.jsx'
import { advancedAnalytics, DEFAULT_EXTRA_FILTERS, readAnalyticsExtraFilters, tradesCsv } from './tradingAnalyticsModel.js'
import useReadRefresh from './useReadRefresh.js'
import { buildPropAnalyticsView } from './propAnalyticsModel.js'

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


function netFromLedger(ledger) {
  if (!Array.isArray(ledger) || !ledger.length || !ledger.every((trade) => finite(trade?.net_pnl))) return null
  return ledger.reduce((total, trade) => total + Number(trade.net_pnl), 0)
}

export function buildAnalyticsModel(result, reportKind = 'app') {
  const metrics = result?.metrics && typeof result.metrics === 'object' ? result.metrics : {}
  const ledger = Array.isArray(result?.ledger) ? result.ledger : []
  const providedNet = firstKnown(metrics.net_pnl, metrics.net_profit, result?.net_pnl)
  const netPnl = result?.multi_session ? null : providedNet ?? netFromLedger(ledger)
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
  const rows = ledger.map((trade, index) => { const pnl = finite(trade?.net_pnl) ? Number(trade.net_pnl) : null; const date = dateFromValue(trade?.close_time_utc); return { ...trade, report_kind: reportKind, rowIndex: index, tradeId: trade?.trade_id || `trade-${index + 1}`, pnl, outcome: pnl === null ? 'unknown' : pnl > 0 ? 'win' : pnl < 0 ? 'loss' : 'breakeven', source: trade?.source?.session_id || trade?.session_id || trade?.source_id || 'research ledger', closeDate: date ? DATE_TIME_FORMATTER_VI.format(date) : 'N/A' } })
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

export function readAnalyticsFilters(query) {
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

export function analyticsQuery(filters) {
  const params = new URLSearchParams()
  if (filters.side && filters.side !== 'all') params.set('side', filters.side)
  if (filters.outcome && filters.outcome !== 'all') params.set('outcome', filters.outcome)
  if (filters.from) params.set('from_close_utc', dateBoundary(filters.from))
  if (filters.to) params.set('to_close_utc', dateBoundary(filters.to, true))
  return params
}

export function analyticsViewResult(view) {
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

function StoryMetric({ label, value, detail, source, tone = '' }) {
  return <dl className={'as-story-metric ' + tone}><dt>{label}</dt><dd>{value}</dd><dd className="as-metric-detail"><small>{detail}</small><em>{source}</em></dd></dl>
}

function ContextValue({ label, value, code = false }) {
  const displayValue = value === null || value === undefined || value === '' ? 'N/A' : value
  return <div className="as-context-value"><dt>{label}</dt><dd className={code ? 'as-code' : ''}>{displayValue}</dd></div>
}

export function ProvenanceInspector({ model, selectedTrade, journalCount, links }) {
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

function AnalyticsStoryWorkspace({ workspace = 'tenant-a', query = new URLSearchParams(), ledgerOnly = false, summaryOnly = false, embedded = false, sessionName = '', propReport = null, sessionControl = null }) {
  const jobId = query?.get('job') || query?.get('job_id') || ''
  const sessionId = query?.get('session') || query?.get('replay_session') || ''
  const resourceId = jobId || sessionId
  const resourceKind = jobId ? 'research/jobs' : 'replay/sessions'
  const sourceLabel = jobId ? 'Research' : 'Replay'
  const replayCursor = jobId ? null : query?.get('cursor') ?? query?.get('cursor_index')
  const replayCutoff = jobId ? null : query?.get('cutoff') ?? query?.get('decision_cutoff')
  const eventSequence = jobId ? null : query?.get('event_sequence')
  const tradeId = query?.get('trade') || query?.get('trade_id') || ''
  const [filters, setFilters] = useState(() => readAnalyticsFilters(query))
  const [state, setState] = useState({ status: resourceId ? 'loading' : 'idle', payload: null, error: null })
  const [journalCount, setJournalCount] = useState(null)
  const [journalItems, setJournalItems] = useState([])
  const [selectedTradeId, setSelectedTradeId] = useState(tradeId)
  const [exportPending, setExportPending] = useState(false)
  const [exportError, setExportError] = useState('')
  const [extra, setExtra] = useState(() => readAnalyticsExtraFilters(query))
  const [experimentConfig, setExperimentConfig] = useState({ stop_distance_ticks: 20, stop_multiplier: 1, target_r: 2 })
  const [experiments, setExperiments] = useState({ status: 'idle', payload: null, error: '' })
  const [experimentReload, setExperimentReload] = useState(0)
  const requestSequence = useRef(0)

  const filterParams = useMemo(() => {
    const params = analyticsQuery(filters)
    if (replayCursor !== null && replayCursor !== undefined) params.set('cursor_index', replayCursor)
    if (replayCutoff !== null && replayCutoff !== undefined) params.set('cutoff_timestamp', replayCutoff)
    if (eventSequence !== null && eventSequence !== undefined) params.set('event_sequence', eventSequence)
    return params
  }, [filters, replayCursor, replayCutoff, eventSequence])
  const analyticsPath = useMemo(() => {
    const suffix = filterParams.toString()
    return `/api/v2/${resourceKind}/${encodeURIComponent(resourceId)}/analytics${suffix ? `?${suffix}` : ''}`
  }, [filterParams, resourceId, resourceKind])


  const load = useCallback(async ({ signal, background = false } = {}) => {
    const requestId = ++requestSequence.current
    if (!resourceId) {
      setState({ status: 'idle', payload: null, error: null })
      return
    }
    const controller = new AbortController()
    setState((current) => ({ ...current, status: background && ['ready', 'partial', 'stale', 'empty'].includes(current.status) ? current.status : 'loading', refreshing: background, error: null }))
    try {
      const requestSignal = signal || controller.signal
      const response = await fetch(analyticsPath, { headers: { 'X-Workspace-Id': workspace }, signal: requestSignal })
      let payload = await readJson(response)
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
      if (propReport) payload = buildPropAnalyticsView(payload, propReport)
      setState({ status: analyticsViewStatus(payload), payload, error: null })
    } catch (error) {
      if (error?.name === 'AbortError' || requestId !== requestSequence.current) return
      const status = error?.status === 409 || error?.status === 503 ? 'blocked_by_data' : 'error'
      setState({ status, payload: error?.payload || null, error: String(error.message || error) })
    }
  }, [analyticsPath, resourceId, workspace, propReport])

  useEffect(() => {
    const controller = new AbortController()
    load({ signal: controller.signal })
    return () => controller.abort()
  }, [load])
  useReadRefresh(() => { load({ background: true }); setExperimentReload(value => value + 1) }, Boolean(resourceId))
  useEffect(() => {
    if (jobId || !sessionId || summaryOnly || ledgerOnly) return
    const controller = new AbortController()
    const params = new URLSearchParams(filterParams)
    for (const [key, value] of Object.entries(experimentConfig)) params.set(key, value)
    setExperiments({ status: 'loading', payload: null, error: '' })
    fetch(`/api/v2/replay/sessions/${encodeURIComponent(sessionId)}/analytics/experiments?${params}`, { headers: { 'X-Workspace-Id': workspace }, signal: controller.signal }).then(readJson).then(payload => {
      if (!controller.signal.aborted) {
        if (payload.schema_version !== 'replay-analytics-experiments-v1' || payload.read_only !== true || !Array.isArray(payload.rows)) throw new Error('experiment_read_model_invalid')
        setExperiments({ status: 'ready', payload, error: '' })
      }
    }).catch(error => { if (!controller.signal.aborted) setExperiments({ status: 'error', payload: null, error: `Chưa đọc được đường giá: ${error.message}` }) })
    return () => controller.abort()
  }, [workspace, sessionId, jobId, filterParams, experimentConfig, experimentReload, summaryOnly, ledgerOnly])
  useEffect(() => {
    if (summaryOnly) return
    const url = new URL(window.location.href)
    for (const [key, value] of Object.entries(extra)) {
      const param = key === 'source' ? 'analytics_trade_source' : `analytics_${key}`
      if (value === DEFAULT_EXTRA_FILTERS[key]) url.searchParams.delete(param)
      else url.searchParams.set(param, value)
    }
    window.history.replaceState({}, '', url)
  }, [extra, summaryOnly])
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
        if (controller.signal.aborted) return
        setJournalItems(items)
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
  const model = useMemo(() => {
    const base = buildAnalyticsModel(result, propReport ? 'prop' : jobId ? 'research' : 'app')
    const ledger = base.ledger.map(trade => {
      const tags = journalItems.flatMap(record => {
        const source = record.payload?.source || {}
        return [source.session_id, source.replay_session_id].includes(sessionId) && [source.trade_id, source.id].includes(trade.tradeId) && Array.isArray(record.payload?.tags) ? record.payload.tags : []
      })
      return { ...trade, tags: [...new Set([...(Array.isArray(trade.tags) ? trade.tags : []), ...tags])], tag_source: tags.length ? 'journal_annotation' : 'ledger' }
    })
    return { ...base, ledger }
  }, [result, journalItems, sessionId, propReport, jobId])
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
      if (!result || !['ready', 'partial', 'stale', 'empty'].includes(state.status)) throw new Error('Kết quả chưa sẵn sàng')
      const blob = new Blob([tradesCsv(advancedAnalytics(model, extra).rows, result.account_currency, { session_id: sessionId || jobId, revision: result.revision, cursor_index: result.cursor_index, execution_event_sequence: result.execution_event_sequence, dataset_sha256: result.dataset_sha256, filters: JSON.stringify({ ...filters, ...extra }), balance_basis: result.scope?.balance_curve_scope })], { type: 'text/csv;charset=utf-8' })
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
  }, [exportPending, resourceId, result, model, extra, state.status, filters, sessionId, jobId])
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
  const experimentScopeMatches = experiments.payload && result && ['session_id', 'dataset_id', 'dataset_sha256', 'revision', 'cursor_index', 'execution_event_sequence'].every(key => experiments.payload.provenance?.[key] === result[key])

  const Inspector = ledgerOnly ? TradeInspector : 'section'
  const renderFilters = columnControl => <FxAnalyticsFilters sourceType={propReport ? 'Prop firm' : jobId ? 'Research' : 'Backtesting'} sessionControl={sessionControl} filters={filters} onChange={updateFilters} extra={extra} onExtra={patch => setExtra(current => ({ ...current, ...patch }))} rows={model.ledger} onExport={exportCsv} pending={exportPending || !result || !['ready', 'partial', 'stale', 'empty'].includes(state.status)} columnControl={columnControl} ledgerOnly={ledgerOnly} />
  return <section className={`as-page fxa-page ${embedded ? 'as-embedded' : 'wm-page'}`} aria-label={ledgerOnly ? 'Trades' : 'Analytics'} data-testid="analytics-workspace">
    {!embedded && <h1 className="sr-only">{ledgerOnly ? 'Trades' : 'Analytics'}</h1>}
    {(resourceId || sessionControl) && !summaryOnly && (ledgerOnly ? <FxTradeLedger model={model} extra={extra} selected={selectedTradeId} onSelect={setSelectedTradeId} sessionName={sessionName} hidden={!result || !['ready', 'stale', 'partial', 'empty'].includes(state.status)} renderFilters={renderFilters} /> : renderFilters())}
    {exportError && <p role="alert" className="fxa-error">{exportError}</p>}
    {result?.historical_view && <p className="as-message" data-testid="analytics-historical-scope">Kết quả tới nến #{result.cursor_index}. Phiên hiện ở nến #{result.canonical_cursor_index}; báo cáo không gồm giao dịch sau mốc đang xem.</p>}
    {!resourceId && <p className="fxa-empty">Chọn một phiên replay hoặc research job để xem kết quả.</p>}
    {state.status === 'loading' && <div className="as-message" role="status">Đang tải kết quả…</div>}
    {state.status === 'error' && <p className="as-message as-error" role="alert">Không đọc được kết quả: {state.error}. Kết quả sẽ được kiểm tra khi quay lại ứng dụng hoặc kết nối mạng phục hồi.</p>}
    {state.status === 'blocked_by_data' && <section className="as-empty-state" data-testid="analytics-blocked"><h2>Chưa đủ dữ liệu để tính analytics</h2><p>{state.payload?.blocked_by_data?.join(' · ') || state.error || 'Nguồn chưa có kết quả đã phát hành.'}</p></section>}
    {state.status === 'empty' && <p className="as-message" data-testid="analytics-empty">Không có giao dịch đóng khớp bộ lọc.</p>}
    {state.status === 'stale' && <p className="as-stale-banner" role="status">Dữ liệu có thể đã cũ. Giữ nguyên nguồn và kiểm tra lại khi quay về ứng dụng.</p>}
    {!ledgerOnly && state.status === 'partial' && <p className="as-stale-banner" role="status">Dữ liệu một phần. Chỉ tính trên các giao dịch có trong nguồn đã đọc.</p>}
    {result && ['ready', 'stale', 'partial', 'empty'].includes(state.status) && <>
      {summaryOnly ? <section className="as-metric-strip" aria-label="Metrics chính"><StoryMetric label="Net P/L" value={formatNumber(model.netPnl)} detail={result.account_currency} /><StoryMetric label="Win rate" value={formatNumber(model.winRate, 1, '%')} /><StoryMetric label="Trades" value={formatNumber(model.tradeCount, 0)} /><StoryMetric label="Max DD" value={formatNumber(model.maxDrawdown)} detail="Closed balance" /></section> : ledgerOnly ? null : <FxAnalyticsReport model={model} extra={extra} experiments={experimentScopeMatches ? experiments.payload : null} experimentStatus={experimentScopeMatches ? experiments.status : experiments.status === 'ready' ? 'error' : experiments.status} experimentError={experiments.error || (experiments.status === 'ready' && !experimentScopeMatches ? 'Đường giá chưa khớp revision/cutoff của báo cáo.' : '')} config={experimentConfig} onConfig={setExperimentConfig} selected={selectedTradeId} onSelect={setSelectedTradeId} />}
      {!summaryOnly && !ledgerOnly && <details className="as-scope-details"><summary>Phạm vi và nguồn dữ liệu</summary><dl className="as-scope-strip"><ContextValue label="Session" value={sessionId || jobId} code /><ContextValue label="Revision" value={result.revision} /><ContextValue label="Cutoff" value={result.cursor_index} /><ContextValue label="Dataset SHA" value={result.dataset_sha256} code /><ContextValue label="Balance basis" value={result.scope?.balance_curve_scope} /><ContextValue label="Mode" value={sourceLabel + ' / simulation'} /></dl><p>Chỉ dùng ledger đóng tại cutoff đã chọn. Các bộ lọc tạo lại đường số dư từ vốn ban đầu. — là dữ liệu chưa được nguồn cung cấp.</p></details>}
      {!summaryOnly && selectedTrade && <Inspector onClose={() => setSelectedTradeId('')} className="fxa-trade-inspector" aria-label="Chi tiết giao dịch"><div className="fxa-section-heading"><h2>Trade detail</h2><button className="fxa-button" type="button" onClick={() => setSelectedTradeId('')}>Đóng chi tiết</button></div><ProvenanceInspector model={model} selectedTrade={selectedTrade} journalCount={journalCount} links={links} /></Inspector>}
    </>}
  </section>
}

export default AnalyticsStoryWorkspace

