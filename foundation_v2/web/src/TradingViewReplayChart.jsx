import React, { useEffect, useRef, useState } from 'react'
import { createAdvancedReplayDatafeed } from './advancedReplayDatafeed.js'
import { readChartSnapshot, writeChartSnapshot } from './advancedChartStorage.js'

let libraryPromise
const paneAppearance = theme => ({
  'paneProperties.backgroundType': 'solid', 'paneProperties.background': theme === 'light' ? '#ffffff' : '#101010',
  'paneProperties.vertGridProperties.color': theme === 'light' ? '#f0f2f5' : '#1c1c1c', 'paneProperties.horzGridProperties.color': theme === 'light' ? '#f0f2f5' : '#1c1c1c',
})
function loadLibrary() {
  if (window.TradingView?.widget) return Promise.resolve()
  if (!libraryPromise) libraryPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = '/charting_library/charting_library.standalone.js'
    script.onload = () => window.TradingView?.widget ? resolve() : reject(new Error('Advanced Charts bundle không hợp lệ.'))
    script.onerror = () => { script.remove(); libraryPromise = null; reject(new Error('Thiếu bộ Advanced Charts local tại /charting_library/.')) }
    document.head.append(script)
  })
  return libraryPromise
}

export default function TradingViewReplayChart(props) {
  const { workspace, sessionId, datasetId, symbol, assetClass, seconds, tickSize, rows, cutoff, theme, drawings, levels, orderEditable, orderGeneration, viewportRequest } = props
  const host = useRef(null), instance = useRef(null), latest = useRef(props)
  latest.current = props
  const [status, setStatus] = useState('loading'), [message, setMessage] = useState('')
  const storageKey = `tw:advanced-chart:v1:${workspace}:${sessionId}:${datasetId}`

  useEffect(() => {
    let cancelled = false, saveTimer, restoringImports = false, importedShapes = [], lines = []
    let widget, adapter, chart, fitButton, headerSlots, chartReady = false, fittedLevels = ''
    setStatus('loading'); setMessage('')
    const save = () => {
      if (cancelled || !widget || !chart) return
      const generation = latest.current.orderGeneration
      const savedCutoff = Number(latest.current.cutoff)
      widget.save(layout => {
        if (cancelled || generation !== latest.current.orderGeneration) return
        try { writeChartSnapshot(localStorage, storageKey, savedCutoff, layout); setMessage('Đã lưu chart trên trình duyệt này.') }
        catch { setMessage('Không lưu được chart: bộ nhớ trình duyệt không khả dụng hoặc đã đầy.') }
      })
    }
    const scheduleSave = () => { clearTimeout(saveTimer); saveTimer = setTimeout(save, 150) }
    loadLibrary().then(() => {
      if (cancelled) return
      const current = latest.current
      adapter = createAdvancedReplayDatafeed({ symbol, assetClass, seconds, tickSize, rows: current.rows, cutoff: current.cutoff })
      let saved
      try { saved = readChartSnapshot(localStorage, storageKey, Number(current.cutoff)) }
      catch { setMessage('Không đọc được chart đã lưu trên trình duyệt này.') }
      const seriesState = saved?.charts?.[0]?.panes?.flatMap(pane => pane.sources || []).find(source => source.type === 'MainSeries')?.state
      const restoredInterval = adapter.supported.includes(seriesState?.interval) ? seriesState.interval : adapter.interval
      if (seriesState) { seriesState.symbol = symbol; seriesState.interval = restoredInterval }
      widget = new window.TradingView.widget({
        container: host.current, library_path: '/charting_library/', datafeed: adapter.datafeed,
        symbol, interval: restoredInterval, locale: 'vi', timezone: 'Etc/UTC', theme: theme === 'light' ? 'Light' : 'Dark', autosize: true,
        ...(saved ? { saved_data: saved } : {}),
        custom_css_url: '/chart-legacy.css', favorites: { intervals: adapter.supported },
        enabled_features: ['seconds_resolution', 'items_favoriting'],
        disabled_features: ['header_symbol_search', 'symbol_search_hot_key', 'compare_symbol', 'header_compare', 'header_saveload', 'use_localstorage_for_settings', 'header_screenshot'],
        overrides: { ...paneAppearance(theme),
          'mainSeriesProperties.candleStyle.upColor': '#00a88a', 'mainSeriesProperties.candleStyle.downColor': '#f54659', 'mainSeriesProperties.candleStyle.borderUpColor': '#00a88a', 'mainSeriesProperties.candleStyle.borderDownColor': '#f54659', 'mainSeriesProperties.candleStyle.wickUpColor': '#00a88a', 'mainSeriesProperties.candleStyle.wickDownColor': '#f54659' },
      })
      widget.onChartReady(() => {
        if (cancelled) return
        const frame = host.current?.querySelector('iframe')
        if (frame) { frame.title = `Biểu đồ replay ${symbol}`; if (frame.contentDocument) frame.contentDocument.title = `WMReplay · ${symbol}` }
        chart = widget.activeChart()
        // Restoring a layout cannot change the authoritative dataset symbol.
        if (chart.symbol() !== symbol) chart.setSymbol(symbol)
        if (!adapter.supported.includes(chart.resolution())) chart.setResolution(adapter.interval)
        const refresh = () => {
          if (cancelled || !chart || !latest.current.rows.length) return
          for (const line of lines) line.remove()
          lines = []
          const state = latest.current
          if (fitButton) fitButton.style.display = state.levels ? '' : 'none'
          if (state.levels) for (const kind of ['entry', 'stop', 'target']) {
            const line = chart.createOrderLine()
            if (!line) continue
            const value = state.levels[kind]
            const color = kind === 'stop' ? '#ef5350' : kind === 'target' ? '#14b889' : '#719bea'
            line.setPrice(value).setText(kind === 'entry' ? `${state.levels.side} · ${state.levels.state}${state.levels.floating == null ? '' : ` · P/L ${state.levels.floating} ${state.levels.currency}`}` : kind === 'stop' ? 'SL · SIM' : 'TP · SIM')
              .setQuantity('SIM').setLineColor(color).setBodyBorderColor(color).setQuantityBorderColor(color).setEditable(kind !== 'entry' && state.orderEditable).setCancellable(false)
            if (kind !== 'entry') {
              const generation = state.orderGeneration
              line.onMove(() => {
                const now = latest.current
                if (cancelled || !now.orderEditable || now.orderGeneration !== generation) { line.setPrice(now.levels?.[kind] ?? value); return }
                now.onOrderDragStart()
                const tick = Number(now.tickSize)
                const price = line.getPrice()
                const rounded = tick > 0 ? Number((Math.round(price / tick) * tick).toFixed(8)) : price
                line.setPrice(now.levels?.[kind] ?? value)
                if (Number.isFinite(rounded) && rounded > 0) now.onOrderPriceChange(kind, rounded)
              })
            }
            lines.push(line)
          }
          const signature = state.levels ? [state.levels.entry, state.levels.stop, state.levels.target].join(':') : ''
          if (signature !== fittedLevels) {
            fittedLevels = signature
            if (state.levels) fitOrder()
            else chart.getPanes()[0]?.getMainSourcePriceScale()?.setAutoScale(true)
          }
        }
        const fitOrder = () => {
          const levels = latest.current.levels
          if (!levels) return
          const range = chart.getVisiblePriceRange()
          const from = Math.min(range.from, levels.entry, levels.stop, levels.target)
          const to = Math.max(range.to, levels.entry, levels.stop, levels.target)
          const padding = (to - from) * .06
          chart.getPanes()[0]?.getMainSourcePriceScale()?.setVisiblePriceRange({ from: from - padding, to: to + padding })
        }
        const importAnnotations = () => {
          if (cancelled) return
          restoringImports = true
          try {
            const existing = new Set(chart.getAllShapes().map(shape => shape.id))
            for (const id of importedShapes) if (existing.has(id)) chart.removeEntity(id)
            importedShapes = []
            for (const record of latest.current.drawings) {
              if (record.hidden) continue
              const payload = record.payload
              const shape = { 'horizontal-line': 'horizontal_line', entry: 'horizontal_line', sl: 'horizontal_line', tp: 'horizontal_line',
                trendline: 'trend_line', zone: 'rectangle', text: 'text', arrow: payload.anchors.length > 1 ? 'arrow' : 'arrow_up' }[payload.annotation_type]
              if (!shape) continue
              const points = payload.anchors.map(anchor => ({ time: Number(anchor.timestamp), price: Number(anchor.price) }))
              const options = { shape, text: payload.label, lock: true, disableSelection: true, disableSave: true, disableUndo: true, showInObjectsTree: false }
              const id = points.length === 1 && shape !== 'text' ? chart.createShape(points[0], options) : chart.createMultipointShape(points, options)
              if (id) importedShapes.push(id)
            }
          } finally { restoringImports = false }
        }
        const ready = () => {
          if (cancelled) return
          // Saved layouts carry palette values; the shell's current theme wins.
          widget.changeTheme(latest.current.theme === 'light' ? 'Light' : 'Dark').then(() => {
            if (cancelled) return
            widget.applyOverrides(paneAppearance(latest.current.theme))
            refresh(); importAnnotations()
            const prefix = latest.current.rows
            if (!saved && prefix.length > 1) chart.setVisibleRange({ from: Number(prefix[Math.max(0, prefix.length - 100)].timestamp), to: Number(prefix.at(-1).timestamp) }).catch(() => {})
            setStatus('ready')
            chartReady = true
            if (headerSlots) latest.current.onHeaderSlots?.(headerSlots)
          }).catch(error => { if (!cancelled) { setStatus('error'); setMessage(String(error.message || error)) } })
        }
        instance.current = { widget, adapter, chart, refresh, importAnnotations, save }
        if (!adapter.update(latest.current.rows, latest.current.cutoff)) chart.resetData()
        // Pause before native drawing/pan/order gestures, not after a drag ends.
        widget.subscribe('mouse_down', () => latest.current.onOrderDragStart())
        widget.subscribe('onAutoSaveNeeded', scheduleSave)
        widget.subscribe('drawing_event', (id, event) => {
          if (restoringImports) return
          if (importedShapes.includes(id)) { if (event === 'remove') setTimeout(importAnnotations, 0); return }
          if (['create', 'move', 'remove', 'hide', 'show', 'properties_changed', 'points_changed'].includes(event)) scheduleSave()
        })
        chart.crossHairMoved().subscribe(null, event => {
          const row = latest.current.rows.find(row => Number(row.timestamp) === Number(event.time))
          latest.current.onCrosshair?.(row ? { row } : null)
        })
        widget.headerReady().then(() => {
          if (cancelled) return
          const marketHost = widget.createButton({ align: 'left', useTradingViewStyle: false })
          marketHost.className = 'legacy-market-host'
          // v23 wraps official custom buttons in a toolbar group. Keep the
          // market identity first without moving the library-owned controls.
          marketHost.parentElement.parentElement.classList.add('legacy-market-group')
          const sessionHost = widget.createButton({ align: 'right', useTradingViewStyle: false })
          sessionHost.className = 'legacy-session-host'
          headerSlots = { market: marketHost, session: sessionHost }
          if (chartReady) latest.current.onHeaderSlots?.(headerSlots)
          const button = widget.createButton()
          button.textContent = 'Lưu chart'
          button.title = 'Lưu layout và công cụ vẽ theo session/cutoff trên trình duyệt này'
          button.addEventListener('click', save)
          fitButton = widget.createButton()
          fitButton.textContent = 'Vừa lệnh'
          fitButton.title = 'Hiển thị đầy đủ Entry, Stop loss và Take profit mô phỏng'
          fitButton.style.display = latest.current.levels ? '' : 'none'
          fitButton.addEventListener('click', fitOrder)
          for (const control of [button, fitButton]) {
            control.setAttribute('role', 'button')
            control.tabIndex = 0
            control.addEventListener('keydown', event => {
              if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); control.click() }
            })
          }
        })
        chart.dataReady(ready)
      })
    }).catch(error => { if (!cancelled) { setStatus('error'); setMessage(String(error.message || error)) } })
    return () => {
      cancelled = true; clearTimeout(saveTimer); instance.current = null
      latest.current.onHeaderSlots?.(null)
      adapter?.dispose(); widget?.remove()
    }
  }, [workspace, sessionId, datasetId, symbol, assetClass, seconds, tickSize, storageKey])

  useEffect(() => {
    const item = instance.current
    if (!item) return
    if (!item.adapter.update(rows, cutoff)) item.chart.resetData()
    const refresh = () => item === instance.current && item.refresh()
    item.chart.dataReady(refresh)
  }, [rows, cutoff, levels, orderEditable, orderGeneration])
  useEffect(() => { instance.current?.importAnnotations() }, [drawings])
  useEffect(() => {
    if (!message || status !== 'ready' || !message.startsWith('Đã lưu')) return undefined
    const timer = setTimeout(() => setMessage(''), 4000)
    return () => clearTimeout(timer)
  }, [message, status])
  useEffect(() => {
    const item = instance.current
    if (!item) return
    item.widget.changeTheme(theme === 'light' ? 'Light' : 'Dark').then(() => {
      if (item === instance.current) item.widget.applyOverrides(paneAppearance(theme))
    })
  }, [theme])
  useEffect(() => {
    const chart = instance.current?.chart
    if (!chart || !viewportRequest || !rows.length) return
    const to = Number(rows.at(-1).timestamp)
    const from = viewportRequest.kind === 'fit' ? Number(rows[0].timestamp) : Math.max(Number(rows[0].timestamp), to - (viewportRequest.days ? viewportRequest.days * 86400 : 80 * seconds))
    if (from < to) chart.setVisibleRange({ from, to }).catch(() => {})
  }, [viewportRequest])

  const fallbackUrl = new URL(window.location.href)
  fallbackUrl.searchParams.set('chart_engine', 'lightweight')
  return <div className="replay-chart advanced-replay-chart" data-testid="replay-chart" data-chart-engine="advanced" data-chart-status={status} data-visible-row-count={rows.length} data-cutoff={cutoff} role="group" aria-label={`Advanced Charts · ${symbol} · ${rows.length} nến đến cutoff ${cutoff} UTC`}>
    <div ref={host} className="advanced-chart-host" />
    {status === 'loading' && <div className="advanced-chart-message" role="status">Đang mở Advanced Charts…</div>}
    {status === 'error' && <div className="advanced-chart-message" role="alert">{message} <a href={fallbackUrl.href}>Mở chart dự phòng</a></div>}
    {status === 'ready' && message && <span className="advanced-chart-save-status" role="status">{message}</span>}
  </div>
}
