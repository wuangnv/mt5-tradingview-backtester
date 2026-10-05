import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  AreaSeries,
  BarSeries,
  BaselineSeries,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  createChart,
} from 'lightweight-charts'
import { useFxReplayContext } from './FxReplayShell.jsx'
import { buildWorkspaceHref } from './workspaceContext.js'
import { ReplayDrawingPrimitive } from './replayDrawingPrimitive.js'
import { DRAWING_LABELS, useReplayDrawings } from './useReplayDrawings.js'
import ReplayObjects from './ReplayObjects.jsx'
import ChartIcon from './ChartIcon.jsx'
import ChartFloatingToolbar from './ChartFloatingToolbar.jsx'
import ChartOrderPanel, { useChartOrder } from './ChartOrderPanel.jsx'
import TradingViewReplayChart from './TradingViewReplayChart.jsx'
import { money, orderLevels, marketQuotes } from './replayOrderModel.js'
import { ReplayOrderPrimitive } from './replayOrderPrimitive.js'
import './ReplayWorkspace.css'
import './ChartWorkbench.css'

function formatTimestamp(timestamp) {
  if (timestamp === null || timestamp === undefined || !Number.isFinite(Number(timestamp))) return 'Chưa có dữ liệu'
  return new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'short',
    timeStyle: 'medium',
    timeZone: 'UTC',
  }).format(new Date(Number(timestamp) * 1000))
}

function formatPrice(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return 'N/A'
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 8 }).format(Number(value))
}

function formatVolume(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return 'N/A'
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(Number(value))
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
  { id: 'line', label: 'Line' },
  { id: 'area', label: 'Area' },
  { id: 'baseline', label: 'Baseline' },
]

function ReplayChart({ rows, sessionId, chartType, showVolume, showAverage, viewportRequest, drawings, onCrosshair, onAnchorSelect, theme, levels, orderEditable, tickSize, onOrderPriceChange, orderGeneration, onOrderDragStart }) {
  const hostRef = useRef(null)
  const chartRef = useRef(null)
  const latestRef = useRef(null)
  latestRef.current = { rows, onCrosshair, onAnchorSelect, levels, orderEditable, tickSize, onOrderPriceChange, orderGeneration }
  const orderDrag = useRef(null)
  const paintFrame = useRef(null)
  const previousSessionRef = useRef(null)
  const rangeRef = useRef(null)
  const previousRowCountRef = useRef(0)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return undefined
    const chart = createChart(host, {
      width: host.clientWidth, height: host.clientHeight,
      layout: { background: { color: '#0b0d10' }, textColor: '#a4adbb', fontSize: 11 },
      grid: { vertLines: { color: '#171b21' }, horzLines: { color: '#171b21' } },
      rightPriceScale: { borderColor: '#252525', scaleMargins: { top: 0.12, bottom: 0.22 } },
      timeScale: { borderColor: '#252525', timeVisible: true, secondsVisible: false, lockVisibleTimeRangeOnResize: true },
      crosshair: { mode: 0 },
    })
    const seriesType = chartType === 'bars' ? BarSeries : chartType === 'line' ? LineSeries : chartType === 'area' ? AreaSeries : chartType === 'baseline' ? BaselineSeries : CandlestickSeries
    const series = chart.addSeries(seriesType, {
      upColor: '#14b889', downColor: '#ef5350', borderVisible: false,
      wickUpColor: '#14b889', wickDownColor: '#ef5350', color: '#d6b56f',
      lineColor: '#63b982', topColor: 'rgba(99,185,130,.20)', bottomColor: 'rgba(99,185,130,.02)',
      topLineColor: '#63b982', bottomLineColor: '#df7676', lineWidth: 2,
    })
    const volume = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: 'volume', lastValueVisible: false, priceLineVisible: false })
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } })
    const average = chart.addSeries(LineSeries, { color: '#e3ba69', lineWidth: 1, lastValueVisible: false, priceLineVisible: false })
    const drawingPrimitive = new ReplayDrawingPrimitive()
    series.attachPrimitive(drawingPrimitive)
    const orderPrimitive = new ReplayOrderPrimitive(projection => {
      cancelAnimationFrame(paintFrame.current)
      paintFrame.current = requestAnimationFrame(() => {
        for (const node of host.querySelectorAll('[data-order-level]')) {
          const y = projection?.[node.dataset.orderLevel]
          node.style.display = Number.isFinite(y) && y > 14 && y < projection.height - 14 ? 'flex' : 'none'
          if (Number.isFinite(y)) { node.style.top = `${y}px`; node.style.right = `${host.clientWidth - projection.width + 10}px` }
        }
      })
    })
    series.attachPrimitive(orderPrimitive)
    const lookup = (time) => latestRef.current.rows.find((row) => Number(row.timestamp) === Number(time))
    const crosshair = (event) => latestRef.current.onCrosshair?.(event?.time && lookup(event.time) ? { row: lookup(event.time) } : null)
    let pointerStart = null
    const pointerDown = event => {
      if (event.target.closest('.chart-order-level')) { pointerStart = null; return }
      pointerStart = event.button === 0 && event.isPrimary ? { x: event.clientX, y: event.clientY, id: event.pointerId } : null
    }
    const cancelPointer = () => { pointerStart = null }
    const pointerUp = event => {
      const start = pointerStart
      pointerStart = null
      if (!start || start.id !== event.pointerId || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4) return
      const bounds = host.getBoundingClientRect()
      const x = event.clientX - bounds.left
      const y = event.clientY - bounds.top
      if (x < 0 || x >= chart.timeScale().width() || y < 0 || y >= chart.panes()[0].getHeight()) return
      const row = lookup(chart.timeScale().coordinateToTime(x))
      const price = series.coordinateToPrice(y)
      if (row && Number.isFinite(price)) latestRef.current.onAnchorSelect?.({ timestamp: Number(row.timestamp), price })
    }
    chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (range) { host.dataset.rangeFrom = String(range.from); host.dataset.rangeTo = String(range.to) }
    })
    chart.subscribeCrosshairMove(crosshair)
    // Native pointer-up preserves rapid two-point drawings: the engine's
    // double-click recognizer otherwise drops a second distant click.
    host.addEventListener('pointerdown', pointerDown)
    host.addEventListener('pointerup', pointerUp)
    host.addEventListener('pointercancel', cancelPointer)
    chartRef.current = { chart, series, volume, average, drawingPrimitive, orderPrimitive }
    const resize = new ResizeObserver(() => chart.applyOptions({ width: host.clientWidth, height: host.clientHeight }))
    resize.observe(host)
    return () => {
      rangeRef.current = chart.timeScale().getVisibleLogicalRange()
      resize.disconnect()
      cancelAnimationFrame(paintFrame.current)
      chart.unsubscribeCrosshairMove(crosshair)
      host.removeEventListener('pointerdown', pointerDown)
      host.removeEventListener('pointerup', pointerUp)
      host.removeEventListener('pointercancel', cancelPointer)
      chart.remove()
      chartRef.current = null
    }
  }, [chartType])

  useEffect(() => {
    const light = theme === 'light'
    chartRef.current?.chart.applyOptions({
      layout: { background: { color: light ? '#ffffff' : '#0b0d10' }, textColor: light ? '#526074' : '#a4adbb' },
      grid: { vertLines: { color: light ? '#f0f2f5' : '#171b21' }, horzLines: { color: light ? '#f0f2f5' : '#171b21' } },
      rightPriceScale: { borderColor: light ? '#e5e8ee' : '#242932' }, timeScale: { borderColor: light ? '#e5e8ee' : '#242932' },
    })
    chartRef.current?.series.applyOptions({ upColor: light ? '#07845f' : '#14b889', downColor: light ? '#ce3f47' : '#ef5350',
      wickUpColor: light ? '#07845f' : '#14b889', wickDownColor: light ? '#ce3f47' : '#ef5350',
      lineColor: light ? '#07845f' : '#14b889', color: light ? '#94641d' : '#d6b56f',
      topLineColor: light ? '#07845f' : '#14b889', bottomLineColor: light ? '#ce3f47' : '#ef5350' })
    chartRef.current?.average.applyOptions({ color: light ? '#94641d' : '#e3ba69' })
    chartRef.current?.orderPrimitive.setTheme(theme)
    chartRef.current?.drawingPrimitive.setTheme(theme)
  }, [chartType, theme])

  useEffect(() => { chartRef.current?.orderPrimitive.setLevels(levels) }, [levels, chartType])

  useEffect(() => {
    const instance = chartRef.current
    if (!instance) return
    const { chart, series, volume, average } = instance
    const previousRange = chart.timeScale().getVisibleLogicalRange() || rangeRef.current
    const sameSession = previousSessionRef.current === sessionId
    const data = rows.map((row) => ({ time: Number(row.timestamp), open: Number(row.open), high: Number(row.high), low: Number(row.low), close: Number(row.close) }))
    const prices = data.flatMap((row) => [row.open, row.high, row.low, row.close])
    const precision = prices.reduce((max, price) => {
      let digits = 2
      while (digits < 8 && Math.abs(Number(price.toFixed(digits)) - price) > 1e-10) digits += 1
      return Math.max(max, digits)
    }, 2)
    series.applyOptions({ priceFormat: { type: 'price', precision, minMove: 10 ** -precision } })
    series.setData(chartType === 'candles' || chartType === 'bars' ? data : data.map((row) => ({ time: row.time, value: row.close })))
    if (chartType === 'baseline' && data.length) series.applyOptions({ baseValue: { type: 'price', price: data[0].close } })
    volume.setData(rows.filter((row) => (row.volume ?? row.tick_volume) !== null && (row.volume ?? row.tick_volume) !== undefined && Number.isFinite(Number(row.volume ?? row.tick_volume))).map((row) => ({ time: Number(row.timestamp), value: Number(row.volume ?? row.tick_volume), color: Number(row.close) >= Number(row.open) ? '#264c39' : '#603737' })))
    let sum = 0
    const sma = []
    data.forEach((row, index) => {
      sum += row.close
      if (index >= 20) sum -= data[index - 20].close
      if (index >= 19) sma.push({ time: row.time, value: sum / 20 })
    })
    average.setData(sma)
    // A replay step updates this instance instead of destroying its pan/zoom and canvas.
    // The server-visible prefix is the only dataset ever handed to the renderer.
    if (sameSession && previousRange && previousRange.from < rows.length) {
      const added = Math.max(0, rows.length - previousRowCountRef.current)
      const follow = previousRange.to >= previousRowCountRef.current - 1
      chart.timeScale().setVisibleLogicalRange(follow && added ? { from: previousRange.from + added, to: previousRange.to + added } : previousRange)
    } else if (rows.length < 60) chart.timeScale().setVisibleLogicalRange({ from: rows.length - 60, to: rows.length + 2 })
    else chart.timeScale().fitContent()
    previousRowCountRef.current = rows.length
    previousSessionRef.current = sessionId
    rangeRef.current = null
  }, [chartType, rows, sessionId])

  useEffect(() => {
    chartRef.current?.volume.applyOptions({ visible: showVolume })
    chartRef.current?.average.applyOptions({ visible: showAverage })
  }, [chartType, showAverage, showVolume])

  useEffect(() => {
    chartRef.current?.drawingPrimitive.setDrawings(drawings)
  }, [drawings, chartType])

  useEffect(() => {
    const instance = chartRef.current
    if (!instance || !viewportRequest || !rows.length) return
    const scale = instance.chart.timeScale()
    if (viewportRequest.kind === 'fit') scale.fitContent()
    else if (viewportRequest.kind === 'latest') scale.setVisibleLogicalRange({ from: Math.max(-1, rows.length - 80), to: rows.length + 2 })
    else if (viewportRequest.kind === 'range') {
      const cutoff = Number(rows.at(-1).timestamp) - viewportRequest.days * 86400
      const index = rows.findIndex((row) => Number(row.timestamp) >= cutoff)
      scale.setVisibleLogicalRange({ from: Math.max(-1, index - 1), to: rows.length + 1 })
    }
  }, [viewportRequest])

  const lastBar = rows.at(-1)
  const dragPrice = event => {
    const instance = chartRef.current
    if (!instance) return null
    const value = instance.series.coordinateToPrice(event.clientY - hostRef.current.getBoundingClientRect().top)
    const tick = Number(latestRef.current.tickSize)
    return Number.isFinite(value) && value > 0 ? Number((tick > 0 ? Math.round(value / tick) * tick : value).toFixed(8)) : null
  }
  const endDrag = (event, commit) => {
    const drag = orderDrag.current
    orderDrag.current = null
    chartRef.current?.orderPrimitive.setLevels(latestRef.current.levels)
    if (drag && commit && latestRef.current.orderEditable && drag.generation === latestRef.current.orderGeneration) {
      const value = dragPrice(event)
      if (value) latestRef.current.onOrderPriceChange(drag.kind, value)
    }
  }
  return <div ref={hostRef} className="replay-chart" role="group" data-testid="replay-chart" data-visible-row-count={rows.length} data-visible-object-count={drawings.filter(record => !record.hidden).length} aria-label={`Biểu đồ replay với ${rows.length} nến đã mở. Nến cuối: ${formatTimestamp(lastBar?.timestamp)} UTC, mở ${formatPrice(lastBar?.open)}, cao ${formatPrice(lastBar?.high)}, thấp ${formatPrice(lastBar?.low)}, đóng ${formatPrice(lastBar?.close)}. Cuộn để zoom, kéo để pan; bấm nến để chọn mốc giá.`}>
    {levels && ['entry', 'stop', 'target'].map(kind => kind === 'entry'
      ? <span key={kind} className="chart-order-level is-entry" data-order-level={kind}>{levels.side} · {levels.state === 'draft' ? 'Nháp entry' : levels.state === 'queued' ? 'Chờ fill' : 'Entry'} {formatPrice(levels.entry)}{levels.floating !== null && <> · P/L {money(levels.floating, levels.currency)}</>}</span>
      : <button key={kind} type="button" className={`chart-order-level is-${kind}`} data-order-level={kind} aria-label={`${kind === 'stop' ? 'Kéo Stop loss' : 'Kéo Take profit'}`} title="Kéo đổi giá · phím ↑ ↓ chỉnh một tick" disabled={!orderEditable}
        onPointerDown={event => { if (!latestRef.current.orderEditable || event.button !== 0) return; event.preventDefault(); event.stopPropagation(); onOrderDragStart(); event.currentTarget.setPointerCapture(event.pointerId); orderDrag.current = { kind, generation: latestRef.current.orderGeneration } }}
        onPointerMove={event => { if (!orderDrag.current) return; const value = dragPrice(event); if (value) chartRef.current?.orderPrimitive.setLevels({ ...latestRef.current.levels, [kind]: value }) }}
        onPointerUp={event => endDrag(event, true)} onPointerCancel={event => endDrag(event, false)}
        onKeyDown={event => { if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return; event.preventDefault(); event.stopPropagation(); const tick = Number(tickSize); if (tick > 0) onOrderPriceChange(kind, Number((levels[kind] + (event.key === 'ArrowUp' ? tick : -tick)).toFixed(8))) }}>
        <ChartIcon name="grip" />{kind === 'stop' ? 'SL' : 'TP'}{levels.state === 'edit' ? ' nháp' : ''} {formatPrice(levels[kind])}
      </button>)}
  </div>
}

function replaceSessionInUrl(sessionId, preserveCursor = false, cursor = null, dataset = null) {
  const url = new URL(window.location.href)
  url.searchParams.set('view', 'replay')
  url.searchParams.set('surface', 'workspace')
  url.searchParams.delete('select')
  url.searchParams.delete('fresh')
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
  const { updateMarketContext, appearance, applyAppearance } = useFxReplayContext()
  const theme = appearance?.theme || 'dark'
  const advancedChart = query.get('chart_engine') !== 'lightweight'
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
  const [chartType, setChartType] = useState('candles')
  const [showVolume, setShowVolume] = useState(true)
  const [showAverage, setShowAverage] = useState(false)
  const [sideOpen, setSideOpen] = useState(false)
  const [sidePanel, setSidePanel] = useState('context')
  const [headerSlot, setHeaderSlot] = useState(null)
  const [nativeHeaderSlots, setNativeHeaderSlots] = useState(null)
  const [indicatorsOpen, setIndicatorsOpen] = useState(false)
  const [drawingTool, setDrawingTool] = useState('cross')
  const [pendingAnchor, setPendingAnchor] = useState(null)
  const [drawingLabel, setDrawingLabel] = useState('')
  const [viewportRequest, setViewportRequest] = useState(null)
  const [goToDateDraft, setGoToDateDraft] = useState('')
  const [chartNotice, setChartNotice] = useState('')
  const actionLock = useRef(false)
  const sessionRequest = useRef(null)
  const sideToggleRef = useRef(null)
  const sideRef = useRef(null)
  const sideTriggerRef = useRef(null)
  const indicatorsRef = useRef(null)
  const requestViewport = (kind, extras = {}) => setViewportRequest({ kind, ...extras, id: Date.now() })
  useEffect(() => { setHeaderSlot(document.getElementById('replay-command-slot')) }, [])
  useEffect(() => {
    if (!indicatorsOpen) return
    const dismiss = event => { if (!indicatorsRef.current?.contains(event.target)) setIndicatorsOpen(false) }
    const escape = event => { if (event.key === 'Escape') { setIndicatorsOpen(false); indicatorsRef.current?.querySelector('button')?.focus() } }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape) }
  }, [indicatorsOpen])
  const openPanel = (panel, source) => {
    const focused = document.activeElement
    const trigger = source || (focused?.tagName === 'IFRAME' ? focused.contentDocument?.activeElement : focused)
    if (trigger?.focus && trigger !== trigger.ownerDocument?.body && !sideRef.current?.contains(trigger)) sideTriggerRef.current = trigger
    if (panel === 'order') setIsPlaying(false)
    setSidePanel(panel); setSideOpen(true)
  }

  const rememberSession = useCallback((nextSessionId, preserveCursor = false, cursor = null, dataset = null) => {
    setSessionId(nextSessionId)
    window.localStorage.setItem(storageKey, nextSessionId)
    replaceSessionInUrl(nextSessionId, preserveCursor, cursor, dataset)
  }, [storageKey])

  const loadSession = useCallback(async (targetSessionId, targetCursor = null) => {
    if (!targetSessionId) return
    sessionRequest.current?.abort()
    const controller = new AbortController()
    sessionRequest.current = controller
    setIsPlaying(false)
    setState((current) => ({ status: 'loading', payload: current.payload, error: null }))
    setConflict(false)
    try {
      const suffix = targetCursor === null ? '' : `?cursor_index=${encodeURIComponent(targetCursor)}`
      const response = await fetch(`/api/v2/replay/sessions/${encodeURIComponent(targetSessionId)}${suffix}`, {
        signal: controller.signal,
        headers: { 'X-Workspace-Id': workspace },
      })
      const payload = await readJson(response)
      if (controller.signal.aborted) return
      const viewCursor = Number(payload.view_cursor_index ?? payload.payload.cursor_index)
      rememberSession(payload.record_id, true, viewCursor, payload.payload?.dataset_id)
      setBranchCursor(payload.historical_view ? Math.max(0, viewCursor) : Math.max(0, viewCursor - 1))
      setJumpDraft(Math.max(0, viewCursor))
      setState({ status: 'ready', payload, error: null })
    } catch (error) {
      if (!controller.signal.aborted) setState({ status: 'error', payload: null, error: String(error.message || error) })
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
      actionLock.current = false
      setPendingAction('')
    }
  }, [datasetDraft, rememberSession, startDraft, workspace])

  const loadDatasets = useCallback(async () => {
    setDatasetState(current => ({ ...current, status: 'loading', error: null }))
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
      setDatasetState(current => ({ ...current, status: 'error', error: String(error.message || error) }))
    }
  }, [datasetDraft, requestedDataset, workspace])

  useEffect(() => {
    const refresh = () => {
      if (pendingAction) return
      loadDatasets()
      if (state.status === 'error' && sessionId && requestedCursorValid) loadSession(sessionId, requestedCursor)
    }
    window.addEventListener('focus', refresh)
    window.addEventListener('online', refresh)
    return () => { window.removeEventListener('focus', refresh); window.removeEventListener('online', refresh) }
  }, [loadDatasets, loadSession, pendingAction, requestedCursor, requestedCursorValid, sessionId, state.status])

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
      loadDatasets()
      loadSession(persisted)
      return
    }
    loadDatasets()
    if (requestedDataset) createSession()
  }, []) // Resolve the initial resume once from URL -> persisted session -> dataset.

  useEffect(() => () => sessionRequest.current?.abort(), [])

  const mutate = useCallback(async (kind, body) => {
    if (!sessionId || !state.payload || state.status !== 'ready' || actionLock.current) return
    actionLock.current = true
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
      actionLock.current = false
      setPendingAction('')
    }
  }, [rememberSession, sessionId, state.payload, state.status, workspace])

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

  const drawings = useReplayDrawings({ workspace, sessionId, rows: visibleRows, cutoff: Number(replay?.cutoff_timestamp), instrument: replayContext.instrument, timeframe: replayContext.timeframe })
  const chooseDrawingTool = tool => {
    setDrawingTool(tool)
    setPendingAnchor(null)
    setChartNotice(tool === 'cross' ? '' : ['trendline', 'zone', 'measure'].includes(tool) ? 'Bấm hai nến để chọn hai mốc thời gian và giá.' : 'Bấm một nến để chọn mốc thời gian và giá.')
  }

  const handleChartAnchor = useCallback((anchor) => {
    if (drawingTool === 'cross' || state.status !== 'ready' || pendingAction) return
    const cutoffTimestamp = Number(replay?.cutoff_timestamp)
    const row = visibleRows.find((item) => Number(item.timestamp) === Number(anchor?.timestamp))
    // Keep the local draft fail-closed even if a renderer/plugin hands us a
    // timestamp outside the API-visible prefix.  The backend remains the
    // authority for persisted annotations; this only creates a local draft.
    if (!row || !Number.isSafeInteger(cutoffTimestamp) || Number(anchor?.timestamp) > cutoffTimestamp) {
      setAnnotationDraft({ status: 'rejected', message: 'Mốc chart không thuộc cutoff đang hiển thị.' })
      return
    }
    try {
      const twoAnchors = ['trendline', 'zone', 'measure'].includes(drawingTool)
      if (twoAnchors && !pendingAnchor) {
        setPendingAnchor(anchor)
        setChartNotice('Đã chọn mốc thứ nhất. Bấm nến thứ hai để hoàn tất; Escape để hủy.')
        return
      }
      const anchors = twoAnchors ? [pendingAnchor, anchor] : [anchor]
      const type = drawingTool === 'level' ? 'horizontal-line' : drawingTool
      let label = drawingLabel.trim() || DRAWING_LABELS[type]
      if (type === 'measure') {
        const delta = anchor.price - pendingAnchor.price
        const percent = pendingAnchor.price === 0 ? 'N/A' : `${(delta / pendingAnchor.price * 100).toFixed(2)}%`
        const bars = Math.abs(visibleRows.findIndex(row => row.timestamp === anchor.timestamp) - visibleRows.findIndex(row => row.timestamp === pendingAnchor.timestamp))
        label = `${delta >= 0 ? '+' : ''}${delta.toFixed(5)} (${percent}) · ${bars} nến`
      }
      const record = drawings.add(type, anchors, label)
      setAnnotationDraft({ status: 'ready', draft: record.payload, recordId: record.record_id })
      setPendingAnchor(null)
      setChartNotice(type === 'measure' ? `Đo local: ${label}` : `${DRAWING_LABELS[type]} đã tạo dạng nháp. Mở Chi tiết & nhánh để lưu.`)
    } catch (error) {
      setAnnotationDraft({ status: 'unavailable', message: String(error.message || error) })
    }
  }, [drawingLabel, drawingTool, drawings.add, pendingAction, pendingAnchor, replay, replayContext.instrument, replayContext.timeframe, state.status, visibleRows])

  useEffect(() => {
    // A cursor/session change invalidates a previously selected chart anchor.
    setAnnotationDraft((current) => current?.draft?.cutoff_timestamp <= Number(replay?.cutoff_timestamp) ? current : null)
    setPendingAnchor(null)
    setCrosshair(null)
  }, [sessionId, cursor, revision])

  useEffect(() => { setAnnotationDraft(null) }, [sessionId])

  useEffect(() => {
    const cancelDrawing = event => {
      if (event.key === 'Escape') { setPendingAnchor(null); setChartNotice('') }
    }
    window.addEventListener('keydown', cancelDrawing)
    return () => window.removeEventListener('keydown', cancelDrawing)
  }, [])

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
  const canOpenOrder = Boolean(replay) && state.status === 'ready' && !historicalView && !conflict && !pendingAction
  const submitOrder = async (endpoint, body) => {
    if (!canOpenOrder || completed || actionLock.current) return false
    actionLock.current = true
    setPendingAction('order')
    setIsPlaying(false)
    try {
      const response = await fetch(`/api/v2/replay/sessions/${encodeURIComponent(sessionId)}/${endpoint}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Workspace-Id': workspace },
        body: JSON.stringify({ ...body, expected_revision: revision }),
      })
      const next = await readJson(response)
      setState({ status: 'ready', payload: next, error: null })
      return true
    } catch (error) {
      if (error.code === 'revision_conflict') { setConflict(true); throw new Error('Phiên đã đổi ở nơi khác. Nạp trạng thái mới trước khi sửa lệnh.') }
      throw error
    } finally { actionLock.current = false; setPendingAction('') }
  }
  const order = useChartOrder({ replay, dataset: activeDataset, ready: state.status === 'ready', blocked: historicalView || completed || conflict || Boolean(pendingAction), submit: submitOrder })
  const priceLevels = order.active || (!historicalView && sideOpen && sidePanel === 'order') ? orderLevels(replay, order.draft) : null
  const quotes = marketQuotes(replay)
  const orderBlockedReason = historicalView ? 'Cutoff lịch sử chỉ đọc. Về cursor mới nhất hoặc tạo nhánh để đặt lệnh.' : completed ? 'Dataset đã kết thúc; không còn nến để fill hoặc sửa lệnh.' : conflict ? 'Đang khóa vì revision đã thay đổi.' : ''
  const beginOrder = side => { setIsPlaying(false); order.chooseSide(side); openPanel('order') }
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
    const delay = Math.max(180, 1100 / Math.max(0.5, Number(speed) || 1))
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
    if (sideOpen) sideRef.current?.focus()
  }, [sideOpen, sidePanel])
  const closeSide = () => { setSideOpen(false); (sideTriggerRef.current || sideToggleRef.current)?.focus() }
  const goToDate = () => {
    const timestamp = Date.parse(goToDateDraft + 'Z') / 1000
    if (!Number.isFinite(timestamp) || timestamp > Number(replay?.cutoff_timestamp)) {
      setChartNotice('Chọn thời điểm UTC không vượt quá cutoff đang xem.')
      return
    }
    const index = visibleRows.findIndex((row) => Number(row.timestamp) >= timestamp)
    if (index < 0) { setChartNotice('Không có nến ở thời điểm này trong phần dữ liệu đã mở.'); return }
    setChartNotice('')
    loadSession(sessionId, index)
  }
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
    return isPlaying ? 'Đang phát' : 'Tạm dừng'
  }, [completed, conflict, historicalView, isPlaying, state.status])

  const takeaway = useMemo(() => {
    if (conflict) return 'Session có revision mới; cần tải lại trước khi tiếp tục để giữ đúng lineage.'
    if (historicalView) return `Đây là cutoff lịch sử #${cursor}; phần dữ liệu sau mốc này đang bị ẩn có chủ đích.`
    if (completed) return `Replay đã đi tới nến cuối của dataset; không còn nến tương lai để mở thêm.`
    return `Đang mở ${visibleRowCount ?? 'N/A'} nến; quyết định chỉ nên dựa trên bằng chứng tới cutoff hiện tại.`
  }, [completed, conflict, cursor, historicalView, visibleRowCount])
  const noDataset = datasetState.status === 'ready' && datasetState.items.length === 0
  const dataDeskHref = routeHref('data')

  return (
    <main className={`replay-shell wm-chart-page ${sideOpen ? 'is-panel-open' : ''} ${replay ? 'has-replay' : ''} ${advancedChart && nativeHeaderSlots ? 'is-legacy-chart' : ''}`}>
      {advancedChart && nativeHeaderSlots && <>
        {createPortal(<div className="legacy-header-identity"><a href={routeHref('replay', { surface: null, select: '1' })} aria-label="Trở về Sessions" title="Trở về Sessions">←</a><button type="button" onClick={event => openPanel('data', event.currentTarget)} title="Chọn dataset local"><ChartIcon name="search" /><strong>{replayContext.instrument}</strong></button></div>, nativeHeaderSlots.market)}
        {createPortal(<div className="legacy-header-session"><strong title={replay?.payload.name || sessionId}>{replay?.payload.name || 'Replay'}</strong><span data-testid="replay-status">{statusLabel}</span><button type="button" onClick={() => applyAppearance({ ...appearance, theme: theme === 'dark' ? 'light' : 'dark' })} aria-label={theme === 'dark' ? 'Chuyển giao diện sáng' : 'Chuyển giao diện tối'} title="Đổi giao diện" data-testid="theme-toggle"><ChartIcon name={theme === 'dark' ? 'moon' : 'sun'} /></button><button type="button" onClick={event => openPanel('context', event.currentTarget)} aria-label="Chi tiết và nhánh" title="Chi tiết và nhánh"><ChartIcon name="info" /></button></div>, nativeHeaderSlots.session)}
      </>}
      {headerSlot && replay && !nativeHeaderSlots && createPortal(<div className="chart-command-row" role="group" aria-label="Thanh công cụ chart">
        <button type="button" className="chart-market-command" onClick={() => openPanel('data')} title="Đổi instrument/timeframe bằng dataset local"><strong>{replayContext.instrument}</strong>{!advancedChart && <span>{replayContext.timeframe}</span>}</button>
        {!advancedChart && <><label className="chart-type-command"><ChartIcon name="candles" /><select aria-label="Kiểu chart" value={chartType} onChange={event => setChartType(event.target.value)}>{CHART_TYPES.map(type => <option key={type.id} value={type.id}>{type.label}</option>)}</select></label>
        <div className="chart-indicators-command" ref={indicatorsRef}><button type="button" aria-expanded={indicatorsOpen} aria-controls={indicatorsOpen ? 'chart-indicators' : undefined} onClick={() => setIndicatorsOpen(current => !current)}>Indicators</button>
          {indicatorsOpen && <div id="chart-indicators" className="chart-indicators-menu" onKeyDown={event => { if (event.key === 'Escape') { setIndicatorsOpen(false); event.currentTarget.previousElementSibling.focus() } }}><label><input type="checkbox" checked={showVolume} onChange={event => setShowVolume(event.target.checked)} /> Volume</label><label><input type="checkbox" checked={showAverage} onChange={event => setShowAverage(event.target.checked)} /> SMA 20</label></div>}
        </div></>}
        <a href={routeHref('analytics', { surface: 'workspace' })}><ChartIcon name="analytics" /><span>Analytics</span></a>
        <button type="button" ref={sideToggleRef} aria-expanded={sideOpen && sidePanel === 'context'} aria-controls="replay-context-panel" onClick={() => sideOpen && sidePanel === 'context' ? closeSide() : openPanel('context')}><ChartIcon name="info" /><span>Chi tiết & nhánh</span></button>
        <span className="chart-session-name" title={replay.payload.name || sessionId}>{replay.payload.name || `${replayContext.instrument} · Replay`}</span>
        <span className={`chart-session-state ${historicalView || conflict ? 'is-warning' : ''}`} data-testid="replay-status">{statusLabel}</span>
      </div>, headerSlot)}
      <header className="replay-topbar">
        <div>
          <h1>Practice · Replay</h1>
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
            <h2>Mở replay</h2>
            <p>Chọn dataset và nến bắt đầu. Replay mô phỏng, chỉ hiển thị dữ liệu tới cutoff hiện tại.</p>
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
      {state.status === 'error' && <div className="replay-message replay-error" role="alert">Không đọc được replay: {state.error}</div>}

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
            <div className={`replay-state ${completed ? 'is-complete' : ''} ${conflict ? 'is-conflict' : ''}`}>
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
              <div className={`chart-frame ${advancedChart ? 'has-advanced-chart' : ''}`}>
                {!advancedChart && <nav className="chart-tool-rail" aria-label="Công cụ chart">
                  <button type="button" aria-label="Chỉ xem crosshair" title="Chỉ xem crosshair" aria-pressed={drawingTool === 'cross'} onClick={() => chooseDrawingTool('cross')}><ChartIcon name="cross" /></button>
                  <button type="button" aria-label="Chọn đường giá local" title="Bấm nến để chọn đường giá local" aria-pressed={drawingTool === 'level'} onClick={() => chooseDrawingTool('level')}><ChartIcon name="level" /></button>
                  <button type="button" aria-label="Vẽ đường xu hướng" title="Vẽ đường xu hướng bằng hai mốc" aria-pressed={drawingTool === 'trendline'} onClick={() => chooseDrawingTool('trendline')}><ChartIcon name="trendline" /></button>
                  <button type="button" aria-label="Vẽ vùng giá" title="Vẽ vùng giá bằng hai mốc" aria-pressed={drawingTool === 'zone'} onClick={() => chooseDrawingTool('zone')}><ChartIcon name="zone" /></button>
                  <button type="button" aria-label="Thêm ghi chú chart" title="Ghi chú tại mốc giá" aria-pressed={drawingTool === 'text'} onClick={() => chooseDrawingTool('text')}><ChartIcon name="text" /></button>
                  <button type="button" aria-label="Đo giá giữa hai mốc" title="Đo thay đổi giá và số nến giữa hai mốc" aria-pressed={drawingTool === 'measure'} onClick={() => chooseDrawingTool('measure')}><ChartIcon name="measure" /></button>
                  <button type="button" aria-label="Mở danh sách đối tượng" title="Chi tiết và đối tượng chart" aria-expanded={sideOpen} aria-controls="replay-context-panel" onClick={() => openPanel('objects')}><ChartIcon name="objects" /></button>
                  <button type="button" aria-label="Vừa toàn bộ nến đã mở" title="Vừa toàn bộ nến đã mở" onClick={() => requestViewport('fit')}><ChartIcon name="fit" /></button>
                </nav>}
                <div className="chart-canvas">
                  {advancedChart && nativeHeaderSlots && <ChartFloatingToolbar name="Công cụ vẽ yêu thích" storageKey={`tw:chart:native-draw-toolbar:${workspace}`} initialPosition={{ x: 64, y: 90 }} compactMinimumY={170} insetLeft={54}>
                    {[['trend_line', 'Đường xu hướng', 'trendline'], ['horizontal_line', 'Đường giá', 'level'], ['rectangle', 'Vùng giá', 'zone'], ['fib_retracement', 'Fibonacci retracement', 'fib'], ['long_position', 'Long position', 'long'], ['short_position', 'Short position', 'short']].map(([tool, label, icon]) => <button key={tool} type="button" aria-label={`Vẽ ${label}`} title={label} onClick={() => nativeHeaderSlots.selectDrawing(tool)}><ChartIcon name={icon} /></button>)}
                  </ChartFloatingToolbar>}
                  {!advancedChart && <><div className="chart-symbol-strip" role="group" aria-label="Thông tin symbol">
                    <strong>{replayContext.instrument}</strong>
                    <span>{replayContext.timeframe} · UTC</span>
                    <span className="chart-symbol-ohlc">O {formatPrice((crosshair?.row || currentBar)?.open)} · H {formatPrice((crosshair?.row || currentBar)?.high)} · L {formatPrice((crosshair?.row || currentBar)?.low)} · C {formatPrice((crosshair?.row || currentBar)?.close)} · V {formatVolume((crosshair?.row || currentBar)?.volume ?? (crosshair?.row || currentBar)?.tick_volume)}</span>
                  </div>
                  <ChartFloatingToolbar name="Công cụ vẽ" storageKey={`tw:chart:draw-toolbar:${workspace}`} initialPosition={{ x: 22, y: 46 }}>
                    {['cross', 'level', 'trendline', 'zone', 'text', 'measure'].map(tool => <button key={tool} type="button" aria-label={`Công cụ nhanh ${tool}`} title={tool === 'level' ? 'Đường giá' : DRAWING_LABELS[tool] || 'Crosshair'} aria-pressed={drawingTool === tool} onClick={() => chooseDrawingTool(tool)}><ChartIcon name={tool} /></button>)}
                    {drawingTool === 'text' && <input aria-label="Nội dung ghi chú chart" maxLength={256} value={drawingLabel} onChange={event => setDrawingLabel(event.target.value)} placeholder="Ghi chú tại mốc" />}
                  </ChartFloatingToolbar></>}
                  <ChartFloatingToolbar name="Replay" compactRow={1} compactMinimumY={advancedChart ? 120 : undefined} insetLeft={advancedChart ? 54 : 0} storageKey={`tw:chart:replay-toolbar:${advancedChart ? 'legacy:' : ''}${workspace}`} initialPosition={{ x: advancedChart ? 760 : 330, y: advancedChart ? 90 : 46 }}>
                    <button type="button" aria-label="Lùi một nến" title="Lùi một nến (chỉ đọc)" onClick={() => loadSession(sessionId, Math.max(0, cursor - 1))} disabled={conflict || Boolean(pendingAction) || state.status !== 'ready' || cursor <= 0}><ChartIcon name="back" /></button>
                    {advancedChart && <input type="range" className="legacy-speed-slider" aria-label="Điều chỉnh tốc độ replay" min="0" max="3" step="1" value={['0.5', '1', '2', '4'].indexOf(String(speed))} onChange={event => setSpeed(['0.5', '1', '2', '4'][Number(event.target.value)])} disabled={Boolean(pendingAction)} />}
                    <button type="button" className="chart-play" data-testid="play-toggle" aria-label={isPlaying ? 'Tạm dừng' : 'Phát replay'} title="Phát / tạm dừng replay" onClick={() => setIsPlaying(current => !current)} disabled={historicalView || completed || conflict || Boolean(pendingAction) || state.status !== 'ready'}><ChartIcon name={isPlaying ? 'pause' : 'play'} /></button>
                    <button type="button" data-testid="step-1" aria-label="Tiến một nến" title="→ Tiến một nến" aria-keyshortcuts="ArrowRight" onClick={() => mutate('step', { expected_revision: revision, steps: 1 })} disabled={historicalView || completed || conflict || Boolean(pendingAction) || state.status !== 'ready'}><ChartIcon name="step" /></button>
                    <button type="button" data-testid="step-10" aria-label="Tiến mười nến" title="Shift + → Tiến mười nến" aria-keyshortcuts="Shift+ArrowRight" onClick={() => mutate('step', { expected_revision: revision, steps: 10 })} disabled={historicalView || completed || conflict || Boolean(pendingAction) || state.status !== 'ready'}>10</button>
                    <select aria-label="Tốc độ replay" value={speed} onChange={event => setSpeed(event.target.value)} disabled={Boolean(pendingAction)}>{['0.5', '1', '2', '4'].map(value => <option key={value} value={value}>{value}×</option>)}</select>
                    <span className="chart-float-cutoff" title={formatTimestamp(replay.cutoff_timestamp) + ' UTC'}>#{cursor}</span>
                  </ChartFloatingToolbar>
                  {advancedChart && <div className="legacy-quick-actions" role="group" aria-label="Hành động nhanh chart"><button type="button" onClick={() => openPanel('goto')}><ChartIcon name="goto" />Go To</button><button type="button" onClick={() => openPanel('order')}><ChartIcon name="order" />Order</button><button type="button" onClick={() => openPanel('news')}><ChartIcon name="news" />News</button><a href={journalHref}><ChartIcon name="journal" />Journal</a></div>}
                  {advancedChart ? <TradingViewReplayChart key={`${sessionId}:${replay.payload.dataset_id}:${historicalView ? cursor : 'canonical'}`}
                    workspace={workspace} datasetId={replay.payload.dataset_id} symbol={replayContext.instrument} assetClass={order.instrument?.asset_class} seconds={activeDataset?.timeframe_seconds || replay.payload.execution?.timeframe_seconds}
                    cutoff={Number(replay.cutoff_timestamp)} theme={theme} levels={priceLevels} orderEditable={!order.disabled} orderGeneration={`${sessionId}:${revision}:${cursor}`}
                    onOrderDragStart={() => setIsPlaying(false)} tickSize={order.instrument?.tick_size} onOrderPriceChange={order.changePrice} rows={visibleRows} sessionId={sessionId}
                    viewportRequest={viewportRequest} drawings={drawings.objects} onCrosshair={setCrosshair} onHeaderSlots={setNativeHeaderSlots} />
                    : <ReplayChart theme={theme} levels={priceLevels} orderEditable={!order.disabled} orderGeneration={`${sessionId}:${revision}:${cursor}`} onOrderDragStart={() => setIsPlaying(false)} tickSize={order.instrument?.tick_size} onOrderPriceChange={order.changePrice} rows={visibleRows} sessionId={sessionId} chartType={chartType} showVolume={showVolume} showAverage={showAverage} viewportRequest={viewportRequest} drawings={drawings.objects} onCrosshair={setCrosshair} onAnchorSelect={handleChartAnchor} />}
                  <div className="chart-badge chart-badge-left">{replay.payload.dataset_id}</div>
                  <div className="chart-badge chart-badge-right">{replay.historical_view ? 'HISTORICAL CUTOFF' : 'LIVE REPLAY CURSOR'}</div>
                </div>
                <nav className="chart-utility-rail" aria-label="Tiện ích replay">
                  {advancedChart && <div className="legacy-rail-tools"><button type="button" aria-label="Cây đối tượng chart" title="Cây đối tượng chart" disabled={!nativeHeaderSlots} onClick={() => nativeHeaderSlots.openTree()}><ChartIcon name="layers" /></button>{[['objects', 'Ghi chú workspace', 'objects'], ['data', 'Dữ liệu', 'data']].map(([panel, label, icon]) => <button key={panel} type="button" aria-label={label} title={label} aria-pressed={sideOpen && sidePanel === panel} onClick={() => sideOpen && sidePanel === panel ? closeSide() : openPanel(panel)}><ChartIcon name={icon} /></button>)}
                  <button type="button" aria-label="Chụp chart PNG" title="Tải ảnh chart tại cutoff · không upload" disabled={!nativeHeaderSlots} onClick={() => nativeHeaderSlots.capture()}><ChartIcon name="camera" /></button></div>}
                  {(advancedChart ? [['order', 'Lệnh mô phỏng', 'order', 'Order'], ['goto', 'Đi tới cutoff', 'goto', 'Go To'], ['news', 'Tin tức', 'news', 'News'], ['context', 'Chi tiết replay', 'info', 'Chi tiết']] : [['order', 'Lệnh mô phỏng', 'order'], ['objects', 'Danh sách đối tượng', 'objects'], ['data', 'Danh sách dữ liệu', 'data'], ['context', 'Chi tiết replay', 'info']]).map(([panel, label, icon, caption]) => <button key={panel} type="button" aria-label={label} title={label} aria-pressed={sideOpen && sidePanel === panel} onClick={() => sideOpen && sidePanel === panel ? closeSide() : openPanel(panel)}><ChartIcon name={icon} />{caption && <span>{caption}</span>}</button>)}
                  <a aria-label="Journal tại cutoff này" title="Journal tại cutoff này" href={journalHref}><ChartIcon name="journal" />{advancedChart && <span>Journal</span>}</a>
                  {advancedChart && <button type="button" className="legacy-mobile-theme" onClick={() => applyAppearance({ ...appearance, theme: theme === 'dark' ? 'light' : 'dark' })} aria-label={theme === 'dark' ? 'Chuyển giao diện sáng' : 'Chuyển giao diện tối'}><ChartIcon name={theme === 'dark' ? 'moon' : 'sun'} /></button>}
                </nav>
              </div>

              <div className={`chart-bottom-bar ${historicalView ? 'is-historical' : ''}`} role="group" aria-label="Điều khiển replay phía dưới chart">
                <div className="chart-bottom-range" role="group" aria-label="Khoảng thời gian chart">
                  {[['1D', 1], ['5D', 5], ['1M', 30], ['All', null]].map(([range, days]) => <button key={range} type="button" onClick={() => requestViewport(days ? 'range' : 'fit', { days })}>{range}</button>)}
                  <button type="button" onClick={() => requestViewport('latest')}>Tới cutoff</button>
                  <a className="context-link" href={learnHref}>Học & thuật ngữ</a>
                </div>
                <div className="chart-bottom-replay">
                  <button type="button" className="chart-bottom-step" aria-label="Về nến đầu tiên" onClick={() => loadSession(sessionId, 0)} disabled={conflict || Boolean(pendingAction) || state.status !== 'ready' || cursor <= 0}>|‹</button>
                  <button type="button" className="chart-bottom-step" aria-label="Mở cutoff trước" onClick={() => loadSession(sessionId, Math.max(0, cursor - 1))} disabled={conflict || Boolean(pendingAction) || state.status !== 'ready' || cursor <= 0}>‹</button>
                  {historicalView && <button type="button" onClick={() => loadSession(sessionId)} disabled={state.status !== 'ready'}>Về cursor mới nhất</button>}
                  <span className="chart-bottom-cursor">#{cursor} / #{canonicalCursor} · UTC</span>
                </div>
                <div className="chart-bottom-status"><span className="status-dot" /> Paper replay <strong>{replayContext.instrument}</strong></div>
              </div>

              <div className="chart-trading-bar" role="group" aria-label="Giao dịch mô phỏng">
                <div className="chart-trading-actions">
                  {['BUY', 'SELL'].map(side => <button key={side} type="button" className={side.toLowerCase()} disabled={order.disabled || Boolean(order.active)} onClick={() => beginOrder(side)} title={`${side === 'BUY' ? 'Ask' : 'Bid'} mô phỏng tại cutoff; fill ở nến kế tiếp`}>{side === 'BUY' ? 'Buy' : 'Sell'} <strong>{formatPrice(side === 'BUY' ? quotes.ask : quotes.bid)}</strong></button>)}
                  <label>Size<input aria-label="Khối lượng nhanh" type="number" min={order.instrument?.quantity_min || '0'} step={order.instrument?.quantity_step || 'any'} value={order.draft.quantity} disabled={order.disabled || Boolean(order.active)} onChange={event => order.setDraft(current => ({ ...current, quantity: event.target.value }))} /></label>
                  <span className="chart-sim-tag">SIM</span><button type="button" aria-expanded={sideOpen && sidePanel === 'order'} onClick={() => openPanel('order')}>Lệnh {order.active ? '· 1' : ''}</button>
                </div>
                <div className="chart-trading-account">{advancedChart && <a className="legacy-analytics-link" href={routeHref('analytics', { surface: 'workspace' })}><ChartIcon name="analytics" />Analytics</a>}<span>Balance <strong>{money(order.execution?.balance, order.costs?.account_ccy)}</strong></span><span>Equity <strong>{money(order.execution?.equity, order.costs?.account_ccy)}</strong></span><span>P/L <strong>{money(order.execution?.floating_pl, order.costs?.account_ccy)}</strong></span></div>
              </div>

              {chartNotice && <div className="chart-notice" role="status">{chartNotice}<button type="button" aria-label="Đóng thông báo" onClick={() => setChartNotice('')}>×</button></div>}

              <div className="replay-evidence-strip" role="group" aria-label="Bằng chứng chart">
                <div><span className="story-label">03 · EVIDENCE</span><strong>{crosshair?.row ? 'Nến đang chọn' : 'Nến tại cutoff'}</strong></div>
                <span>{visibleRows.length} nến được phép hiển thị</span>
                <span>{replay.has_future_rows ? 'Nến tương lai đang ẩn' : 'Đã ở cuối dữ liệu'}</span>
                <span>{crosshair?.row ? `Crosshair #${visibleRows.findIndex((item) => Number(item.timestamp) === Number(crosshair.row.timestamp))}` : `Cursor #${cursor}`}</span>
              </div>

              <div className="bar-readout" role="group" aria-label="OHLC nến hiện tại">
                <span className="bar-readout-label">{crosshair?.row ? 'Crosshair' : 'Nến hiện tại'} #{crosshair?.row ? visibleRows.findIndex((item) => Number(item.timestamp) === Number(crosshair.row.timestamp)) : cursor}</span>
                <span>O <strong>{formatPrice((crosshair?.row || currentBar)?.open)}</strong></span>
                <span>H <strong>{formatPrice((crosshair?.row || currentBar)?.high)}</strong></span>
                <span>L <strong>{formatPrice((crosshair?.row || currentBar)?.low)}</strong></span>
                <span>C <strong>{formatPrice((crosshair?.row || currentBar)?.close)}</strong></span>
                {crosshair?.row && <span className="bar-readout-time">{formatTimestamp(crosshair.row.timestamp)} UTC</span>}
              </div>

              <div className="replay-jump" role="group" aria-label="Đi tới nến">
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
                  disabled={conflict || Boolean(pendingAction) || state.status !== 'ready' || canonicalCursor <= 0}
                  aria-label="Chọn nến replay"
                />
                <button type="button" onClick={jumpToCursor} disabled={conflict || Boolean(pendingAction) || state.status !== 'ready' || Number(jumpDraft) === cursor}>
                  Mở cutoff này
                </button>
              </div>
            </div>

            <aside className="replay-side" id="replay-context-panel" aria-label="Chi tiết replay và nhánh" ref={sideRef} tabIndex={-1} onKeyDown={(event) => { if (event.key === 'Escape') closeSide() }}>
              <header className="chart-dock-heading"><strong>{({ order: 'Lệnh', objects: 'Đối tượng', data: 'Dữ liệu', context: 'Chi tiết & nhánh', goto: 'Go To', news: 'News' })[sidePanel]}</strong><button type="button" className="replay-panel-close" aria-label="Đóng panel" onClick={closeSide}><ChartIcon name="close" /></button></header>
              {!['goto', 'news'].includes(sidePanel) && <nav className="chart-dock-tabs" aria-label="Panel replay">{[['order', 'Lệnh'], ['objects', 'Đối tượng'], ['data', 'Dữ liệu'], ['context', 'Chi tiết']].map(([panel, label]) => <button key={panel} type="button" aria-pressed={sidePanel === panel} onClick={() => { if (panel === 'order') setIsPlaying(false); setSidePanel(panel) }}>{label}</button>)}</nav>}
              {sidePanel === 'news' && <section className="legacy-news-empty"><ChartIcon name="news" /><h2>Chưa có lịch tin cho dataset này</h2><p>Phiên hiện tại có dữ liệu OHLC, chưa có nguồn tin lịch sử gắn với cutoff.</p><button type="button" onClick={() => setSidePanel('data')}>Xem dữ liệu phiên</button></section>}
              {sidePanel === 'goto' && <div className="legacy-goto"><p>Chọn một nến đã mở trong phiên. Các nến sau cutoff vẫn được ẩn.</p><form className="replay-date-jump" onSubmit={event => { event.preventDefault(); jumpToCursor() }}><label>Nến đã mở<input type="number" aria-label="Số nến cutoff" min="0" max={canonicalCursor} step="1" value={jumpDraft} onChange={event => setJumpDraft(event.target.value)} /></label><button type="submit" disabled={conflict || Boolean(pendingAction) || state.status !== 'ready' || !Number.isInteger(Number(jumpDraft)) || Number(jumpDraft) < 0 || Number(jumpDraft) > canonicalCursor || Number(jumpDraft) === cursor}>Mở cutoff này</button></form></div>}
              {sidePanel === 'order' && <ChartOrderPanel order={order} blockedReason={orderBlockedReason} />}
              {sidePanel === 'context' && <div className="chart-context-content">
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
                {canOpenOrder
                  ? <a className="next-action-link" href={routeHref('trade', { surface: 'workspace', intent: 'order' })}>Mở Trade draft / risk preview →</a>
                  : <p>Về cursor mới nhất hoặc tạo nhánh từ cutoff này để mở lệnh mô phỏng.</p>}
                {(annotationDraft || drawingTool !== 'cross') && <div className={`annotation-draft ${annotationDraft?.status === 'ready' ? 'is-ready' : ''}`} data-testid="annotation-draft" aria-live="polite">
                  {!annotationDraft && <span>Đặt mốc trên chart để tạo nháp local.</span>}
                  {annotationDraft?.status === 'ready' && (
                    <>
                      <strong>{annotationDraft.draft.annotation_type === 'horizontal-line' ? 'Draft horizontal line đã chọn' : `${DRAWING_LABELS[annotationDraft.draft.annotation_type]} đã chọn`}</strong>
                      <span>#{visibleRows.findIndex((item) => Number(item.timestamp) === Number(annotationDraft.draft.anchors[0].timestamp))} · {formatTimestamp(annotationDraft.draft.anchors[0].timestamp)} UTC · giá {formatPrice(annotationDraft.draft.anchors[0].price)}</span>
                    </>
                  )}
                  {annotationDraft?.status !== 'ready' && annotationDraft?.message && <span>{annotationDraft.message}</span>}
                </div>}
                <a className="next-action-link" href={journalHref}>Mở Journal cho cutoff này →</a>
                <a className="next-action-link" href={routeHref('analytics', { surface: 'workspace' })}>Analytics của session →</a>
              </section>
              </div>}
              {sidePanel === 'objects' && <>{advancedChart && <p className="chart-native-objects-hint">Ghi chú workspace được giữ ở đây. Hình vẽ mới nằm trong cây đối tượng của chart.</p>}<ReplayObjects drawings={drawings} /></>}
              {sidePanel === 'data' && <>
              <section className="replay-watchlist" aria-label="Danh sách dữ liệu local">
                <h2>Dữ liệu local</h2>
                <p>Đổi instrument hoặc timeframe bằng dataset đã đăng ký. Mỗi lựa chọn mở phiên mới, không đổi phiên hiện tại.</p>
                {datasetState.status === 'error' && <p role="alert">{datasetState.error}</p>}
                <ul>{datasetState.items.map(item => <li key={item.dataset_id}>
                  <a href={routeHref('replay', { session: null, cursor: null, cutoff: null, dataset: item.dataset_id, surface: 'workspace', fresh: '1' })} aria-current={item.dataset_id === replay?.payload?.dataset_id ? 'true' : undefined}>{item.instrument_id || item.dataset_id} · {item.timeframe || `${item.timeframe_seconds || '?'}s`}</a>
                  <small>{item.quality_status || 'unverified'} · {item.row_count ?? 'N/A'} nến</small>
                </li>)}</ul>
              </section>
              </>}
              {['context', 'goto'].includes(sidePanel) && <>
              <form className="replay-date-jump" onSubmit={(event) => { event.preventDefault(); goToDate() }}>
                <label>Đi tới thời điểm UTC đã mở<input type="datetime-local" aria-label="Thời điểm replay UTC" value={goToDateDraft} onChange={(event) => setGoToDateDraft(event.target.value)} /></label>
                <button type="submit" disabled={!goToDateDraft || Boolean(pendingAction) || state.status !== 'ready'}>Mở cutoff theo thời điểm</button>
              </form>
              </>}
              {sidePanel === 'context' && <>
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
                  disabled={historicalView || cursor <= 0 || conflict || Boolean(pendingAction) || state.status !== 'ready'}
                  aria-label="Nến bắt đầu branch"
                />
                <button
                  className="secondary-action"
                  type="button"
                  data-testid="branch-replay"
                  disabled={!canBranch || Boolean(pendingAction) || state.status !== 'ready'}
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
              </>}
            </aside>
          </section>
        </>
      )}
    </main>
  )
}
