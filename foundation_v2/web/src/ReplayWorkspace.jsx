import { navigate } from './clientNavigation.js'
import { scopedMutation } from './scopedMutation.js'
import ProjectDateInput from './ProjectDateInput.jsx'
import { displayDate } from './dateFormat.js'
import { displayTimeframe } from './dataDisplay.js'
import { chartSeriesPalette } from './projectPalette.js'
import { nativeChartPalette } from './nativeChartPalette.js'
import FxSelect from './FxSelect.jsx'
import { useTestingLocale } from './testingLocale.jsx'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useContentReadyMetric } from './useContentReadyMetric.js'
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
import LegacyReplayToolbar from './LegacyReplayToolbar.jsx'
import { replayResolution, resolutionSeconds } from './advancedReplayDatafeed.js'
import { replayIntervalSteps, replayAdvance, replayRewind, replayRewindBucket, replaySelectionCursor, replayDelay } from './legacyReplayModel.js'
import ChartOrderPanel, { useChartOrder } from './ChartOrderPanel.jsx'
import TradingViewReplayChart from './TradingViewReplayChart.jsx'
import useReplayActivity from './useReplayActivity.js'
import ChartHeaderPreview from './ChartHeaderPreview.jsx'
import LegacyChartHeader from './LegacyChartHeader.jsx'
import LegacyTradingBar from './LegacyTradingBar.jsx'
import LegacyPopover from './LegacyPopover.jsx'
import LegacyOrderDialog from './LegacyOrderDialog.jsx'
import LegacyJournal from './LegacyJournal.jsx'
import LegacyObjectTree from './LegacyObjectTree.jsx'
import SessionSettingsDrawer from './SessionSettingsDrawer.jsx'
import { updateSessionMetadata } from './sessionCatalog.js'
import { orderLevels, marketQuotes } from './replayOrderModel.js'
import { ReplayOrderPrimitive } from './replayOrderPrimitive.js'
import './ReplayWorkspace.css'
import './ChartWorkbench.css'

function formatTimestamp(timestamp, locale = 'vi-VN') {
  if (timestamp === null || timestamp === undefined || !Number.isFinite(Number(timestamp))) return 'Chưa có dữ liệu'
  return displayDate(new Date(Number(timestamp) * 1000), { timeStyle: 'medium' })
}

function formatPrice(value, locale = 'vi-VN') {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return 'N/A'
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 8 }).format(Number(value))
}

function formatVolume(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return 'N/A'
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(Number(value))
}

function datasetQualityLabel(dataset, t = value => value) {
  const disposition = dataset?.quality?.disposition || dataset?.quality_status || 'unverified'
  const gaps = dataset?.quality?.gaps
  return `${t(disposition)}${Array.isArray(gaps) && gaps.length ? ' · ' + t('{count} khoảng gián đoạn', { count: gaps.length }) : ''}`
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
  const { t, locale, fmt } = useTestingLocale()
  const formatTimestamp = value => value === null || value === undefined || !Number.isFinite(Number(value)) ? '—' : displayDate(new Date(Number(value) * 1000), { timeStyle: 'medium' })
  const formatPrice = value => fmt(value, '', 8)
  const money = (value, currency) => fmt(value, ' ' + (currency || t('Đơn vị tài khoản')))

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
    const palette = nativeChartPalette(theme)
    const chart = createChart(host, {
      width: host.clientWidth, height: host.clientHeight,
      layout: { background: { color: palette.canvas }, textColor: palette.text, fontSize: 12, attributionLogo: false },
      grid: { vertLines: { color: palette.grid }, horzLines: { color: palette.grid } },
      rightPriceScale: { borderColor: palette.border, scaleMargins: { top: 0.12, bottom: 0.22 } },
      timeScale: { borderColor: palette.border, timeVisible: true, secondsVisible: false, lockVisibleTimeRangeOnResize: true },
      crosshair: { mode: 0 },
      localization: { locale: 'vi-VN', timeFormatter: time => displayDate(typeof time === 'object' ? new Date(Date.UTC(time.year, time.month - 1, time.day)) : time, { timeStyle: typeof time === 'number' ? 'short' : undefined }) },
    })
    const seriesType = chartType === 'bars' ? BarSeries : chartType === 'line' ? LineSeries : chartType === 'area' ? AreaSeries : chartType === 'baseline' ? BaselineSeries : CandlestickSeries
    const series = chart.addSeries(seriesType, {
      ...chartSeriesPalette(palette), borderVisible: false, lineWidth: 2,
    })
    const volume = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: 'volume', lastValueVisible: false, priceLineVisible: false })
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } })
    const average = chart.addSeries(LineSeries, { color: palette.highlight, lineWidth: 1, lastValueVisible: false, priceLineVisible: false })
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
    if (!chartRef.current) return
    const palette = nativeChartPalette(theme)
    chartRef.current.chart.applyOptions({
      layout: { background: { color: palette.canvas }, textColor: palette.text },
      grid: { vertLines: { color: palette.grid }, horzLines: { color: palette.grid } },
      rightPriceScale: { borderColor: palette.border }, timeScale: { borderColor: palette.border },
    })
    chartRef.current.series.applyOptions(chartSeriesPalette(palette))
    chartRef.current.average.applyOptions({ color: palette.highlight })
    chartRef.current.orderPrimitive.setPalette(palette)
    chartRef.current.drawingPrimitive.setPalette(palette)
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
    const palette = nativeChartPalette(theme)
    volume.setData(rows.filter((row) => (row.volume ?? row.tick_volume) !== null && (row.volume ?? row.tick_volume) !== undefined && Number.isFinite(Number(row.volume ?? row.tick_volume))).map((row) => ({ time: Number(row.timestamp), value: Number(row.volume ?? row.tick_volume), color: Number(row.close) >= Number(row.open) ? `${palette.positive}80` : `${palette.negative}80` })))
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
  }, [chartType, rows, sessionId, theme])

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
      ? <span key={kind} className="chart-order-level is-entry" data-order-level={kind}>{levels.side} · {levels.state === 'draft' ? t("Nháp entry") : levels.state === 'queued' ? t("Chờ fill") : t("Entry")} {formatPrice(levels.entry)}{levels.floating !== null && <> {t("· P/L")} {money(levels.floating, levels.currency)}</>}</span>
      : <button key={kind} type="button" className={`chart-order-level is-${kind}`} data-order-level={kind} aria-label={`${kind === 'stop' ? 'Kéo Stop loss' : 'Kéo Take profit'}`} title={t("Kéo đổi giá · phím ↑ ↓ chỉnh một tick")} disabled={!orderEditable}
        onPointerDown={event => { if (!latestRef.current.orderEditable || event.button !== 0) return; event.preventDefault(); event.stopPropagation(); onOrderDragStart(); event.currentTarget.setPointerCapture(event.pointerId); orderDrag.current = { kind, generation: latestRef.current.orderGeneration } }}
        onPointerMove={event => { if (!orderDrag.current) return; const value = dragPrice(event); if (value) chartRef.current?.orderPrimitive.setLevels({ ...latestRef.current.levels, [kind]: value }) }}
        onPointerUp={event => endDrag(event, true)} onPointerCancel={event => endDrag(event, false)}
        onKeyDown={event => { if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return; event.preventDefault(); event.stopPropagation(); const tick = Number(tickSize); if (tick > 0) onOrderPriceChange(kind, Number((levels[kind] + (event.key === 'ArrowUp' ? tick : -tick)).toFixed(8))) }}>
        <ChartIcon name="grip" />{kind === 'stop' ? t("SL") : t("TP")}{levels.state === 'edit' ? t(" nháp") : ''} {formatPrice(levels[kind])}
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
  navigate(url, { replace: true })
}

function isEditableTarget(target) {
  if (!target || typeof target !== 'object') return false
  if (target.isContentEditable || target.closest?.('input, textarea, select, button, [role="button"], [role="menu"], [role="listbox"], [role="dialog"], [role="slider"]')) return true
  const tagName = String(target.tagName || '').toUpperCase()
  return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT' || tagName === 'BUTTON'
}

export default function ReplayWorkspace({ workspace, query }) {
  const { t, locale, fmt } = useTestingLocale()
  const formatTimestamp = value => value === null || value === undefined || !Number.isFinite(Number(value)) ? '—' : displayDate(new Date(Number(value) * 1000), { timeStyle: 'medium' })
  const formatPrice = value => fmt(value, '', 8)
  const money = (value, currency) => fmt(value, ' ' + (currency || t('Đơn vị tài khoản')))

  const { updateMarketContext, appearance, applyAppearance } = useFxReplayContext()
  const theme = appearance?.theme || 'dark'
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
  const replayScopeResolved = state.payload?.record_id === requestedSession && (requestedCursor === null || Number(state.payload?.view_cursor_index) === requestedCursor)
  useContentReadyMetric('replay', replayScopeResolved || !requestedSession ? state.status : 'loading', `${workspace}:${requestedSession}:${requestedCursorParam ?? ''}`)
  const advancedChart = state.payload?.payload?.chart_engine ? state.payload.payload.chart_engine === 'legacy' : query.get('chart_engine') !== 'lightweight'
  const [datasetState, setDatasetState] = useState({ status: 'loading', items: [], error: null })
  const [pendingAction, setPendingAction] = useState('')
  const [conflict, setConflict] = useState(false)
  const [branchCursor, setBranchCursor] = useState(0)
  const [datasetDraft, setDatasetDraft] = useState(requestedDataset)
  const [startDraft, setStartDraft] = useState(Number.isFinite(requestedStart) ? Math.max(0, requestedStart) : 0)
  const [jumpDraft, setJumpDraft] = useState(0)
  const [speed, setSpeed] = useState('1')
  const [replayInterval, setReplayInterval] = useState('1')
  const [replaySync, setReplaySync] = useState(false)
  const [selectingReplayBar, setSelectingReplayBar] = useState(false)
  const replayIntervalInitialized = useRef('')
  const lastReplayDispatch = useRef(0)
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
  const nativeIntervalRef = useRef(null)
  const [goToPopup, setGoToPopup] = useState(null)
  const [goToCustom, setGoToCustom] = useState(false)
  const [indicatorsOpen, setIndicatorsOpen] = useState(false)
  const [drawingTool, setDrawingTool] = useState('cross')
  const [pendingAnchor, setPendingAnchor] = useState(null)
  const [drawingLabel, setDrawingLabel] = useState('')
  const [viewportRequest, setViewportRequest] = useState(null)
  const [goToDateDraft, setGoToDateDraft] = useState('')
  const [chartNotice, setChartNotice] = useState('')
  const [sessionSettings, setSessionSettings] = useState(null)
  const settingsSaveLock = useRef(false)
  const actionLock = useRef(false)
  const sessionRequest = useRef(null)
  const lastResolvedLocation = useRef(`${requestedSession}:${requestedCursorParam ?? ''}`)
  const datasetRequest = useRef(null)
  const sideToggleRef = useRef(null)
  const sideRef = useRef(null)
  const sideTriggerRef = useRef(null)
  const restoreSideFocus = useRef(false)
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
    if (advancedChart && panel === 'goto') { setIsPlaying(false); setGoToCustom(false); setGoToPopup(current => current ? null : trigger); return }
    setGoToPopup(null)
    if (panel === 'order') setIsPlaying(false)
    setSidePanel(panel); setSideOpen(true)
  }
  const fullscreenChart = async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.querySelector('.fx-app').requestFullscreen() } catch { setChartNotice('Không mở được chế độ toàn màn hình.') } }

  const rememberSession = useCallback((nextSessionId, preserveCursor = false, cursor = null, dataset = null) => {
    lastResolvedLocation.current = `${nextSessionId}:${cursor ?? ''}`
    setSessionId(nextSessionId)
    window.localStorage.setItem(storageKey, nextSessionId)
    replaceSessionInUrl(nextSessionId, preserveCursor, cursor, dataset)
  }, [storageKey])

  const loadSession = useCallback(async (targetSessionId, targetCursor = null, options = {}) => {
    if (!targetSessionId || actionLock.current) return
    sessionRequest.current?.abort()
    const controller = new AbortController()
    sessionRequest.current = controller
    if (!options.keepPlaying) setIsPlaying(false)
    setState((current) => ({ status: 'loading', payload: current.payload, error: null }))
    setConflict(false)
    try {
      const params = new URLSearchParams()
      if (targetCursor !== null) params.set('cursor_index', String(targetCursor))
      if (options.advanceIntervalSeconds) params.set('advance_interval_seconds', String(options.advanceIntervalSeconds))
      if (options.cutoffTimestamp !== undefined) params.set('cutoff_timestamp', String(options.cutoffTimestamp))
      const suffix = params.size ? `?${params}` : ''
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
    } finally {
      if (sessionRequest.current === controller) sessionRequest.current = null
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
      const response = await scopedMutation('/api/v2/replay/sessions', workspace, {
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
    datasetRequest.current?.abort()
    const controller = new AbortController()
    datasetRequest.current = controller
    setDatasetState(current => ({ ...current, status: 'loading', error: null }))
    try {
      const response = await fetch('/api/v2/data/datasets', {
        headers: { 'X-Workspace-Id': workspace },
        signal: controller.signal,
      })
      const payload = await readJson(response)
      if (controller.signal.aborted) return
      const items = Array.isArray(payload.items) ? payload.items : []
      setDatasetState({ status: 'ready', items, error: null })
      if (!datasetDraft && !requestedDataset && items.length) {
        const preferred = items.find((item) => /EURUSD/i.test(String(item.instrument_id || item.dataset_id))) || items[0]
        setDatasetDraft(String(preferred.dataset_id))
      }
    } catch (error) {
      if (!controller.signal.aborted) setDatasetState(current => ({ ...current, status: 'error', error: String(error.message || error) }))
    } finally {
      if (datasetRequest.current === controller) datasetRequest.current = null
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

  useEffect(() => {
    const location = `${requestedSession}:${requestedCursorParam ?? ''}`
    if (!requestedSession || location === lastResolvedLocation.current) return
    if (actionLock.current || pendingAction) return
    if (!requestedCursorValid) {
      lastResolvedLocation.current = location
      sessionRequest.current?.abort()
      setState({ status: 'error', payload: null, error: 'Cursor replay trong URL không hợp lệ.' })
      return
    }
    loadSession(requestedSession, requestedCursor)
  }, [requestedSession, requestedCursorParam, requestedCursorValid, requestedCursor, loadSession, pendingAction])

  useEffect(() => () => { sessionRequest.current?.abort(); datasetRequest.current?.abort() }, [])

  const mutate = useCallback(async (kind, body) => {
    if (!sessionId || !state.payload || state.status !== 'ready' || actionLock.current || sessionRequest.current) return
    actionLock.current = true
    const commandLocation = window.location.search
    setPendingAction(kind)
    setConflict(false)
    const suffix = kind === 'branch' ? 'branch' : kind === 'asset' ? 'asset' : 'step'
    try {
      const response = await scopedMutation(`/api/v2/replay/sessions/${encodeURIComponent(sessionId)}/${suffix}`, workspace, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Workspace-Id': workspace },
        body: JSON.stringify(body),
      })
      const payload = await readJson(response)
      const nextCursor = Number(payload.view_cursor_index ?? payload.payload.cursor_index)
      const payloadDataset = payload.payload?.dataset_id || state.payload?.payload?.dataset_id
      if (window.location.search === commandLocation) rememberSession(payload.record_id, false, nextCursor, payloadDataset)
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
  const activityWaiting = useReplayActivity({ workspace, sessionId: replay?.record_id, enabled: Boolean(replay) && state.status !== 'error' && query.get('demo') !== '1' })
  const visibleRowCount = replay?.visible_row_count ?? (replay ? visibleRows.length : null)
  const currentBar = visibleRows.length ? visibleRows[visibleRows.length - 1] : null
  const activeDataset = useMemo(
    () => datasetState.items.find((item) => item.dataset_id === replay?.payload?.dataset_id) || null,
    [datasetState.items, replay?.payload?.dataset_id],
  )
  const openSessionSettings = () => {
    if (!replay || state.status !== 'ready' || pendingAction || conflict) return
    setIsPlaying(false)
    setGoToPopup(null)
    setSessionSettings({ item: {
      record_id: replay.record_id, revision: replay.revision,
      name: replay.payload.name || '', description: replay.payload.description || '',
      instrument_id: activeDataset?.instrument_id,
    }, pending: false, blocked: false, error: null })
  }
  const closeSessionSettings = () => {
    if (settingsSaveLock.current) return
    const refresh = sessionSettings?.blocked
    setSessionSettings(null)
    if (refresh) loadSession(sessionId, cursor)
  }
  const saveSessionSettings = async draft => {
    if (!sessionSettings || sessionSettings.blocked || settingsSaveLock.current) return
    if (revision !== sessionSettings.item.revision || state.status !== 'ready') {
      setSessionSettings(current => ({ ...current, blocked: true, error: t('Phiên đã thay đổi. Đóng cài đặt để tải lại trước khi lưu.') }))
      return
    }
    settingsSaveLock.current = true
    setSessionSettings(current => ({ ...current, pending: true, error: null }))
    try {
      const saved = await updateSessionMetadata(workspace, sessionSettings.item, draft)
      if (saved.record_id !== replay.record_id || saved.revision !== revision + 1 || !saved.payload) throw new Error('Phản hồi lưu phiên không đúng định dạng.')
      // Metadata saves must preserve the viewed cutoff and reconstructed execution.
      setState(current => current.payload?.record_id === saved.record_id && current.payload.revision === revision ? {
        ...current, payload: { ...current.payload, revision: saved.revision, updated_at_utc: saved.updated_at_utc,
          payload: { ...current.payload.payload, name: saved.payload.name, description: saved.payload.description } },
      } : current)
      setSessionSettings(null)
    } catch (error) {
      const blocked = !error.status || error.status >= 500 || [404, 409].includes(error.status)
      const message = error.status === 409 ? t('Phiên đã thay đổi. Đóng cài đặt để tải lại trước khi lưu.') : blocked ? t('Chưa xác định thay đổi đã lưu hay chưa. Đóng cài đặt để tải lại trước khi thử lại.') : t('Không lưu được phiên: {error}', { error: error.message })
      setSessionSettings(current => ({ ...current, pending: false, blocked, error: message }))
    } finally {
      settingsSaveLock.current = false
    }
  }
  const datasetSeconds = Number(activeDataset?.timeframe_seconds || replay?.payload?.execution?.timeframe_seconds)
  const effectiveReplayInterval = replaySync && nativeHeaderSlots?.interval ? nativeHeaderSlots.interval : replayInterval
  const intervalSteps = advancedChart ? replayIntervalSteps(effectiveReplayInterval, datasetSeconds) : 1
  const replayIntervalSeconds = advancedChart && intervalSteps !== null ? resolutionSeconds(effectiveReplayInterval) : undefined
  useEffect(() => {
    if (!Number.isSafeInteger(datasetSeconds) || datasetSeconds < 1 || replayIntervalInitialized.current === sessionId) return
    replayIntervalInitialized.current = sessionId
    try { setReplayInterval(replayResolution(datasetSeconds)) } catch { setReplayInterval('1') }
    setReplaySync(false)
    setSelectingReplayBar(false)
  }, [datasetSeconds, sessionId])

  // Keep the story grounded in the same API-visible replay payload. Dataset
  // metadata is an enhancement when the catalog is available; it must never
  // become a reason to invent instrument, provider, or quality values.
  const replayContext = useMemo(() => {
    const payload = replay?.payload || {}
    const source = activeDataset?.source || {}
    return {
      instrument: activeDataset?.instrument_id || payload.instrument_id || 'Instrument chưa xác định',
      timeframe: activeDataset?.timeframe || payload.timeframe || (activeDataset?.timeframe_seconds > 0 ? `${activeDataset.timeframe_seconds}s` : 'TF chưa rõ'),
      quality: datasetQualityLabel(activeDataset || payload, t),
      provider: source.provider || activeDataset?.provider_id || payload.provider_id || 'Provider chưa xác định',
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
      if (event.key === 'Escape') { setPendingAnchor(null); setSelectingReplayBar(false); setChartNotice('') }
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
      const response = await scopedMutation(`/api/v2/replay/sessions/${encodeURIComponent(sessionId)}/${endpoint}`, workspace, {
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
  const assetClockStale = Boolean(replay?.payload?.asset_states && currentBar && Number(currentBar.timestamp) + Number(activeDataset?.timeframe_seconds) < replay.payload.replay_clock_utc)
  const order = useChartOrder({ workspace, replay, dataset: activeDataset, ready: state.status === 'ready', blocked: historicalView || completed || conflict || assetClockStale || Boolean(pendingAction), submit: submitOrder })
  const priceLevels = order.active || (!historicalView && sideOpen && sidePanel === 'order') ? orderLevels(replay, order.draft) : null
  const quotes = marketQuotes(replay)
  const orderBlockedReason = historicalView ? 'Cutoff lịch sử chỉ đọc. Về cursor mới nhất hoặc tạo nhánh để đặt lệnh.' : completed ? 'Dataset đã kết thúc; không còn nến để fill hoặc sửa lệnh.' : conflict ? 'Đang khóa vì revision đã thay đổi.' : assetClockStale ? 'Chờ nến mới của tài sản tại thời gian replay chung để đặt lệnh.' : ''
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

  const canReplayForward = Boolean(replayAdvance({ cursor, canonicalCursor, historical: historicalView, completed, steps: intervalSteps }))
  const advanceReplay = useCallback((keepPlaying = false, multiplier = 1) => {
    if (!replay || state.status !== 'ready' || conflict || pendingAction || actionLock.current) return
    const steps = intervalSteps == null ? null : Math.min(1000, intervalSteps * multiplier)
    const action = replayAdvance({ cursor, canonicalCursor, historical: historicalView, completed, steps, intervalSeconds: replayIntervalSeconds })
    if (!action) { setIsPlaying(false); return }
    lastReplayDispatch.current = performance.now()
    if (!keepPlaying) setIsPlaying(false)
    if (action.kind === 'read') loadSession(sessionId, action.cursor, { keepPlaying, advanceIntervalSeconds: action.advanceIntervalSeconds })
    else mutate('step', { expected_revision: revision, steps: action.steps, ...(action.replayIntervalSeconds ? { replay_interval_seconds: action.replayIntervalSeconds } : {}) })
  }, [canonicalCursor, completed, conflict, cursor, historicalView, intervalSteps, loadSession, mutate, pendingAction, replay, replayIntervalSeconds, revision, sessionId, state.status])
  const rewindReplay = useCallback(() => {
    if (state.status !== 'ready' || conflict || pendingAction || actionLock.current) return
    const target = advancedChart ? replayRewindBucket(visibleRows, cursor, replayIntervalSeconds) : replayRewind(cursor, intervalSteps)
    if (target !== null) loadSession(sessionId, target)
  }, [advancedChart, conflict, cursor, intervalSteps, loadSession, pendingAction, replayIntervalSeconds, sessionId, state.status, visibleRows])
  const selectReplayBar = useCallback(timestamp => {
    if (!selectingReplayBar || state.status !== 'ready' || conflict || pendingAction || actionLock.current) return
    const target = replaySelectionCursor(visibleRows, Number(timestamp), cursor)
    if (target === null && (!Number.isSafeInteger(Number(timestamp)) || Number(timestamp) >= Number(state.payload?.cutoff_timestamp))) return
    setSelectingReplayBar(false)
    setChartNotice('')
    loadSession(sessionId, target, target === null ? { cutoffTimestamp: Number(timestamp) } : {})
  }, [conflict, cursor, loadSession, pendingAction, selectingReplayBar, sessionId, state.status, visibleRows])
  const toggleReplay = () => {
    if (!isPlaying) { lastReplayDispatch.current = performance.now(); setSelectingReplayBar(false); setChartNotice('') }
    setIsPlaying(current => !current)
  }
  useEffect(() => {
    if (!isPlaying || !replay || !canReplayForward || conflict || pendingAction || state.status !== 'ready') return undefined
    const delay = advancedChart ? replayDelay(speed, lastReplayDispatch.current, performance.now()) : Math.max(0, 1000 / Math.max(.5, Number(speed) || 1) - (performance.now() - lastReplayDispatch.current))
    // One request at a time. Response latency may lower playback speed, but we
    // never flood the revisioned API with concurrent or catch-up mutations.
    const timer = window.setTimeout(() => advanceReplay(true), delay)
    return () => window.clearTimeout(timer)
  }, [advanceReplay, advancedChart, canReplayForward, conflict, isPlaying, pendingAction, replay, speed, state.status])

  useEffect(() => {
    if ((completed && !historicalView) || conflict || intervalSteps === null || state.status === 'error') setIsPlaying(false)
  }, [completed, conflict, historicalView, intervalSteps, state.status])

  useEffect(() => {
    const handleKeyDown = event => {
      if (event.key === 'Escape' && selectingReplayBar) { setSelectingReplayBar(false); setChartNotice(''); return }
      // Native text, range and menu controls retain their own keyboard behavior.
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || isEditableTarget(event.target) || !replay || conflict || pendingAction || state.status !== 'ready') return
      if (!['ArrowRight', 'ArrowLeft', ' '].includes(event.key)) return
      if (event.key === ' ' && !canReplayForward && !isPlaying) return
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'ArrowLeft') rewindReplay()
      else if (event.key === 'ArrowRight') advanceReplay(false, event.shiftKey && !advancedChart ? 10 : 1)
      else { lastReplayDispatch.current = performance.now(); setSelectingReplayBar(false); setIsPlaying(current => !current) }
    }
    const docs = [...new Set([document, nativeHeaderSlots?.market?.ownerDocument].filter(Boolean))]
    docs.forEach(doc => doc.addEventListener('keydown', handleKeyDown, true))
    return () => docs.forEach(doc => doc.removeEventListener('keydown', handleKeyDown, true))
  }, [advanceReplay, advancedChart, canReplayForward, conflict, isPlaying, nativeHeaderSlots, pendingAction, replay, rewindReplay, selectingReplayBar, state.status])

  useEffect(() => {
    if (sideOpen) sideRef.current?.focus()
  }, [sideOpen, sidePanel])
  useEffect(() => {
    if (sideOpen || !restoreSideFocus.current) return
    const target = [sideTriggerRef.current, nativeHeaderSlots?.tools?.querySelector('.chart-header-overflow'), nativeHeaderSlots?.market?.querySelector('.legacy-symbol'), sideToggleRef.current].find(element => element?.isConnected && element.getBoundingClientRect().width > 0)
    target?.focus()
    restoreSideFocus.current = false
  }, [sideOpen, nativeHeaderSlots])
  const closeSide = () => { restoreSideFocus.current = true; setSideOpen(false) }
  const goToDate = () => {
    const timestamp = Date.parse(goToDateDraft + 'Z') / 1000
    if (!Number.isFinite(timestamp) || timestamp > Number(replay?.cutoff_timestamp)) {
      setChartNotice('Chọn thời điểm UTC không vượt quá cutoff đang xem.')
      return
    }
    setChartNotice('')
    loadSession(sessionId, null, { cutoffTimestamp: Math.floor(timestamp) })
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
    <main style={advancedChart ? { '--legacy-header-height': `${(nativeHeaderSlots?.headerHeight || 38) + 4}px` } : undefined} className={`replay-shell wm-chart-page ${sideOpen ? 'is-panel-open' : ''} ${sideOpen && sidePanel === 'journal' ? 'is-journal-open' : ''} ${sideOpen && sidePanel === 'native-objects' ? 'is-native-tree-open' : ''} ${replay ? 'has-replay' : ''} ${advancedChart && replay ? 'is-legacy-chart' : ''}`}>
      {headerSlot && replay && !advancedChart && createPortal(<div className="chart-command-row" role="group" aria-label={t("Thanh công cụ chart")}>
        <button type="button" className="chart-market-command" onClick={() => openPanel('data')} title={t("Đổi instrument/timeframe bằng dataset local")}><strong>{replayContext.instrument}</strong>{!advancedChart && <span>{displayTimeframe(replayContext)}</span>}</button>
        {!advancedChart && <><label className="chart-type-command"><ChartIcon name="candles" /><FxSelect  label={t("Kiểu chart")} value={chartType} onChange={value => setChartType(value)} localizeOptions={false} options={[...CHART_TYPES.map(type => ({ value: type.id, label: type.label, localize: false }))]} /></label>
        <div className="chart-indicators-command" ref={indicatorsRef}><button type="button" aria-expanded={indicatorsOpen} aria-controls={indicatorsOpen ? 'chart-indicators' : undefined} onClick={() => setIndicatorsOpen(current => !current)}>{t("Indicators")}</button>
          {indicatorsOpen && <div id="chart-indicators" className="chart-indicators-menu" onKeyDown={event => { if (event.key === 'Escape') { setIndicatorsOpen(false); event.currentTarget.previousElementSibling.focus() } }}><label><input type="checkbox" checked={showVolume} onChange={event => setShowVolume(event.target.checked)} />{t("Volume")}</label><label><input type="checkbox" checked={showAverage} onChange={event => setShowAverage(event.target.checked)} /> {t("SMA 20")}</label></div>}
        </div></>}
        <a href={routeHref('analytics', { surface: 'workspace' })}><ChartIcon name="analytics" /><span>{t("Analytics")}</span></a>
        <button type="button" ref={sideToggleRef} aria-expanded={sideOpen && sidePanel === 'context'} aria-controls="replay-context-panel" onClick={() => sideOpen && sidePanel === 'context' ? closeSide() : openPanel('context')}><ChartIcon name="info" /><span>{t("Chi tiết & nhánh")}</span></button>
        <span className="chart-session-name" title={replay.payload.name || sessionId}>{replay.payload.name || `${replayContext.instrument} · Replay`}</span>
        <span className={`chart-session-state ${historicalView || conflict ? 'is-warning' : ''}`} data-testid="replay-status">{statusLabel}</span>
      </div>, headerSlot)}
      <header className="replay-topbar">
        <div>
          <h1>{t("Practice · Replay")}</h1>
        </div>
        <div className="replay-topbar-actions">
          <a className="context-link" href={learnHref}>{t("Học & thuật ngữ")}</a>
          <div className="replay-lock" data-testid="replay-lock">
            <strong>{t("REPLAY / SIMULATION")}</strong>
            <span>{t("Broker locked · không gửi lệnh")}</span>
          </div>
        </div>
      </header>

      {!replay && state.status !== 'loading' && (
        <section className={`replay-start ${noDataset ? 'is-empty' : ''}`} aria-label={t("Mở replay")}>
          <div>
            <h2>{t("Mở replay")}</h2>
            <p>{t("Chọn dataset và nến bắt đầu. Replay mô phỏng, chỉ hiển thị dữ liệu tới cutoff hiện tại.")}</p>
          </div>
          <label>{t("Dataset")}<FxSelect label={t("Dataset")} value={datasetDraft} onChange={value => setDatasetDraft(value)} data-testid="dataset-id" disabled={datasetState.status === 'loading'} localizeOptions={false} options={[...(!datasetDraft ? [({ value: "", label: t("Chọn dataset…"), localize: false })] : []), ...datasetState.items.map((item) => (
                ({ value: item.dataset_id, label: (item.instrument_id || item.dataset_id) + ' · ' + (displayTimeframe(item, t('TF chưa rõ'))) + ' · ' + datasetQualityLabel(item, t), localize: false })
              )), ...(datasetDraft && !datasetState.items.some((item) => item.dataset_id === datasetDraft) ? [({ value: datasetDraft, label: datasetDraft + ' · ' + t('Đang kiểm tra'), localize: false })] : [])]} />
          </label>
          <label>{t("Start index")}<input
              type="number"
              min="0"
              value={startDraft}
              onChange={(event) => setStartDraft(Math.max(0, Number(event.target.value) || 0))}
            />
          </label>
          <button className="primary-action" type="button" onClick={createSession} disabled={pendingAction === 'create' || !datasetDraft.trim() || datasetState.status === 'loading'}>
            {pendingAction === 'create' ? t("Đang tạo…") : t("Bắt đầu replay")}
          </button>
          {datasetState.status === 'loading' && <div className="replay-inline-status">{t("Đang đọc danh mục dữ liệu…")}</div>}
          {datasetState.status === 'error' && <div className="replay-inline-status is-error">{t("Không đọc được danh mục:")} {datasetState.error}</div>}
          {noDataset && (
            <>
              <div className="replay-inline-status is-empty">{t("Chưa có dataset local trong workspace này.")}</div>
              <div className="replay-empty-actions" data-testid="replay-empty-actions">
                <span>{t("Cần một dataset local đã có provenance trước khi mở chart.")}</span>
                <a href={dataDeskHref}>{t("Mở Data Desk →")}</a>
              </div>
            </>
          )}
        </section>
      )}

      {state.status === 'loading' && <div className="replay-message">{t("Đang tải trạng thái replay…")}</div>}
      {state.status === 'error' && <div className="replay-message replay-error" role="alert">{t("Không đọc được replay:")} {state.error}</div>}

      {replay && (
        <>
          <section className="replay-status replay-contextbar" aria-label={t("Ngữ cảnh replay")}>
            <div className="replay-context-primary">
              <span>{t("Practice context")}</span>
              <strong>{replayContext.instrument} · {displayTimeframe(replayContext)}</strong>
              <small>{workspace} {t("· broker locked")}</small>
            </div>
            <div><span>{t("Dataset")}</span><code>{replay.payload.dataset_id}</code></div>
            <div><span>{t("Decision cutoff")}</span><strong>#{cursor}</strong><small>{formatTimestamp(replay.cutoff_timestamp)} {t("UTC")}</small></div>
            <div><span>{t("Visible rows")}</span><strong>{visibleRowCount ?? t("N/A")} {t("nến")}</strong><small>{t("revision r")}{revision}</small></div>
            <div className={`replay-state ${completed ? 'is-complete' : ''} ${conflict ? 'is-conflict' : ''}`}>
              {statusLabel}
            </div>
          </section>

          {conflict && (
            <section className="conflict-banner" role="alert" data-testid="revision-conflict">
              <div>
                <strong>{t("Session đã thay đổi ở nơi khác.")}</strong>
                <span>{t("Controls đang khóa để tránh ghi đè revision cũ.")}</span>
              </div>
              <button type="button" onClick={() => loadSession(sessionId)}>{t("Tải trạng thái mới")}</button>
            </section>
          )}

          {historicalView && (
            <section className="replay-history-banner" role="status" data-testid="replay-history-view">
              <div>
                <strong>{t("Đang xem đúng cutoff report ở nến #")}{cursor}.</strong>
                <span>{t("Replay gốc hiện ở nến #")}{canonicalCursor}{t("; dữ liệu sau cutoff này không được render.")}</span>
              </div>
              <span>{t("Tạo branch nếu muốn tiếp tục từ đúng mốc report mà không sửa session gốc.")}</span>
            </section>
          )}

          {advancedChart && <LegacyChartHeader controls={nativeHeaderSlots} symbol={replayContext.instrument} name={replay.payload.name || t('Replay')} backHref={routeHref('replay', { surface: null, select: '1' })} theme={theme} onTheme={() => applyAppearance({ ...appearance, theme: theme === 'dark' ? 'light' : 'dark' })} onOpenTool={openPanel} onFullscreen={fullscreenChart} />}
          <section className="replay-workspace">
            <div className="replay-main">
              <div className={`chart-frame ${advancedChart ? 'has-advanced-chart' : ''}`}>
                {!advancedChart && <nav className="chart-tool-rail" aria-label={t("Công cụ chart")}>
                  <button type="button" aria-label={t("Chỉ xem crosshair")} title={t("Chỉ xem crosshair")} aria-pressed={drawingTool === 'cross'} onClick={() => chooseDrawingTool('cross')}><ChartIcon name="cross" /></button>
                  <button type="button" aria-label={t("Chọn đường giá local")} title={t("Bấm nến để chọn đường giá local")} aria-pressed={drawingTool === 'level'} onClick={() => chooseDrawingTool('level')}><ChartIcon name="level" /></button>
                  <button type="button" aria-label={t("Vẽ đường xu hướng")} title={t("Vẽ đường xu hướng bằng hai mốc")} aria-pressed={drawingTool === 'trendline'} onClick={() => chooseDrawingTool('trendline')}><ChartIcon name="trendline" /></button>
                  <button type="button" aria-label={t("Vẽ vùng giá")} title={t("Vẽ vùng giá bằng hai mốc")} aria-pressed={drawingTool === 'zone'} onClick={() => chooseDrawingTool('zone')}><ChartIcon name="zone" /></button>
                  <button type="button" aria-label={t("Thêm ghi chú chart")} title={t("Ghi chú tại mốc giá")} aria-pressed={drawingTool === 'text'} onClick={() => chooseDrawingTool('text')}><ChartIcon name="text" /></button>
                  <button type="button" aria-label={t("Đo giá giữa hai mốc")} title={t("Đo thay đổi giá và số nến giữa hai mốc")} aria-pressed={drawingTool === 'measure'} onClick={() => chooseDrawingTool('measure')}><ChartIcon name="measure" /></button>
                  <button type="button" aria-label={t("Mở danh sách đối tượng")} title={t("Chi tiết và đối tượng chart")} aria-expanded={sideOpen} aria-controls="replay-context-panel" onClick={() => openPanel('objects')}><ChartIcon name="objects" /></button>
                  <button type="button" aria-label={t("Vừa toàn bộ nến đã mở")} title={t("Vừa toàn bộ nến đã mở")} onClick={() => requestViewport('fit')}><ChartIcon name="fit" /></button>
                </nav>}
                <div className="chart-canvas">
                  {!advancedChart && <><div className="chart-symbol-strip" role="group" aria-label={t("Thông tin symbol")}>
                    <strong>{replayContext.instrument}</strong>
                    <span>{displayTimeframe(replayContext)} {t("· UTC")}</span>
                    <span className="chart-symbol-ohlc">{t("O")} {formatPrice((crosshair?.row || currentBar)?.open)} {t("· H")} {formatPrice((crosshair?.row || currentBar)?.high)} {t("· L")} {formatPrice((crosshair?.row || currentBar)?.low)} {t("· C")} {formatPrice((crosshair?.row || currentBar)?.close)} {t("· V")} {formatVolume((crosshair?.row || currentBar)?.volume ?? (crosshair?.row || currentBar)?.tick_volume)}</span>
                  </div>
                  <ChartFloatingToolbar name="Công cụ vẽ" storageKey={`tw:chart:draw-toolbar:${workspace}`} initialPosition={{ x: 22, y: 46 }}>
                    {['cross', 'level', 'trendline', 'zone', 'text', 'measure'].map(tool => <button key={tool} type="button" aria-label={`Công cụ nhanh ${tool}`} title={tool === 'level' ? t("Đường giá") : DRAWING_LABELS[tool] || t("Crosshair")} aria-pressed={drawingTool === tool} onClick={() => chooseDrawingTool(tool)}><ChartIcon name={tool} /></button>)}
                    {drawingTool === 'text' && <input aria-label={t("Nội dung ghi chú chart")} maxLength={256} value={drawingLabel} onChange={event => setDrawingLabel(event.target.value)} placeholder={t("Ghi chú tại mốc")} />}
                  </ChartFloatingToolbar></>}
                  {advancedChart ? <LegacyReplayToolbar workspace={workspace} theme={theme} speed={speed} onSpeed={setSpeed}
                    interval={effectiveReplayInterval} datasetSeconds={datasetSeconds} sync={replaySync} syncAvailable={Boolean(nativeHeaderSlots)}
                    onSync={value => { setIsPlaying(false); setReplaySync(value) }} onInterval={value => { setIsPlaying(false); setReplaySync(false); setReplayInterval(value) }}
                    busy={Boolean(pendingAction)} available={!conflict && state.status === 'ready'} canBack={cursor > 0} canForward={canReplayForward}
                    playing={isPlaying} onPlay={toggleReplay} onBack={rewindReplay} onForward={() => advanceReplay()} selecting={selectingReplayBar}
                    onSelect={() => { setIsPlaying(false); setSelectingReplayBar(current => !current); setChartNotice(selectingReplayBar ? '' : 'Bấm một nến trước cutoff hiện tại để bắt đầu replay; Escape để hủy.') }} />
                    : <ChartFloatingToolbar name="Replay" compactRow={1} storageKey={`tw:chart:replay-toolbar:${workspace}`} initialPosition={{ x: 330, y: 46 }}>
                    <button type="button" aria-label={t("Lùi một nến")} title={t("Lùi một nến (chỉ đọc)")} onClick={rewindReplay} disabled={conflict || Boolean(pendingAction) || state.status !== 'ready' || cursor <= 0}><ChartIcon name="back" /></button>
                    <button type="button" className="chart-play" data-testid="play-toggle" aria-label={isPlaying ? t("Tạm dừng") : t("Phát replay")} title={t("Phát / tạm dừng replay")} onClick={toggleReplay} disabled={!isPlaying && (!canReplayForward || conflict || Boolean(pendingAction) || state.status !== 'ready')}><ChartIcon name={isPlaying ? 'pause' : 'play'} /></button>
                    <button type="button" data-testid="step-1" aria-label={t("Tiến một nến")} title={t("→ Tiến một nến")} aria-keyshortcuts="ArrowRight" onClick={() => advanceReplay()} disabled={!canReplayForward || conflict || Boolean(pendingAction) || state.status !== 'ready'}><ChartIcon name="step" /></button>
                    <button type="button" data-testid="step-10" aria-label={t("Tiến mười nến")} title={t("Shift + → Tiến mười nến")} aria-keyshortcuts="Shift+ArrowRight" onClick={() => advanceReplay(false, 10)} disabled={!canReplayForward || conflict || Boolean(pendingAction) || state.status !== 'ready'}>10</button>
                    <FxSelect label={t("Tốc độ replay")} value={speed} onChange={setSpeed} disabled={Boolean(pendingAction)} localizeOptions={false} options={['0.5', '1', '2', '4'].map(value => ({ value, label: value + '×', localize: false }))} /><span className="chart-float-cutoff" title={formatTimestamp(replay.cutoff_timestamp) + ' UTC'}>#{cursor}</span>
                  </ChartFloatingToolbar>}
                  {advancedChart ? <TradingViewReplayChart key={`${sessionId}:${replay.payload.dataset_id}:${historicalView ? cursor : 'canonical'}`}
                    workspace={workspace} datasetId={replay.payload.dataset_id} datasetSha256={replay.dataset_sha256} viewCursorIndex={replay.view_cursor_index} symbol={replayContext.instrument} assetClass={order.instrument?.asset_class} seconds={activeDataset?.timeframe_seconds || replay.payload.execution?.timeframe_seconds}
                    cutoff={Number(replay.cutoff_timestamp)} theme={theme} levels={priceLevels} orderEditable={!order.disabled} orderGeneration={`${sessionId}:${revision}:${cursor}`}
                    onOrderDragStart={() => setIsPlaying(false)} tickSize={order.instrument?.tick_size} onOrderPriceChange={order.changePrice} rows={visibleRows} sessionId={sessionId}
                    viewportRequest={viewportRequest} drawings={drawings.objects} onCrosshair={setCrosshair} preferredInterval={nativeIntervalRef.current?.sessionId === sessionId ? nativeIntervalRef.current.interval : undefined} onHeaderSlots={slots => { if (slots?.interval) nativeIntervalRef.current = { sessionId, interval: slots.interval }; setNativeHeaderSlots(slots) }} selectingReplayBar={selectingReplayBar} onReplayBarSelect={selectReplayBar} />
                    : <ReplayChart theme={theme} levels={priceLevels} orderEditable={!order.disabled} orderGeneration={`${sessionId}:${revision}:${cursor}`} onOrderDragStart={() => setIsPlaying(false)} tickSize={order.instrument?.tick_size} onOrderPriceChange={order.changePrice} rows={visibleRows} sessionId={sessionId} chartType={chartType} showVolume={showVolume} showAverage={showAverage} viewportRequest={viewportRequest} drawings={drawings.objects} onCrosshair={setCrosshair} onAnchorSelect={handleChartAnchor} />}
                  <div className="chart-badge chart-badge-left">{replay.payload.dataset_id}</div>
                  <div className="chart-badge chart-badge-right">{replay.historical_view ? t("HISTORICAL CUTOFF") : t("LIVE REPLAY CURSOR")}</div>
                </div>
                <nav className="chart-utility-rail" aria-label={t("Tiện ích replay")}>
                  {advancedChart && <div className="legacy-rail-tools"><button type="button" aria-label={t('Cây đối tượng chart')} title={t('Cây đối tượng chart')} disabled={!nativeHeaderSlots} aria-pressed={sideOpen && sidePanel==='native-objects'} onClick={() => sideOpen && sidePanel==='native-objects' ? closeSide() : openPanel('native-objects')}><ChartIcon name="layers" /></button></div>}
                  {(advancedChart ? [['order', 'Lệnh mô phỏng', 'place-order', 'Order'], ['goto', 'Đi tới cutoff', 'goto', 'Go To'], ['news', 'Tin tức', 'news', 'News']] : [['order', 'Lệnh mô phỏng', 'order'], ['objects', 'Danh sách đối tượng', 'objects'], ['data', 'Danh sách dữ liệu', 'data'], ['context', 'Chi tiết replay', 'info']]).map(([panel, label, icon, caption]) => <button key={panel} type="button" aria-label={t(label)} title={t(label)} aria-pressed={sideOpen && sidePanel === panel} onClick={() => sideOpen && sidePanel === panel ? closeSide() : openPanel(panel)}><ChartIcon name={icon} />{caption && <span>{t(caption)}</span>}</button>)}
                  {advancedChart ? <button type="button" aria-label={t('Journal tại cutoff này')} title={t('Journal tại cutoff này')} aria-pressed={sideOpen && sidePanel==='journal'} onClick={() => sideOpen && sidePanel==='journal' ? closeSide() : openPanel('journal')}><ChartIcon name="journal" /><span>{t('Journal')}</span></button> : <a aria-label={t('Journal tại cutoff này')} href={journalHref}><ChartIcon name="journal" /></a>}
                  {advancedChart && <button type="button" className="legacy-session-settings" aria-label={t('Cài đặt phiên')} title={t('Cài đặt phiên')} disabled={state.status !== 'ready' || Boolean(pendingAction) || conflict} onClick={openSessionSettings}><ChartIcon name="settings" /></button>}
                  {advancedChart && <button type="button" className="legacy-mobile-theme" onClick={() => applyAppearance({ ...appearance, theme: theme === 'dark' ? 'light' : 'dark' })} aria-label={theme === 'dark' ? t("Chuyển giao diện sáng") : t("Chuyển giao diện tối")}><ChartIcon name={theme === 'dark' ? 'moon' : 'sun'} /></button>}
                </nav>
              </div>

              <div className={`chart-bottom-bar ${historicalView ? 'is-historical' : ''}`} role="group" aria-label={t("Điều khiển replay phía dưới chart")}>
                <div className="chart-bottom-range" role="group" aria-label={t("Khoảng thời gian chart")}>
                  {[['1D', 1], ['5D', 5], ['1M', 30], ['All', null]].map(([range, days]) => <button key={range} type="button" onClick={() => requestViewport(days ? 'range' : 'fit', { days })}>{range}</button>)}
                  <button type="button" onClick={() => requestViewport('latest')}>{t("Tới cutoff")}</button>
                  <a className="context-link" href={learnHref}>{t("Học & thuật ngữ")}</a>
                </div>
                <div className="chart-bottom-replay">
                  <button type="button" className="chart-bottom-step" aria-label={t("Về nến đầu tiên")} onClick={() => loadSession(sessionId, 0)} disabled={conflict || Boolean(pendingAction) || state.status !== 'ready' || cursor <= 0}>|‹</button>
                  <button type="button" className="chart-bottom-step" aria-label={t("Mở cutoff trước")} onClick={() => loadSession(sessionId, Math.max(0, cursor - 1))} disabled={conflict || Boolean(pendingAction) || state.status !== 'ready' || cursor <= 0}>‹</button>
                  {historicalView && <button type="button" onClick={() => loadSession(sessionId)} disabled={state.status !== 'ready'}>{t("Về cursor mới nhất")}</button>}
                  <span className="chart-bottom-cursor">#{cursor} / #{canonicalCursor} {t("· UTC")}</span>
                </div>
                <div className="chart-bottom-status"><span className="status-dot" /> {t("Paper replay")} <strong>{replayContext.instrument}</strong></div>
              </div>

              {advancedChart ? <LegacyTradingBar key={`${workspace}:${sessionId}`} workspace={workspace} sessionId={sessionId} order={order} quotes={quotes} onBeginOrder={beginOrder} analyticsHref={routeHref('analytics', { surface: 'workspace' })} symbol={replayContext.instrument} theme={theme} /> : <div className="chart-trading-bar" role="group" aria-label={t("Giao dịch mô phỏng")}>
                <div className="chart-trading-actions">
                  {['BUY', 'SELL'].map(side => <button key={side} type="button" className={side.toLowerCase()} disabled={order.disabled || Boolean(order.active)} onClick={() => beginOrder(side)} title={`${side === 'BUY' ? 'Ask' : 'Bid'} mô phỏng tại cutoff; fill ở nến kế tiếp`}>{side === 'BUY' ? t("Buy") : t("Sell")} <strong>{formatPrice(side === 'BUY' ? quotes.ask : quotes.bid)}</strong></button>)}
                  <label>{t("Size")}<input aria-label={t("Khối lượng nhanh")} type="number" min={order.instrument?.quantity_min || '0'} step={order.instrument?.quantity_step || 'any'} value={order.draft.quantity} disabled={order.disabled || Boolean(order.active)} onChange={event => order.setDraft(current => ({ ...current, quantity: event.target.value }))} /></label>
                  <span className="chart-sim-tag">{t("SIM")}</span><button type="button" aria-expanded={sideOpen && sidePanel === 'order'} onClick={() => openPanel('order')}>{t("Lệnh")}{order.active ? '· 1' : ''}</button>
                </div>
                <div className="chart-trading-account"><span>{t('Balance')}<strong>{money(order.account?.balance, order.costs?.account_ccy)}</strong></span><span>{t('Equity')}<strong>{money(order.account?.equity, order.costs?.account_ccy)}</strong></span><span>{t('P/L')}<strong>{money(order.account?.floating_pl, order.costs?.account_ccy)}</strong></span></div>
              </div>}
              {activityWaiting && <div className="chart-notice" role="status">{t('Chưa lưu được thời gian luyện tập. Đang thử lại…')}</div>}
              {chartNotice && <div className="chart-notice" role="status">{t(chartNotice)}<button type="button" aria-label={t("Đóng thông báo")} onClick={() => setChartNotice('')}>×</button></div>}

              <div className="replay-evidence-strip" role="group" aria-label={t("Bằng chứng chart")}>
                <div><span className="story-label">{t("03 · EVIDENCE")}</span><strong>{crosshair?.row ? t("Nến đang chọn") : t("Nến tại cutoff")}</strong></div>
                <span>{visibleRows.length} {t("nến được phép hiển thị")}</span>
                <span>{replay.has_future_rows ? t("Nến tương lai đang ẩn") : t("Đã ở cuối dữ liệu")}</span>
                <span>{crosshair?.row ? `Crosshair #${(replay.visible_row_start || 0) + visibleRows.findIndex((item) => Number(item.timestamp) === Number(crosshair.row.timestamp))}` : `Cursor #${cursor}`}</span>
              </div>

              <div className="bar-readout" role="group" aria-label={t("OHLC nến hiện tại")}>
                <span className="bar-readout-label">{crosshair?.row ? t("Crosshair") : t("Nến hiện tại")} #{crosshair?.row ? (replay.visible_row_start || 0) + visibleRows.findIndex((item) => Number(item.timestamp) === Number(crosshair.row.timestamp)) : cursor}</span>
                <span>{t("O")} <strong>{formatPrice((crosshair?.row || currentBar)?.open)}</strong></span>
                <span>{t("H")} <strong>{formatPrice((crosshair?.row || currentBar)?.high)}</strong></span>
                <span>{t("L")} <strong>{formatPrice((crosshair?.row || currentBar)?.low)}</strong></span>
                <span>{t("C")} <strong>{formatPrice((crosshair?.row || currentBar)?.close)}</strong></span>
                {crosshair?.row && <span className="bar-readout-time">{formatTimestamp(crosshair.row.timestamp)} {t("UTC")}</span>}
              </div>

              <div className="replay-jump" role="group" aria-label={t("Đi tới nến")}>
                <div className="replay-jump-heading">
                  <span>{t("Đi tới nến đã có trong session")}</span>
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
                  aria-label={t("Chọn nến replay")}
                />
                <button type="button" onClick={jumpToCursor} disabled={conflict || Boolean(pendingAction) || state.status !== 'ready' || Number(jumpDraft) === cursor}>{t("Mở cutoff này")}</button>
              </div>
            </div>

            {!(advancedChart && sidePanel==='order') && <aside className={`replay-side ${sidePanel==='journal' ? 'is-journal' : ''}`} id="replay-context-panel" aria-label={t(sidePanel==='journal' ? 'Journal' : 'Chi tiết replay và nhánh')} ref={sideRef} tabIndex={-1} onKeyDown={(event) => { if (event.key === 'Escape') closeSide() }}>
              {advancedChart && sidePanel==='journal' ? <LegacyJournal execution={order.execution} assetStates={order.assetStates} symbol={replayContext.instrument} cutoff={replay.cutoff_timestamp} onClose={closeSide} onOpenJournal={journalHref} /> : advancedChart && sidePanel==='native-objects' ? <><header className="chart-dock-heading"><strong>{t('Cây đối tượng chart')}</strong><button type="button" className="replay-panel-close" aria-label={t('Đóng panel')} onClick={closeSide}><ChartIcon name="close" /></button></header><LegacyObjectTree controls={nativeHeaderSlots} symbol={replayContext.instrument} /></> : <>
              <header className="chart-dock-heading"><strong>{t(({ order: 'Lệnh', objects: 'Đối tượng', data: 'Dữ liệu', context: 'Chi tiết & nhánh', goto: 'Go To', news: 'News', compare: 'So sánh mã', layout: 'New Layout', mentor: 'AI Mentor', search: 'Quick Search', scalper: 'Scalper mode', editor: 'Editor' })[sidePanel])}</strong><button type="button" className="replay-panel-close" aria-label={t("Đóng panel")} onClick={closeSide}><ChartIcon name="close" /></button></header>
              {!['goto', 'news', 'compare', 'layout', 'mentor', 'search', 'scalper', 'editor'].includes(sidePanel) && <nav className="chart-dock-tabs" aria-label={t("Panel replay")}>{[['order', 'Lệnh'], ['objects', 'Đối tượng'], ['data', 'Dữ liệu'], ['context', 'Chi tiết']].map(([panel, label]) => <button key={panel} type="button" aria-pressed={sidePanel === panel} onClick={() => { if (panel === 'order') setIsPlaying(false); setSidePanel(panel) }}>{t(label)}</button>)}</nav>}
              {['compare', 'layout', 'mentor', 'search', 'scalper', 'editor'].includes(sidePanel) && <ChartHeaderPreview key={`${sessionId}:${sidePanel}`} tool={sidePanel} symbol={replayContext.instrument} onOpenTool={panel => setSidePanel(panel)} />}
              {sidePanel === 'news' && <section className="legacy-news-empty"><ChartIcon name="news" /><h2>{t("Chưa có lịch tin cho dataset này")}</h2><p>{t("Phiên hiện tại có dữ liệu OHLC, chưa có nguồn tin lịch sử gắn với cutoff.")}</p><button type="button" onClick={() => setSidePanel('data')}>{t("Xem dữ liệu phiên")}</button></section>}
              {sidePanel === 'goto' && <div className="legacy-goto"><p>{t("Chọn một nến đã mở trong phiên. Các nến sau cutoff vẫn được ẩn.")}</p><form className="replay-date-jump" onSubmit={event => { event.preventDefault(); jumpToCursor() }}><label>{t("Nến đã mở")}<input type="number" aria-label={t("Số nến cutoff")} min="0" max={canonicalCursor} step="1" value={jumpDraft} onChange={event => setJumpDraft(event.target.value)} /></label><button type="submit" disabled={conflict || Boolean(pendingAction) || state.status !== 'ready' || !Number.isInteger(Number(jumpDraft)) || Number(jumpDraft) < 0 || Number(jumpDraft) > canonicalCursor || Number(jumpDraft) === cursor}>{t("Mở cutoff này")}</button></form></div>}
              {sidePanel === 'order' && <ChartOrderPanel order={order} blockedReason={orderBlockedReason} />}
              {sidePanel === 'context' && <div className="chart-context-content">
              <section className="decision-panel">
                <div className="side-heading">
                  <div>
                    <span>{t("04 · NEXT ACTION")}</span>
                    <strong>{t("Quyết định tại nến #")}{cursor}</strong>
                  </div>
                  <span className="mode-pill">{t("SIM")}</span>
                </div>
                <p>{t("Đọc chart và ghi lại hypothesis trước khi mở bước kế tiếp. Replay này chỉ tạo bằng chứng local; không gửi lệnh broker.")}</p>
                <div className="decision-readout">
                  <span>{t("Giá đóng hiện tại")}</span>
                  <strong>{formatPrice(currentBar?.close)}</strong>
                  <small>{formatTimestamp(currentBar?.timestamp)} {t("UTC")}</small>
                </div>
                {canOpenOrder
                  ? <a className="next-action-link" href={routeHref('trade', { surface: 'workspace', intent: 'order' })}>{t("Mở Trade draft / risk preview →")}</a>
                  : <p>{t("Về cursor mới nhất hoặc tạo nhánh từ cutoff này để mở lệnh mô phỏng.")}</p>}
                {(annotationDraft || drawingTool !== 'cross') && <div className={`annotation-draft ${annotationDraft?.status === 'ready' ? 'is-ready' : ''}`} data-testid="annotation-draft" aria-live="polite">
                  {!annotationDraft && <span>{t("Đặt mốc trên chart để tạo nháp local.")}</span>}
                  {annotationDraft?.status === 'ready' && (
                    <>
                      <strong>{annotationDraft.draft.annotation_type === 'horizontal-line' ? t("Draft horizontal line đã chọn") : t("{count} đã chọn", { count: DRAWING_LABELS[annotationDraft.draft.annotation_type] })}</strong>
                      <span>#{(replay.visible_row_start || 0) + visibleRows.findIndex((item) => Number(item.timestamp) === Number(annotationDraft.draft.anchors[0].timestamp))} · {formatTimestamp(annotationDraft.draft.anchors[0].timestamp)} {t("UTC · giá")} {formatPrice(annotationDraft.draft.anchors[0].price)}</span>
                    </>
                  )}
                  {annotationDraft?.status !== 'ready' && annotationDraft?.message && <span>{annotationDraft.message}</span>}
                </div>}
                <a className="next-action-link" href={journalHref}>{t("Mở Journal cho cutoff này →")}</a>
                <a className="next-action-link" href={routeHref('analytics', { surface: 'workspace' })}>{t("Analytics của session →")}</a>
              </section>
              </div>}
              {sidePanel === 'objects' && <>{advancedChart && <p className="chart-native-objects-hint">{t("Ghi chú workspace được giữ ở đây. Hình vẽ mới nằm trong cây đối tượng của chart.")}</p>}<ReplayObjects drawings={drawings} /></>}
              {sidePanel === 'data' && <>
              <section className="replay-watchlist" aria-label={t("Danh sách dữ liệu local")}>
                <h2>{t("Dữ liệu local")}</h2>
                <p>{t(replay.payload.asset_states ? "Chuyển tài sản trong phiên; số dư, lịch sử và thời gian replay được giữ chung." : "Đổi instrument hoặc timeframe bằng dataset đã đăng ký. Mỗi lựa chọn mở phiên mới, không đổi phiên hiện tại.")}</p>
                {datasetState.status === 'error' && <p role="alert">{datasetState.error}</p>}
                <ul>{datasetState.items.filter(item => !replay.payload.asset_states || replay.payload.dataset_ids.includes(item.dataset_id)).map(item => <li key={item.dataset_id}>
                  {replay.payload.asset_states ? <button type="button" disabled={Boolean(pendingAction) || historicalView || conflict || item.dataset_id === replay.payload.dataset_id} aria-pressed={item.dataset_id === replay.payload.dataset_id} onClick={() => { setIsPlaying(false); mutate('asset', { expected_revision:revision, dataset_id:item.dataset_id }) }}>{item.instrument_id || item.dataset_id} · {displayTimeframe(item)}</button> : <a href={routeHref('replay', { session: null, cursor: null, cutoff: null, dataset: item.dataset_id, surface: 'workspace', fresh: '1' })} aria-current={item.dataset_id === replay?.payload?.dataset_id ? 'true' : undefined}>{item.instrument_id || item.dataset_id} · {displayTimeframe(item)}</a>}
                  <small>{datasetQualityLabel(item, t)} · {item.row_count ?? t("N/A")} {t("nến")}</small>
                </li>)}</ul>
              </section>
              </>}
              {['context', 'goto'].includes(sidePanel) && <>
              <form className="replay-date-jump" onSubmit={(event) => { event.preventDefault(); goToDate() }}>
                <label>{t("Đi tới thời điểm UTC đã mở")}<ProjectDateInput type="datetime-local" aria-label={t("Thời điểm replay UTC")} value={goToDateDraft} onChange={(event) => setGoToDateDraft(event.target.value)} /></label>
                <button type="submit" disabled={!goToDateDraft || Boolean(pendingAction) || state.status !== 'ready'}>{t("Mở cutoff theo thời điểm")}</button>
              </form>
              </>}
              {sidePanel === 'context' && <>
              <details className="replay-inspect-panel" data-testid="replay-inspect">
                <summary>
                  <span>{t("Inspect")}</span>
                  <strong>{t("Context & provenance")}</strong>
                </summary>
                <div className="replay-inspect-body">
                  <div className="replay-inspect-takeaway">
                    <span>{t("Decision note")}</span>
                    <p>{takeaway}</p>
                  </div>
                  <dl>
                    <div><dt>{t("Instrument")}</dt><dd>{replayContext.instrument}</dd></div>
                    <div><dt>{t("Timeframe")}</dt><dd>{displayTimeframe(replayContext)}</dd></div>
                    <div><dt>{t("Quality")}</dt><dd>{replayContext.quality}</dd></div>
                    <div><dt>{t("Provider")}</dt><dd>{replayContext.provider}</dd></div>
                    <div><dt>{t("Rows")}</dt><dd>{replayContext.rowCount ?? t("N/A")}</dd></div>
                    <div><dt>{t("Dataset hash")}</dt><dd><code>{replayContext.hash ? String(replayContext.hash).slice(0, 14) : t("Chưa có hash")}</code></dd></div>
                  </dl>
                </div>
              </details>
              <section>
                <div className="side-heading">
                  <div>
                    <span>{t("Rewind an toàn")}</span>
                    <strong>{t("Tạo nhánh mới")}</strong>
                  </div>
                  <span>#{branchCursor}</span>
                </div>
                <p>{t("Chọn nến cũ rồi tạo branch. Session gốc và quyết định cũ không bị sửa.")}</p>
                <input
                  className="branch-range"
                  data-testid="branch-cursor"
                  type="range"
                  min="0"
                  max={historicalView ? cursor : Math.max(0, cursor - 1)}
                  value={historicalView ? cursor : Math.min(branchCursor, Math.max(0, cursor - 1))}
                  onChange={(event) => setBranchCursor(Number(event.target.value))}
                  disabled={historicalView || cursor <= 0 || conflict || Boolean(pendingAction) || state.status !== 'ready'}
                  aria-label={t("Nến bắt đầu branch")}
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
                <h2>{t("Session")}</h2>
                <dl>
                  <div><dt>{t("ID")}</dt><dd><code>{replay.record_id}</code></dd></div>
                  <div><dt>{t("Branch")}</dt><dd><code>{replay.payload.branch_id}</code></dd></div>
                  <div><dt>{t("Parent")}</dt><dd>{lineage ? <code>{lineage}</code> : t("Gốc")}</dd></div>
                  <div><dt>{t("Dataset hash")}</dt><dd><code>{String(replay.dataset_sha256).slice(0, 14)}</code></dd></div>
                  <div><dt>{t("Future values")}</dt><dd>{t("Không render")}</dd></div>
                </dl>
              </section>
              </>}
              </>}
            </aside>}
            {advancedChart && sideOpen && sidePanel==='order' && <LegacyOrderDialog order={order} blockedReason={orderBlockedReason} theme={theme} chartDocument={nativeHeaderSlots?.market?.ownerDocument} onClose={closeSide} onJournal={() => openPanel('journal')} />}
            {advancedChart && goToPopup && <LegacyPopover anchor={goToPopup} theme={theme} label={t('Go To')} onClose={() => setGoToPopup(null)}>
              {!goToCustom ? <>{[['Đầu ngày kế tiếp','Y'],['Tin tức kế tiếp','W'],['Phiên kế tiếp','Z'],['Giá','']].map(([label,key]) => <button type="button" key={label} disabled title={t('Chưa có điều hướng này cho dataset')}><span>{t(label)}</span>{key && <kbd>{key}</kbd>}</button>)}<hr /><button type="button" onClick={() => setGoToCustom(true)}>{t('Tùy chỉnh')}</button><p className="legacy-menu-note">{t('Chỉ điều hướng trong dữ liệu đã mở.')}</p></> : <>
                <h3>{t('Tùy chỉnh')}</h3><form onSubmit={event => { event.preventDefault(); jumpToCursor(); setGoToPopup(null) }}><label>{t('Nến đã mở')}<input type="number" aria-label={t('Số nến cutoff')} min="0" max={canonicalCursor} step="1" value={jumpDraft} onChange={event => setJumpDraft(event.target.value)} /></label><button type="submit" disabled={conflict || Boolean(pendingAction) || state.status!=='ready' || !Number.isInteger(Number(jumpDraft)) || Number(jumpDraft)<0 || Number(jumpDraft)>canonicalCursor || Number(jumpDraft)===cursor}>{t('Mở cutoff này')}</button></form><form onSubmit={event => { event.preventDefault(); goToDate() }}><label>{t('Đi tới thời điểm UTC đã mở')}<ProjectDateInput type="datetime-local" value={goToDateDraft} onChange={event => setGoToDateDraft(event.target.value)} /></label><button type="submit" disabled={!goToDateDraft || Boolean(pendingAction)}>{t('Mở cutoff theo thời điểm')}</button></form>
              </>}
            </LegacyPopover>}
          </section>
        </>
      )}
      {sessionSettings && <SessionSettingsDrawer item={sessionSettings.item} dataset={activeDataset} replayRecord={replay} workspace={workspace} pending={sessionSettings.pending} blocked={sessionSettings.blocked} error={sessionSettings.error} onClose={closeSessionSettings} onSubmit={saveSessionSettings} />}
    </main>
  )
}
