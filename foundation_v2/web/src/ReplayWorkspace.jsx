import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AreaSeries,
  BarSeries,
  BaselineSeries,
  CandlestickSeries,
  LineSeries,
  createChart,
} from 'lightweight-charts'
import { useFxReplayContext } from './FxReplayShell.jsx'
import { buildWorkspaceHref } from './workspaceContext.js'
import { buildReplayAnnotationDraft } from './chartAnnotations.js'
import './ReplayWorkspace.css'

function formatTimestamp(timestamp) {
  if (!Number.isFinite(Number(timestamp))) return 'Chưa có dữ liệu'
  return new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'short',
    timeStyle: 'medium',
    timeZone: 'UTC',
  }).format(new Date(Number(timestamp) * 1000))
}

function formatPrice(value) {
  if (!Number.isFinite(Number(value))) return 'N/A'
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 8 }).format(Number(value))
}

async function readJson(response) {
  const payload = await response.json().catch(() => ({}))
  if (response.status === 409) {
    const error = new Error('revision_conflict')
    error.code = 'revision_conflict'
    throw error
  }
  if (!response.ok) {
    const detail = payload?.detail || `HTTP ${response.status}`
    throw new Error(String(detail))
  }
  return payload
}

const CHART_TYPES = [
  { id: 'candles', label: 'Candles' },
  { id: 'bars', label: 'Bars' },
  { id: 'hollow', label: 'Hollow candles' },
  { id: 'line', label: 'Line' },
  { id: 'area', label: 'Area' },
  { id: 'baseline', label: 'Baseline' },
  { id: 'heikin', label: 'Heikin Ashi' },
  { id: 'renko', label: 'Renko' },
]

const INTERVAL_GROUPS = [
  { label: 'Seconds', options: ['5 seconds', '10 seconds', '15 seconds', '30 seconds'] },
  { label: 'Minutes', options: ['1 minute', '2 minutes', '3 minutes', '5 minutes', '10 minutes', '15 minutes', '30 minutes', '45 minutes'] },
  { label: 'Hours', options: ['1 hour', '2 hours', '3 hours', '4 hours', '12 hours'] },
  { label: 'Days', options: ['1 day', '1 week', '1 month', '3 months', '6 months', '12 months'] },
]
const INDICATOR_OPTIONS = ['Moving Average', 'Exponential Moving Average', 'RSI', 'MACD', 'Bollinger Bands', 'Volume']
const TIMEZONE_OPTIONS = ['UTC', 'Exchange', 'Ho Chi Minh (UTC+7)', 'London (UTC+0)', 'New York (UTC-4)', 'Tokyo (UTC+9)']
const DRAWING_GROUPS = {
  Cursors: ['Cross', 'Dot', 'Arrow', 'Eraser'],
  Lines: ['Trendline', 'Ray', 'Horizontal line', 'Vertical line', 'Crossline'],
  Fibonacci: ['Fib retracement', 'Fib extension', 'Fib channel', 'Fib time zone'],
  Shapes: ['Rectangle', 'Circle', 'Triangle', 'Polyline', 'Brush'],
  Notes: ['Text', 'Note', 'Callout', 'Price label'],
}

function heikinAshiRows(rows) {
  let previousOpen = null
  let previousClose = null
  return rows.map((row) => {
    const open = Number(row.open)
    const high = Number(row.high)
    const low = Number(row.low)
    const close = Number(row.close)
    const haClose = (open + high + low + close) / 4
    const haOpen = previousOpen === null ? (open + close) / 2 : (previousOpen + previousClose) / 2
    const haHigh = Math.max(high, haOpen, haClose)
    const haLow = Math.min(low, haOpen, haClose)
    previousOpen = haOpen
    previousClose = haClose
    return { ...row, open: haOpen, high: haHigh, low: haLow, close: haClose }
  })
}

function ChartMenu({ id, label, value, openMenu, setOpenMenu, children, testId }) {
  const open = openMenu === id
  return (
    <div className="chart-control-menu">
      <button
        type="button"
        className={`chart-control-button ${open ? 'is-open' : ''}`}
        data-testid={testId}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpenMenu(open ? '' : id)}
      >
        <span>{label}</span>
        {value && <strong>{value}</strong>}
        <span className="chart-control-chevron" aria-hidden="true">⌄</span>
      </button>
      {open && <div className="chart-control-popover" role="menu">{children}</div>}
    </div>
  )
}

function ChartMenuItem({ active = false, disabled = false, children, onClick }) {
  return (
    <button type="button" role="menuitem" className={`chart-menu-item ${active ? 'is-active' : ''}`} disabled={disabled} onClick={onClick}>
      <span>{children}</span>
      {active && <span className="chart-menu-check" aria-hidden="true">✓</span>}
    </button>
  )
}

// The chart surface keeps the same local-only contract as the rest of the
// replay view.  These rails are visual affordances for the FXReplay-style
// workspace; selecting one only changes the local drawing/context state.
const CHART_TOOL_RAIL = [
  { id: 'cross', label: 'Crosshair', icon: '＋' },
  { id: 'trend', label: 'Trend line', icon: '／' },
  { id: 'levels', label: 'Horizontal line', icon: '＝' },
  { id: 'shapes', label: 'Shapes', icon: '◇' },
  { id: 'text', label: 'Text annotation', icon: 'T' },
  { id: 'measure', label: 'Measure', icon: '⌁' },
]

const CHART_UTILITY_RAIL = [
  { id: 'orders', label: 'Orders (locked)', icon: '＋' },
  { id: 'objects', label: 'Object tree', icon: '▤' },
  { id: 'watchlist', label: 'Watchlist', icon: '☷' },
  { id: 'journal', label: 'Journal', icon: '▣' },
  { id: 'news', label: 'News', icon: 'N' },
]

function ChartToolRail({ onSelect }) {
  return (
    <nav className="chart-tool-rail" aria-label="Công cụ vẽ chart">
      {CHART_TOOL_RAIL.map((tool) => (
        <button key={tool.id} type="button" aria-label={tool.label} title={tool.label} onClick={() => onSelect(tool.label)}>
          <span aria-hidden="true">{tool.icon}</span>
        </button>
      ))}
    </nav>
  )
}

function ChartUtilityRail({ onSelect }) {
  return (
    <nav className="chart-utility-rail" aria-label="Tiện ích chart">
      {CHART_UTILITY_RAIL.map((tool) => (
        <button key={tool.id} type="button" aria-label={tool.label} title={tool.label} disabled={tool.id === 'orders'} onClick={() => onSelect(tool.label)}>
          <span aria-hidden="true">{tool.icon}</span>
          <small>{tool.label.split(' ')[0]}</small>
        </button>
      ))}
    </nav>
  )
}

function ReplayChart({ rows, chartType = 'candles', onCrosshair, onAnchorSelect }) {
  const hostRef = useRef(null)

  useEffect(() => {
    if (!hostRef.current || !rows.length) return undefined
    const host = hostRef.current
    const chart = createChart(host, {
      width: host.clientWidth,
      height: host.clientHeight,
      layout: { background: { color: '#0d1012' }, textColor: '#b8c0c8' },
      grid: { vertLines: { color: '#20262a' }, horzLines: { color: '#20262a' } },
      rightPriceScale: { borderColor: '#30383e' },
      timeScale: { borderColor: '#30383e', timeVisible: true, secondsVisible: false },
      crosshair: { mode: 0 },
    })
    const sourceRows = chartType === 'heikin' ? heikinAshiRows(rows) : rows
    const chartRows = sourceRows.map((row) => ({
      time: Number(row.timestamp),
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
    }))
    const isCandle = chartType === 'candles' || chartType === 'hollow' || chartType === 'heikin' || chartType === 'renko'
    const seriesType = chartType === 'bars' ? BarSeries
      : chartType === 'line' ? LineSeries
        : chartType === 'area' ? AreaSeries
          : chartType === 'baseline' ? BaselineSeries
            : CandlestickSeries
    const series = chart.addSeries(seriesType, isCandle ? {
      upColor: chartType === 'hollow' ? '#63b982' : '#63b982',
      downColor: '#df7676',
      borderVisible: chartType === 'hollow',
      borderUpColor: '#63b982',
      borderDownColor: '#df7676',
      wickUpColor: '#63b982',
      wickDownColor: '#df7676',
    } : chartType === 'baseline' ? {
      baseValue: { type: 'price', price: chartRows[0]?.close || 0 },
      topLineColor: '#63b982',
      topFillColor1: 'rgba(99,185,130,.22)',
      topFillColor2: 'rgba(99,185,130,.02)',
      bottomLineColor: '#df7676',
      bottomFillColor1: 'rgba(223,118,118,.02)',
      bottomFillColor2: 'rgba(223,118,118,.16)',
    } : {
      color: chartType === 'area' ? '#63b982' : '#d6b56f',
      lineColor: '#63b982',
      topColor: 'rgba(99,185,130,.20)',
      bottomColor: 'rgba(99,185,130,.02)',
      lineWidth: 2,
    })

    // The chart accepts only the API-visible prefix. Dataset suffix rows never reach this component.
    series.setData(isCandle || chartType === 'bars' ? chartRows : chartRows.map((row) => ({ time: row.time, value: row.close })))
    const handleCrosshairMove = (param) => {
      if (!param?.time) {
        onCrosshair?.(null)
        return
      }
      const data = param.seriesData?.get(series)
      const row = rows.find((item) => Number(item.timestamp) === Number(param.time))
      onCrosshair?.(row ? { row, data } : null)
    }
    const handleChartClick = (param) => {
      // Lightweight Charts only gives us a trustworthy anchor when the click
      // resolves to both a known bar and a finite price coordinate.  Pixel
      // coordinates without a bar are intentionally ignored.
      const timestamp = Number(param?.time)
      const row = rows.find((item) => Number(item.timestamp) === timestamp)
      const data = param?.seriesData?.get(series)
      const price = param?.point && typeof series.coordinateToPrice === 'function'
        ? series.coordinateToPrice(param.point.y)
        : data?.close
      if (!row || !Number.isSafeInteger(timestamp) || !Number.isFinite(Number(price))) return
      onAnchorSelect?.({ timestamp, price: Number(price) })
    }
    chart.subscribeCrosshairMove(handleCrosshairMove)
    chart.subscribeClick(handleChartClick)
    chart.timeScale().fitContent()

    const observer = new ResizeObserver(() => {
      chart.applyOptions({ width: host.clientWidth, height: host.clientHeight })
    })
    observer.observe(host)
    return () => {
      observer.disconnect()
      chart.unsubscribeCrosshairMove(handleCrosshairMove)
      chart.unsubscribeClick(handleChartClick)
      chart.remove()
    }
  }, [chartType, onAnchorSelect, onCrosshair, rows])

  return (
    <div
      ref={hostRef}
      className="replay-chart"
      data-testid="replay-chart"
      data-visible-row-count={rows.length}
      aria-label={`Biểu đồ replay ${chartType} với ${rows.length} nến đã được mở; bấm vào nến để tạo annotation draft local`}
    />
  )
}

function replaceSessionInUrl(sessionId, preserveCursor = false, cursor = null, dataset = null) {
  const url = new URL(window.location.href)
  url.searchParams.set('view', 'replay')
  url.searchParams.set('session', sessionId)
  if (dataset !== null && dataset !== undefined && dataset !== '') url.searchParams.set('dataset', String(dataset))
  // Keep dataset/mode/cutoff context so a copied deep link remains useful
  // outside the current React instance. The backend session remains the
  // authority; these values are navigation context only.
  if (Number.isInteger(Number(cursor)) && Number(cursor) >= 0) url.searchParams.set('cursor', String(Number(cursor)))
  else if (!preserveCursor) url.searchParams.delete('cursor')
  window.history.replaceState(null, '', url)
}

function isEditableTarget(target) {
  if (!target || typeof target !== 'object') return false
  if (target.isContentEditable) return true
  const tagName = String(target.tagName || '').toUpperCase()
  return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT' || tagName === 'BUTTON'
}

export default function ReplayWorkspace({ workspace, query }) {
  const { updateMarketContext } = useFxReplayContext()
  const storageKey = `tw:replay:last:${workspace}`
  const requestedSession = query.get('session') || ''
  const requestedDataset = query.get('dataset') || ''
  const freshStart = query.get('fresh') === '1'
  const requestedStart = Number(query.get('start') || 0)
  const requestedCursorParam = query.get('cursor')
  const requestedCursor = requestedCursorParam === null ? null : Number(requestedCursorParam)
  const requestedCursorValid = requestedCursor === null || (Number.isInteger(requestedCursor) && requestedCursor >= 0)
  const [sessionId, setSessionId] = useState(requestedSession)
  const [state, setState] = useState({ status: 'idle', payload: null, error: null })
  const [datasetState, setDatasetState] = useState({ status: 'loading', items: [], error: null })
  const [pendingAction, setPendingAction] = useState('')
  const [conflict, setConflict] = useState(false)
  const [branchCursor, setBranchCursor] = useState(0)
  const [datasetDraft, setDatasetDraft] = useState(requestedDataset)
  const [startDraft, setStartDraft] = useState(Number.isFinite(requestedStart) ? Math.max(0, requestedStart) : 0)
  const [jumpDraft, setJumpDraft] = useState(0)
  const [speed, setSpeed] = useState('1')
  const [isPlaying, setIsPlaying] = useState(false)
  const [crosshair, setCrosshair] = useState(null)
  const [annotationDraft, setAnnotationDraft] = useState(null)
  // Chart controls stay local to this replay view.  They deliberately do not
  // mutate the session or call a broker/provider API; the session payload is
  // still the only source of replay data and cutoff authority.
  const [chartInterval, setChartInterval] = useState('1 minute')
  const [chartType, setChartType] = useState('candles')
  const [openChartMenu, setOpenChartMenu] = useState('')
  const [activeIndicators, setActiveIndicators] = useState([])
  const [compareSymbol, setCompareSymbol] = useState('')
  const [timezone, setTimezone] = useState('UTC')
  const [drawingTool, setDrawingTool] = useState('Cross')
  const [goToDateDraft, setGoToDateDraft] = useState('')
  const [chartNotice, setChartNotice] = useState('')

  const rememberSession = useCallback((nextSessionId, preserveCursor = false, cursor = null, dataset = null) => {
    setSessionId(nextSessionId)
    window.localStorage.setItem(storageKey, nextSessionId)
    replaceSessionInUrl(nextSessionId, preserveCursor, cursor, dataset)
  }, [storageKey])

  const loadSession = useCallback(async (targetSessionId, targetCursor = null) => {
    if (!targetSessionId) return
    setState((current) => ({ status: 'loading', payload: current.payload, error: null }))
    setConflict(false)
    try {
      const suffix = targetCursor === null ? '' : `?cursor_index=${encodeURIComponent(targetCursor)}`
      const response = await fetch(`/api/v2/replay/sessions/${encodeURIComponent(targetSessionId)}${suffix}`, {
        headers: { 'X-Workspace-Id': workspace },
      })
      const payload = await readJson(response)
      const viewCursor = Number(payload.view_cursor_index ?? payload.payload.cursor_index)
      rememberSession(payload.record_id, true, viewCursor, payload.payload?.dataset_id)
      setBranchCursor(payload.historical_view ? Math.max(0, viewCursor) : Math.max(0, viewCursor - 1))
      setJumpDraft(Math.max(0, viewCursor))
      setState({ status: 'ready', payload, error: null })
    } catch (error) {
      setState({ status: 'error', payload: null, error: String(error.message || error) })
    }
  }, [rememberSession, workspace])

  const createSession = useCallback(async () => {
    const datasetId = datasetDraft.trim()
    if (!datasetId) {
      setState({ status: 'error', payload: null, error: 'Cần dataset id để tạo replay.' })
      return
    }
    setPendingAction('create')
    setConflict(false)
    try {
      const response = await fetch('/api/v2/replay/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Workspace-Id': workspace },
        body: JSON.stringify({ dataset_id: datasetId, start_index: Number(startDraft) }),
      })
      const payload = await readJson(response)
      const viewCursor = Number(payload.view_cursor_index ?? payload.payload.cursor_index)
      rememberSession(payload.record_id, false, viewCursor, datasetId)
      setBranchCursor(Math.max(0, viewCursor - 1))
      setJumpDraft(Math.max(0, viewCursor))
      setState({ status: 'ready', payload, error: null })
    } catch (error) {
      setState({ status: 'error', payload: null, error: String(error.message || error) })
    } finally {
      setPendingAction('')
    }
  }, [datasetDraft, rememberSession, startDraft, workspace])

  const loadDatasets = useCallback(async () => {
    setDatasetState({ status: 'loading', items: [], error: null })
    try {
      const response = await fetch('/api/v2/data/datasets', {
        headers: { 'X-Workspace-Id': workspace },
      })
      const payload = await readJson(response)
      const items = Array.isArray(payload.items) ? payload.items : []
      setDatasetState({ status: 'ready', items, error: null })
      if (!datasetDraft && !requestedDataset && items.length) {
        const preferred = items.find((item) => /EURUSD/i.test(String(item.instrument_id || item.dataset_id))) || items[0]
        setDatasetDraft(String(preferred.dataset_id))
      }
    } catch (error) {
      setDatasetState({ status: 'error', items: [], error: String(error.message || error) })
    }
  }, [datasetDraft, requestedDataset, workspace])

  useEffect(() => {
    if (requestedSession) {
      loadDatasets()
      if (!requestedCursorValid) {
        setState({ status: 'error', payload: null, error: 'Cursor replay trong URL không hợp lệ.' })
        return
      }
      loadSession(requestedSession, requestedCursor)
      return
    }
    if (freshStart) {
      loadDatasets()
      return
    }
    const persisted = window.localStorage.getItem(storageKey)
    if (persisted) {
      loadSession(persisted)
      return
    }
    loadDatasets()
    if (requestedDataset) createSession()
  }, []) // Resolve the initial resume once from URL -> persisted session -> dataset.

  const mutate = useCallback(async (kind, body) => {
    if (!sessionId || !state.payload) return
    setPendingAction(kind)
    setConflict(false)
    const suffix = kind === 'branch' ? 'branch' : 'step'
    try {
      const response = await fetch(`/api/v2/replay/sessions/${encodeURIComponent(sessionId)}/${suffix}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Workspace-Id': workspace },
        body: JSON.stringify(body),
      })
      const payload = await readJson(response)
      const nextCursor = Number(payload.view_cursor_index ?? payload.payload.cursor_index)
      const payloadDataset = payload.payload?.dataset_id || state.payload?.payload?.dataset_id
      if (kind === 'branch') rememberSession(payload.record_id, false, nextCursor, payloadDataset)
      else replaceSessionInUrl(payload.record_id, false, nextCursor, payloadDataset)
      setBranchCursor(Math.max(0, nextCursor - 1))
      setJumpDraft(Math.max(0, nextCursor))
      setState({ status: 'ready', payload, error: null })
    } catch (error) {
      if (error.code === 'revision_conflict') {
        setConflict(true)
      } else {
        setState((current) => ({ ...current, status: 'error', error: String(error.message || error) }))
      }
    } finally {
      setPendingAction('')
    }
  }, [rememberSession, sessionId, state.payload, workspace])

  const replay = state.payload
  const cursor = Number(replay?.view_cursor_index ?? replay?.payload?.cursor_index ?? 0)
  const canonicalCursor = Number(replay?.canonical_cursor_index ?? replay?.payload?.cursor_index ?? cursor)
  const historicalView = Boolean(replay?.historical_view)
  const revision = Number(replay?.revision ?? 0)
  const visibleRows = replay?.visible_rows || []
  const visibleRowCount = replay?.visible_row_count ?? (replay ? visibleRows.length : null)
  const currentBar = visibleRows.length ? visibleRows[visibleRows.length - 1] : null
  const activeDataset = useMemo(
    () => datasetState.items.find((item) => item.dataset_id === replay?.payload?.dataset_id) || null,
    [datasetState.items, replay?.payload?.dataset_id],
  )

  // Keep the story grounded in the same API-visible replay payload. Dataset
  // metadata is an enhancement when the catalog is available; it must never
  // become a reason to invent instrument, provider, or quality values.
  const replayContext = useMemo(() => {
    const payload = replay?.payload || {}
    const source = activeDataset?.source || {}
    return {
      instrument: activeDataset?.instrument_id || payload.instrument_id || 'Instrument chưa xác định',
      timeframe: activeDataset?.timeframe || payload.timeframe || 'TF chưa rõ',
      quality: activeDataset?.quality_status || payload.quality_status || 'unverified',
      provider: activeDataset?.provider_id || source.provider || payload.provider_id || 'Provider chưa xác định',
      hash: activeDataset?.artifact_sha256 || replay?.dataset_sha256 || '',
      rowCount: activeDataset?.row_count ?? replay?.total_row_count ?? null,
      cutoff: replay?.cutoff_timestamp || payload.cutoff_timestamp || '',
    }
  }, [activeDataset, replay])

  const handleChartAnchor = useCallback((anchor) => {
    const cutoffTimestamp = Number(replay?.cutoff_timestamp)
    const instrumentId = String(replayContext.instrument || '')
    const timeframe = String(replayContext.timeframe || '')
    const row = visibleRows.find((item) => Number(item.timestamp) === Number(anchor?.timestamp))
    // Keep the local draft fail-closed even if a renderer/plugin hands us a
    // timestamp outside the API-visible prefix.  The backend remains the
    // authority for persisted annotations; this only creates a local draft.
    if (!row || !Number.isSafeInteger(cutoffTimestamp) || Number(anchor?.timestamp) > cutoffTimestamp) {
      setAnnotationDraft({ status: 'rejected', message: 'Mốc chart không thuộc cutoff đang hiển thị.' })
      return
    }
    try {
      const draft = buildReplayAnnotationDraft({
        instrumentId,
        timeframe,
        cutoffTimestamp,
        anchor,
        label: `Replay #${visibleRows.findIndex((item) => Number(item.timestamp) === Number(anchor.timestamp))}`,
      })
      setAnnotationDraft({ status: 'ready', draft })
    } catch (error) {
      setAnnotationDraft({ status: 'unavailable', message: String(error.message || error) })
    }
  }, [replay, replayContext.instrument, replayContext.timeframe, visibleRows])

  useEffect(() => {
    // A cursor/session change invalidates a previously selected chart anchor.
    setAnnotationDraft(null)
  }, [sessionId, cursor, revision])

  useEffect(() => {
    updateMarketContext({
      instrument: String(replayContext.instrument || ''),
      timeframe: String(replayContext.timeframe || ''),
      dataStatus: String(replayContext.quality || 'unverified'),
      source: String(replayContext.provider || ''),
      cutoff: String(replayContext.cutoff || ''),
    })
  }, [replayContext, updateMarketContext])

  const completed = replay?.payload?.status === 'completed' || replay?.has_future_rows === false
  const lineage = replay?.payload?.parent_session_id
  const canBranch = Boolean(replay) && !conflict && (
    historicalView ? cursor < canonicalCursor : cursor > 0 && branchCursor < cursor
  )

  const jumpToCursor = useCallback(() => {
    if (!sessionId || !replay) return
    const target = Math.max(0, Math.min(Number(jumpDraft) || 0, canonicalCursor))
    setIsPlaying(false)
    loadSession(sessionId, target)
  }, [canonicalCursor, jumpDraft, loadSession, replay, sessionId])

  useEffect(() => {
    if (!isPlaying || !replay || historicalView || completed || conflict || pendingAction) return undefined
    const delay = Math.max(180, 1100 / Math.max(1, Number(speed) || 1))
    const timer = window.setInterval(() => {
      mutate('step', { expected_revision: Number(replay.revision || 0), steps: 1 })
    }, delay)
    return () => window.clearInterval(timer)
  }, [completed, conflict, historicalView, isPlaying, mutate, pendingAction, replay, speed])

  useEffect(() => {
    if (completed || historicalView || conflict || state.status === 'error') setIsPlaying(false)
  }, [completed, conflict, historicalView, state.status])

  useEffect(() => {
    const handleKeyDown = (event) => {
      // Keep native text/range controls usable. ArrowRight is a replay shortcut only
      // when the page itself owns focus, so adjusting the branch range never steps bars.
      if (
        event.defaultPrevented
        || event.metaKey
        || event.ctrlKey
        || event.altKey
        || isEditableTarget(event.target)
        || event.key !== 'ArrowRight'
        || !replay
        || historicalView
        || completed
        || conflict
        || pendingAction
      ) return

      event.preventDefault()
      mutate('step', {
        expected_revision: revision,
        steps: event.shiftKey ? 10 : 1,
      })
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [completed, conflict, historicalView, mutate, pendingAction, replay, revision])

  useEffect(() => {
    if (!openChartMenu) return undefined
    const closeMenu = (event) => {
      if (!event.target?.closest?.('.chart-control-menu') && !event.target?.closest?.('.chart-date-popover')) setOpenChartMenu('')
    }
    document.addEventListener('pointerdown', closeMenu)
    return () => document.removeEventListener('pointerdown', closeMenu)
  }, [openChartMenu])

  const selectedChartType = CHART_TYPES.find((item) => item.id === chartType)?.label || 'Candles'
  const toggleIndicator = useCallback((indicator) => {
    setActiveIndicators((current) => current.includes(indicator)
      ? current.filter((item) => item !== indicator)
      : [...current, indicator])
  }, [])
  const selectDrawingTool = useCallback((tool) => {
    setDrawingTool(tool)
    setChartNotice(`${tool} đã chọn · bản vẽ local sẽ được nối ở bước tiếp theo.`)
    setOpenChartMenu('')
  }, [])
  const selectChartRailTool = useCallback((tool) => {
    setChartNotice(`${tool} đã chọn · thao tác chỉ áp dụng cho chart local.`)
  }, [])
  const selectChartOption = useCallback((setter, value, notice = '') => {
    setter(value)
    if (notice) setChartNotice(notice)
    setOpenChartMenu('')
  }, [])
  const routeContext = useMemo(() => ({
    session: sessionId || undefined,
    dataset: replay?.payload?.dataset_id || datasetDraft.trim() || undefined,
    cursor: replay && Number.isInteger(cursor) && cursor >= 0 ? cursor : undefined,
    cutoff: replay?.cutoff_timestamp || replay?.payload?.cutoff_timestamp || undefined,
  }), [cursor, datasetDraft, replay, sessionId])
  const routeHref = useCallback((view, extras = {}) => (
    buildWorkspaceHref(view, workspace, query, { ...routeContext, ...extras })
  ), [query, routeContext, workspace])
  const learnHref = useMemo(() => {
    return routeHref('learn', { from: 'replay', ...(sessionId ? {} : { start: String(startDraft) }) })
  }, [routeHref, sessionId, startDraft])
  const journalHref = useMemo(() => routeHref('journal'), [routeHref])

  const statusLabel = useMemo(() => {
    if (conflict) return 'Xung đột phiên'
    if (historicalView) return 'Cutoff lịch sử'
    if (completed) return 'Hoàn tất dataset'
    if (state.status === 'loading') return 'Đang tải'
    if (state.status === 'error') return 'Có lỗi'
    return 'Tạm dừng'
  }, [completed, conflict, historicalView, state.status])

  const takeaway = useMemo(() => {
    if (conflict) return 'Session có revision mới; cần tải lại trước khi tiếp tục để giữ đúng lineage.'
    if (historicalView) return `Đây là cutoff lịch sử #${cursor}; phần dữ liệu sau mốc này đang bị ẩn có chủ đích.`
    if (completed) return `Replay đã đi tới nến cuối của dataset; không còn nến tương lai để mở thêm.`
    return `Đang mở ${visibleRowCount ?? 'N/A'} nến; quyết định chỉ nên dựa trên bằng chứng tới cutoff hiện tại.`
  }, [completed, conflict, cursor, historicalView, visibleRowCount])
  const noDataset = datasetState.status === 'ready' && datasetState.items.length === 0
  const dataDeskHref = routeHref('data')

  return (
    <main className="replay-shell">
      <header className="replay-topbar">
        <div>
          <div className="eyebrow">THỰC HÀNH / CHART-FIRST REPLAY</div>
          <h1>Practice · Replay</h1>
          <p>Chart là trung tâm. Chỉ dữ liệu tới decision cutoff hiện tại được render.</p>
        </div>
        <div className="replay-topbar-actions">
          <a className="context-link" href={learnHref}>Học & thuật ngữ</a>
          <div className="replay-lock" data-testid="replay-lock">
            <strong>REPLAY / SIMULATION</strong>
            <span>Broker locked · không gửi lệnh</span>
          </div>
        </div>
      </header>

      {!replay && state.status !== 'loading' && (
        <section className={`replay-start ${noDataset ? 'is-empty' : ''}`} aria-label="Mở replay">
          <div>
            <div className="replay-start-kicker">CHART-FIRST PRACTICE</div>
            <h2>Mở chart để bắt đầu replay</h2>
            <p>Chọn dữ liệu local đã được đăng ký trong Workspace. Màn hình này chỉ mở phần dữ liệu đã tới cutoff; không gửi lệnh broker.</p>
          </div>
          <label>
            Dataset
            <select
              value={datasetDraft}
              onChange={(event) => setDatasetDraft(event.target.value)}
              data-testid="dataset-id"
              disabled={datasetState.status === 'loading'}
            >
              {!datasetDraft && <option value="">Chọn dataset…</option>}
              {datasetState.items.map((item) => (
                <option key={item.dataset_id} value={item.dataset_id}>
                  {item.instrument_id || item.dataset_id} · {item.timeframe || 'TF chưa rõ'} · {item.quality_status || 'unverified'}
                </option>
              ))}
              {datasetDraft && !datasetState.items.some((item) => item.dataset_id === datasetDraft) && (
                <option value={datasetDraft}>{datasetDraft} · đang kiểm tra</option>
              )}
            </select>
          </label>
          <label>
            Start index
            <input
              type="number"
              min="0"
              value={startDraft}
              onChange={(event) => setStartDraft(Math.max(0, Number(event.target.value) || 0))}
            />
          </label>
          <button className="primary-action" type="button" onClick={createSession} disabled={pendingAction === 'create' || !datasetDraft.trim() || datasetState.status === 'loading'}>
            {pendingAction === 'create' ? 'Đang tạo…' : 'Bắt đầu replay'}
          </button>
          {datasetState.status === 'loading' && <div className="replay-inline-status">Đang đọc danh mục dữ liệu…</div>}
          {datasetState.status === 'error' && <div className="replay-inline-status is-error">Không đọc được danh mục: {datasetState.error}</div>}
          {noDataset && (
            <>
              <div className="replay-inline-status is-empty">Chưa có dataset local trong workspace này.</div>
              <div className="replay-empty-actions" data-testid="replay-empty-actions">
                <span>Cần một dataset local đã có provenance trước khi mở chart.</span>
                <a href={dataDeskHref}>Mở Data Desk →</a>
              </div>
            </>
          )}
        </section>
      )}

      {state.status === 'loading' && <div className="replay-message">Đang tải trạng thái replay…</div>}
      {state.status === 'error' && <div className="replay-message replay-error">Không đọc được replay: {state.error}</div>}

      {replay && (
        <>
          <section className="replay-status replay-contextbar" aria-label="Ngữ cảnh replay">
            <div className="replay-context-primary">
              <span>Practice context</span>
              <strong>{replayContext.instrument} · {replayContext.timeframe}</strong>
              <small>{workspace} · broker locked</small>
            </div>
            <div><span>Dataset</span><code>{replay.payload.dataset_id}</code></div>
            <div><span>Decision cutoff</span><strong>#{cursor}</strong><small>{formatTimestamp(replay.cutoff_timestamp)} UTC</small></div>
            <div><span>Visible rows</span><strong>{visibleRowCount ?? 'N/A'} nến</strong><small>revision r{revision}</small></div>
            <div className={`replay-state ${completed ? 'is-complete' : ''} ${conflict ? 'is-conflict' : ''}`} data-testid="replay-status">
              {statusLabel}
            </div>
          </section>

          {conflict && (
            <section className="conflict-banner" role="alert" data-testid="revision-conflict">
              <div>
                <strong>Session đã thay đổi ở nơi khác.</strong>
                <span>Controls đang khóa để tránh ghi đè revision cũ.</span>
              </div>
              <button type="button" onClick={() => loadSession(sessionId)}>Tải trạng thái mới</button>
            </section>
          )}

          {historicalView && (
            <section className="replay-history-banner" role="status" data-testid="replay-history-view">
              <div>
                <strong>Đang xem đúng cutoff report ở nến #{cursor}.</strong>
                <span>Replay gốc hiện ở nến #{canonicalCursor}; dữ liệu sau cutoff này không được render.</span>
              </div>
              <span>Tạo branch nếu muốn tiếp tục từ đúng mốc report mà không sửa session gốc.</span>
            </section>
          )}

          <section className="replay-workspace">
            <div className="replay-main">
              <div className="replay-toolbar" aria-label="Điều khiển replay">
                <div className="toolbar-group toolbar-primary">
                  <button
                    type="button"
                    className="play-button"
                    data-testid="play-toggle"
                    onClick={() => setIsPlaying((current) => !current)}
                    disabled={historicalView || completed || conflict || Boolean(pendingAction)}
                    aria-pressed={isPlaying}
                  >
                    {isPlaying ? 'Tạm dừng' : 'Phát replay'}
                  </button>
                  <button
                    type="button"
                    data-testid="step-1"
                    aria-keyshortcuts="ArrowRight"
                    onClick={() => mutate('step', { expected_revision: revision, steps: 1 })}
                    disabled={historicalView || completed || conflict || Boolean(pendingAction)}
                  >
                    +1 nến
                  </button>
                  <button
                    type="button"
                    data-testid="step-10"
                    aria-keyshortcuts="Shift+ArrowRight"
                    onClick={() => mutate('step', { expected_revision: revision, steps: 10 })}
                    disabled={historicalView || completed || conflict || Boolean(pendingAction)}
                  >
                    +10 nến
                  </button>
                </div>
                <div className="chart-controls" aria-label="Chart controls">
                  <ChartMenu
                    id="interval"
                    label="Interval"
                    value={chartInterval.replace(' minute', 'm').replace(' minutes', 'm').replace(' hour', 'h').replace(' hours', 'h').replace(' seconds', 's').replace(' day', 'D').replace(' week', 'W').replace(' month', 'M').replace(' months', 'M')}
                    openMenu={openChartMenu}
                    setOpenMenu={setOpenChartMenu}
                    testId="chart-interval"
                  >
                    <button type="button" className="chart-menu-custom" onClick={() => selectChartOption(setChartInterval, 'Custom interval', 'Custom interval chỉ là cấu hình local cho fixture.')}>Add custom interval…</button>
                    {INTERVAL_GROUPS.map((group) => (
                      <React.Fragment key={group.label}>
                        <span className="chart-menu-heading">{group.label}</span>
                        {group.options.map((option) => (
                          <ChartMenuItem key={option} active={chartInterval === option} onClick={() => selectChartOption(setChartInterval, option)}>{option}</ChartMenuItem>
                        ))}
                      </React.Fragment>
                    ))}
                  </ChartMenu>

                  <ChartMenu
                    id="chart-type"
                    label="Chart"
                    value={selectedChartType}
                    openMenu={openChartMenu}
                    setOpenMenu={setOpenChartMenu}
                    testId="chart-type"
                  >
                    {CHART_TYPES.map((option) => (
                      <ChartMenuItem key={option.id} active={chartType === option.id} onClick={() => selectChartOption(setChartType, option.id)}>{option.label}</ChartMenuItem>
                    ))}
                  </ChartMenu>

                  <ChartMenu
                    id="indicators"
                    label="Indicators"
                    value={activeIndicators.length ? `${activeIndicators.length}` : ''}
                    openMenu={openChartMenu}
                    setOpenMenu={setOpenChartMenu}
                    testId="chart-indicators"
                  >
                    <label className="chart-menu-search">
                      <span className="sr-only">Tìm indicator</span>
                      <input type="search" placeholder="Search the library…" aria-label="Tìm indicator" />
                    </label>
                    <span className="chart-menu-heading">Favorites · Discover · Personal</span>
                    {INDICATOR_OPTIONS.map((indicator) => (
                      <ChartMenuItem key={indicator} active={activeIndicators.includes(indicator)} onClick={() => toggleIndicator(indicator)}>{indicator}</ChartMenuItem>
                    ))}
                    <span className="chart-menu-footnote">Local preview · chưa tính toán trên dataset</span>
                  </ChartMenu>

                  <ChartMenu
                    id="compare"
                    label="Compare"
                    value={compareSymbol || ''}
                    openMenu={openChartMenu}
                    setOpenMenu={setOpenChartMenu}
                    testId="chart-compare"
                  >
                    <span className="chart-menu-heading">Available symbols</span>
                    <ChartMenuItem active={compareSymbol === ''} onClick={() => selectChartOption(setCompareSymbol, '', 'Compare đã tắt.')}>Không so sánh</ChartMenuItem>
                    <ChartMenuItem active={compareSymbol === 'OANDA:EURUSD'} onClick={() => selectChartOption(setCompareSymbol, 'OANDA:EURUSD', 'Compare local với OANDA:EURUSD.')}>OANDA:EURUSD</ChartMenuItem>
                    <span className="chart-menu-footnote">Chỉ hiển thị symbol local có trong fixture.</span>
                  </ChartMenu>

                  <ChartMenu id="drawing" label="Draw" value={drawingTool} openMenu={openChartMenu} setOpenMenu={setOpenChartMenu} testId="chart-drawing">
                    {Object.entries(DRAWING_GROUPS).map(([group, tools]) => (
                      <React.Fragment key={group}>
                        <span className="chart-menu-heading">{group}</span>
                        {tools.map((tool) => <ChartMenuItem key={tool} active={drawingTool === tool} onClick={() => selectDrawingTool(tool)}>{tool}</ChartMenuItem>)}
                      </React.Fragment>
                    ))}
                  </ChartMenu>

                  <ChartMenu id="timezone" label="TZ" value={timezone} openMenu={openChartMenu} setOpenMenu={setOpenChartMenu} testId="chart-timezone">
                    {TIMEZONE_OPTIONS.map((option) => (
                      <ChartMenuItem key={option} active={timezone === option} onClick={() => selectChartOption(setTimezone, option, `Timezone ${option} đã chọn cho chart local.`)}>{option}</ChartMenuItem>
                    ))}
                  </ChartMenu>

                  <ChartMenu id="more" label="More" openMenu={openChartMenu} setOpenMenu={setOpenChartMenu} testId="chart-more">
                    <ChartMenuItem onClick={() => { setOpenChartMenu('go-to-date'); setChartNotice('Chọn ngày trong session hiện tại; chưa thay đổi cutoff.') }}>Go to Date…</ChartMenuItem>
                    <ChartMenuItem onClick={() => setChartNotice('Layout control local-only; chưa lưu server.')}>Layout options…</ChartMenuItem>
                    <ChartMenuItem onClick={() => setChartNotice('Keyboard shortcuts: → +1 nến · Shift + → +10 nến')}>Keyboard shortcuts</ChartMenuItem>
                  </ChartMenu>

                  {openChartMenu === 'go-to-date' && (
                    <div className="chart-control-popover chart-date-popover" role="dialog" aria-label="Go to Date">
                      <label>Go to Date<input type="date" value={goToDateDraft} onChange={(event) => setGoToDateDraft(event.target.value)} /></label>
                      <div className="chart-date-actions"><button type="button" onClick={() => setOpenChartMenu('')}>Cancel</button><button type="button" className="is-primary" onClick={() => { setChartNotice(goToDateDraft ? `Ngày ${goToDateDraft} đã chọn trong fixture.` : 'Chưa chọn ngày.'); setOpenChartMenu('') }}>Go to</button></div>
                    </div>
                  )}
                </div>
                <div className="toolbar-speed" aria-label="Tốc độ replay">
                  <span>Tốc độ</span>
                  <select value={speed} onChange={(event) => setSpeed(event.target.value)} disabled={Boolean(pendingAction)}>
                    <option value="0.5">0.5×</option>
                    <option value="1">1×</option>
                    <option value="2">2×</option>
                    <option value="4">4×</option>
                  </select>
                </div>
                <div className="cutoff-readout">
                  <span>Decision cutoff</span>
                  <strong>{formatTimestamp(replay.cutoff_timestamp)} UTC</strong>
                  <small data-testid="replay-shortcuts">Phím tắt: → +1 nến · Shift + → +10 nến</small>
                </div>
              </div>

              <div className="chart-frame">
                <ChartToolRail onSelect={selectChartRailTool} />
                <div className="chart-canvas">
                  <div className="chart-symbol-strip" aria-label="Thông tin symbol">
                    <strong>{replayContext.instrument}</strong>
                    <span>{chartInterval} · local replay</span>
                    <span className="chart-symbol-ohlc">O {formatPrice((crosshair?.row || currentBar)?.open)} · H {formatPrice((crosshair?.row || currentBar)?.high)} · L {formatPrice((crosshair?.row || currentBar)?.low)} · C {formatPrice((crosshair?.row || currentBar)?.close)}</span>
                  </div>
                  <ReplayChart rows={visibleRows} chartType={chartType} onCrosshair={setCrosshair} onAnchorSelect={handleChartAnchor} />
                  <div className="chart-badge chart-badge-left">{replay.payload.dataset_id}</div>
                  <div className="chart-badge chart-badge-right">{replay.historical_view ? 'HISTORICAL CUTOFF' : 'LIVE REPLAY CURSOR'}</div>
                  <div className="chart-floating-context" aria-live="polite">
                    {compareSymbol && <span>+ {compareSymbol}</span>}
                    {activeIndicators.length > 0 && <span>{activeIndicators.length} indicator{activeIndicators.length > 1 ? 's' : ''}</span>}
                  </div>
                </div>
                <ChartUtilityRail onSelect={selectChartRailTool} />
              </div>

              <div className="chart-bottom-bar" aria-label="Điều khiển replay phía dưới chart">
                <div className="chart-bottom-range" aria-label="Khoảng thời gian chart">
                  {['1D', '5D', '1M', '3M', '6M', '1Y', 'All'].map((range) => <button key={range} type="button" className={range === 'All' ? 'is-active' : ''} onClick={() => setChartNotice(`${range} · phạm vi hiển thị local.`)}>{range}</button>)}
                </div>
                <div className="chart-bottom-replay">
                  <button type="button" aria-label="Về nến đầu tiên" title="Về nến đầu tiên" onClick={() => { setIsPlaying(false); setJumpDraft(0); loadSession(sessionId, 0) }} disabled={historicalView || conflict || Boolean(pendingAction) || cursor <= 0}>|‹</button>
                  <button type="button" aria-label="Lùi một nến" title="Lùi một nến" onClick={() => { setIsPlaying(false); setJumpDraft(Math.max(0, cursor - 1)); loadSession(sessionId, Math.max(0, cursor - 1)) }} disabled={historicalView || conflict || Boolean(pendingAction) || cursor <= 0}>‹</button>
                  <button type="button" className="is-primary" onClick={() => setIsPlaying((current) => !current)} disabled={historicalView || completed || conflict || Boolean(pendingAction)}>{isPlaying ? 'Tạm dừng' : 'Phát replay'}</button>
                  <button type="button" aria-label="Tiến một nến" title="Tiến một nến" onClick={() => mutate('step', { expected_revision: revision, steps: 1 })} disabled={historicalView || completed || conflict || Boolean(pendingAction)}>›</button>
                  <button type="button" aria-label="Tiến mười nến" title="Tiến mười nến" onClick={() => mutate('step', { expected_revision: revision, steps: 10 })} disabled={historicalView || completed || conflict || Boolean(pendingAction)}>››</button>
                  <span className="chart-bottom-cursor">#{cursor} / #{canonicalCursor}</span>
                </div>
                <div className="chart-bottom-status"><span className="status-dot" /> Paper replay <strong>{replayContext.instrument}</strong></div>
              </div>

              {chartNotice && <div className="chart-notice" role="status">{chartNotice}<button type="button" aria-label="Đóng thông báo" onClick={() => setChartNotice('')}>×</button></div>}

              <div className="replay-evidence-strip" aria-label="Bằng chứng chart">
                <div><span className="story-label">03 · EVIDENCE</span><strong>{crosshair?.row ? 'Nến đang chọn' : 'Nến tại cutoff'}</strong></div>
                <span>{visibleRows.length} nến được phép hiển thị</span>
                <span>{replay.has_future_rows ? 'Nến tương lai đang ẩn' : 'Đã ở cuối dữ liệu'}</span>
                <span>{crosshair?.row ? `Crosshair #${visibleRows.findIndex((item) => Number(item.timestamp) === Number(crosshair.row.timestamp))}` : `Cursor #${cursor}`}</span>
              </div>

              <div className="bar-readout" aria-label="OHLC nến hiện tại">
                <span className="bar-readout-label">{crosshair?.row ? 'Crosshair' : 'Nến hiện tại'} #{crosshair?.row ? visibleRows.findIndex((item) => Number(item.timestamp) === Number(crosshair.row.timestamp)) : cursor}</span>
                <span>O <strong>{formatPrice((crosshair?.row || currentBar)?.open)}</strong></span>
                <span>H <strong>{formatPrice((crosshair?.row || currentBar)?.high)}</strong></span>
                <span>L <strong>{formatPrice((crosshair?.row || currentBar)?.low)}</strong></span>
                <span>C <strong>{formatPrice((crosshair?.row || currentBar)?.close)}</strong></span>
                {crosshair?.row && <span className="bar-readout-time">{formatTimestamp(crosshair.row.timestamp)} UTC</span>}
              </div>

              <div className="replay-jump" aria-label="Đi tới nến">
                <div className="replay-jump-heading">
                  <span>Đi tới nến đã có trong session</span>
                  <strong>#{jumpDraft} / #{canonicalCursor}</strong>
                </div>
                <input
                  data-testid="replay-jump"
                  type="range"
                  min="0"
                  max={Math.max(0, canonicalCursor)}
                  value={Math.min(jumpDraft, Math.max(0, canonicalCursor))}
                  onChange={(event) => setJumpDraft(Number(event.target.value))}
                  disabled={historicalView || conflict || Boolean(pendingAction) || canonicalCursor <= 0}
                  aria-label="Chọn nến replay"
                />
                <button type="button" onClick={jumpToCursor} disabled={historicalView || conflict || Boolean(pendingAction) || Number(jumpDraft) === cursor}>
                  Mở cutoff này
                </button>
              </div>
            </div>

            <aside className="replay-side">
              <section className="decision-panel">
                <div className="side-heading">
                  <div>
                    <span>04 · NEXT ACTION</span>
                    <strong>Quyết định tại nến #{cursor}</strong>
                  </div>
                  <span className="mode-pill">SIM</span>
                </div>
                <p>Đọc chart và ghi lại hypothesis trước khi mở bước kế tiếp. Replay này chỉ tạo bằng chứng local; không gửi lệnh broker.</p>
                <div className="decision-readout">
                  <span>Giá đóng hiện tại</span>
                  <strong>{formatPrice(currentBar?.close)}</strong>
                  <small>{formatTimestamp(currentBar?.timestamp)} UTC</small>
                </div>
                <div className="unsupported-tools" aria-label="Công cụ đang khóa">
                  <button type="button" disabled title="Annotation write authority đang khóa; click chart chỉ tạo draft local">Vẽ vùng <span>đang khóa · draft local only</span></button>
                  <button type="button" disabled title="Trade draft cần execution initialization">Trade draft <span>đang khóa · simulator init</span></button>
                </div>
                <div className={`annotation-draft ${annotationDraft?.status === 'ready' ? 'is-ready' : ''}`} data-testid="annotation-draft" aria-live="polite">
                  {!annotationDraft && <span>Bấm vào một nến để tạo annotation draft local. Chưa lưu và không có broker action.</span>}
                  {annotationDraft?.status === 'ready' && (
                    <>
                      <strong>Draft horizontal line đã chọn</strong>
                      <span>#{visibleRows.findIndex((item) => Number(item.timestamp) === Number(annotationDraft.draft.anchors[0].timestamp))} · {formatTimestamp(annotationDraft.draft.anchors[0].timestamp)} UTC · giá {formatPrice(annotationDraft.draft.anchors[0].price)}</span>
                    </>
                  )}
                  {annotationDraft?.status !== 'ready' && annotationDraft?.message && <span>{annotationDraft.message}</span>}
                </div>
                <a className="next-action-link" href={journalHref}>Mở Journal cho cutoff này →</a>
              </section>
              <details className="replay-inspect-panel" data-testid="replay-inspect">
                <summary>
                  <span>Inspect</span>
                  <strong>Context & provenance</strong>
                </summary>
                <div className="replay-inspect-body">
                  <div className="replay-inspect-takeaway">
                    <span>Decision note</span>
                    <p>{takeaway}</p>
                  </div>
                  <dl>
                    <div><dt>Instrument</dt><dd>{replayContext.instrument}</dd></div>
                    <div><dt>Timeframe</dt><dd>{replayContext.timeframe}</dd></div>
                    <div><dt>Quality</dt><dd>{replayContext.quality}</dd></div>
                    <div><dt>Provider</dt><dd>{replayContext.provider}</dd></div>
                    <div><dt>Rows</dt><dd>{replayContext.rowCount ?? 'N/A'}</dd></div>
                    <div><dt>Dataset hash</dt><dd><code>{replayContext.hash ? String(replayContext.hash).slice(0, 14) : 'Chưa có hash'}</code></dd></div>
                  </dl>
                </div>
              </details>
              <section>
                <div className="side-heading">
                  <div>
                    <span>Rewind an toàn</span>
                    <strong>Tạo nhánh mới</strong>
                  </div>
                  <span>#{branchCursor}</span>
                </div>
                <p>Chọn nến cũ rồi tạo branch. Session gốc và quyết định cũ không bị sửa.</p>
                <input
                  className="branch-range"
                  data-testid="branch-cursor"
                  type="range"
                  min="0"
                  max={historicalView ? cursor : Math.max(0, cursor - 1)}
                  value={historicalView ? cursor : Math.min(branchCursor, Math.max(0, cursor - 1))}
                  onChange={(event) => setBranchCursor(Number(event.target.value))}
                  disabled={historicalView || cursor <= 0 || conflict || Boolean(pendingAction)}
                  aria-label="Nến bắt đầu branch"
                />
                <button
                  className="secondary-action"
                  type="button"
                  data-testid="branch-replay"
                  disabled={!canBranch || Boolean(pendingAction)}
                  onClick={() => mutate('branch', { expected_revision: revision, cursor_index: branchCursor })}
                >
                  {historicalView ? `Tạo branch từ report #${cursor}` : `Tạo branch từ nến #${branchCursor}`}
                </button>
              </section>

              <section className="session-facts">
                <h2>Session</h2>
                <dl>
                  <div><dt>ID</dt><dd><code>{replay.record_id}</code></dd></div>
                  <div><dt>Branch</dt><dd><code>{replay.payload.branch_id}</code></dd></div>
                  <div><dt>Parent</dt><dd>{lineage ? <code>{lineage}</code> : 'Gốc'}</dd></div>
                  <div><dt>Dataset hash</dt><dd><code>{String(replay.dataset_sha256).slice(0, 14)}</code></dd></div>
                  <div><dt>Future values</dt><dd>Không render</dd></div>
                </dl>
              </section>
            </aside>
          </section>
        </>
      )}
    </main>
  )
}
