import { displayDate, displayTime } from './dateFormat.js'
import { nativeChartPalette } from './nativeChartPalette.js'
import { useTestingLocale } from './testingLocale.jsx'
import { useEffect, useRef, useState } from 'react'
import { createAdvancedReplayDatafeed } from './advancedReplayDatafeed.js'
import { readChartSnapshot, writeChartSnapshot } from './advancedChartStorage.js'
import { createChartSave } from './advancedChartSave.js'

let libraryPromise
const volumeAppearance = theme => {
  const p = nativeChartPalette(theme)
  return { 'volume.color.0': p.negative, 'volume.color.1': p.positive, 'volume ma.color': p.highlight }
}
function applyVolumeAppearance(widget, chart, theme) {
  const overrides = volumeAppearance(theme)
  widget.applyStudiesOverrides(Object.fromEntries(Object.entries(overrides).map(([key, value]) => [`volume.${key}`, value])))
  // Restored Volume studies carry their own styles; defaults alone cannot repaint them.
  for (const study of chart.getAllStudies()) if (study.name === 'Volume') chart.getStudyById(study.id).applyOverrides(overrides)
}
const paneAppearance = theme => {
  const p = nativeChartPalette(theme)
  return {
    'paneProperties.backgroundType': 'solid', 'paneProperties.background': p.canvas,
    'paneProperties.vertGridProperties.color': p.grid, 'paneProperties.horzGridProperties.color': p.grid,
    'scalesProperties.textColor': p.text, 'scalesProperties.lineColor': p.border,
    ...Object.fromEntries(['candleStyle', 'hollowCandleStyle', 'haStyle'].flatMap(style =>
      ['upColor', 'borderUpColor', 'wickUpColor', 'downColor', 'borderDownColor', 'wickDownColor'].map(key =>
        [`mainSeriesProperties.${style}.${key}`, key.includes('Up') || key === 'upColor' ? p.positive : p.negative]))),
    'mainSeriesProperties.barStyle.upColor': p.positive,
    'mainSeriesProperties.barStyle.downColor': p.negative,
    'mainSeriesProperties.lineStyle.color': p.primary,
    'mainSeriesProperties.areaStyle.linecolor': p.primary,
    'mainSeriesProperties.areaStyle.color1': `${p.primary}33`,
    'mainSeriesProperties.areaStyle.color2': `${p.primary}05`,
  }
}
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
  const { t, locale } = useTestingLocale()

  const { workspace, sessionId, datasetId, symbol, assetClass, seconds, tickSize, rows, cutoff, theme, drawings, levels, orderEditable, orderGeneration, viewportRequest } = props
  const host = useRef(null), instance = useRef(null), latest = useRef(props)
  latest.current = props
  const [status, setStatus] = useState('loading'), [message, setMessage] = useState('')
  const storageKey = `tw:advanced-chart:v1:${workspace}:${sessionId}:${datasetId}`

  useEffect(() => {
    let cancelled = false, layoutSave, saveState = 'saved', restoringImports = false, importedShapes = [], lines = []
    let widget, adapter, chart, headerSlots, headerObserver, nativeHeader, chartReady = false, fittedLevels = '', reservedWidth = -1
    const resizeChrome = () => {
      const frame = host.current?.querySelector('iframe'), canvas = host.current?.closest('.chart-canvas')
      if (!frame?.contentDocument || !canvas) return
      canvas.closest('.replay-shell')?.style.setProperty('--legacy-frame-height', `${canvas.closest('.chart-frame').clientHeight}px`)
      const reserved = Math.max(0, Math.round(host.current.clientWidth - canvas.clientWidth))
      if (reserved === reservedWidth) return
      reservedWidth = reserved
      frame.contentDocument.documentElement.style.setProperty('--legacy-reserved-width', `${reserved}px`)
      // v23 measures body on resize. Resizing the canvas alone clips the native price scale.
      frame.contentWindow.dispatchEvent(new Event('resize'))
    }
    const pauseNative = () => latest.current.onOrderDragStart()
    const publishHeader = interval => {
      if (!cancelled && chartReady && host.current && headerSlots?.market) latest.current.onHeaderSlots?.({ ...headerSlots, saveState, interval: typeof interval === 'string' ? interval : chart.resolution(), chartType: chart.chartType(), compact: host.current.clientWidth < 1180, headerHeight: headerSlots.market.ownerDocument.querySelector('.layout__area--top')?.getBoundingClientRect().height || 38 })
    }
    const loadingTimer = setTimeout(() => {
      if (cancelled || chartReady) return
      setStatus('error')
      setMessage('Advanced Charts chưa tải được. Thử mở trang này trong Chrome/Edge hoặc dùng chart dự phòng.')
    }, 20000)
    setStatus('loading'); setMessage('')
    const save = () => layoutSave?.save()
    const scheduleSave = () => { if (chartReady && !restoringImports) layoutSave?.dirty() }
    const saveShortcut = event => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 's') { event.preventDefault(); save() }
    }
    loadLibrary().then(() => {
      if (cancelled) return
      const current = latest.current
      adapter = createAdvancedReplayDatafeed({ symbol, assetClass, seconds, tickSize, rows: current.rows, cutoff: current.cutoff })
      let saved
      try { saved = readChartSnapshot(localStorage, storageKey, Number(current.cutoff)) }
      catch { setMessage('Không đọc được chart đã lưu trên trình duyệt này.') }
      const seriesState = saved?.charts?.[0]?.panes?.flatMap(pane => pane.sources || []).find(source => source.type === 'MainSeries')?.state
      const restoredInterval = adapter.supported.includes(current.preferredInterval) ? current.preferredInterval : adapter.supported.includes(seriesState?.interval) ? seriesState.interval : adapter.interval
      if (seriesState) { seriesState.symbol = symbol; seriesState.interval = restoredInterval }
      widget = new window.TradingView.widget({
        container: host.current, library_path: '/charting_library/', datafeed: adapter.datafeed,
        symbol, interval: restoredInterval, locale: locale.slice(0, 2), timezone: 'Etc/UTC', theme: theme === 'light' ? 'Light' : 'Dark', autosize: true,
        ...(saved ? { saved_data: saved } : {}),
        custom_formatters: { dateFormatter: { format: date => displayDate(date), formatLocal: date => displayDate(date, { timeZone: null }) }, timeFormatter: { format: date => displayTime(date, { seconds: true }), formatLocal: date => displayTime(date, { seconds: true, timeZone: null }) } },
        custom_css_url: '/chart-legacy.css', favorites: { intervals: adapter.supported, chartTypes: ['Candles'] },
        header_widget_buttons_mode: 'adaptive',
        auto_save_delay: 1,
        enabled_features: ['seconds_resolution', 'items_favoriting'],
        // v23's sampled analytics assumes an http document URL and fails on srcdoc.
        disabled_features: ['14851', 'header_symbol_search', 'symbol_search_hot_key', 'compare_symbol', 'header_compare', 'header_saveload', 'use_localstorage_for_settings', 'header_screenshot', 'header_fullscreen_button', 'widget_logo'],
        overrides: paneAppearance(theme),
        studies_overrides: Object.fromEntries(Object.entries(volumeAppearance(theme)).map(([key, value]) => [`volume.${key}`, value])),
      })
      widget.onChartReady(() => {
        if (cancelled) return
        clearTimeout(loadingTimer)
        const frame = host.current?.querySelector('iframe')
        if (frame) { frame.title = t('Biểu đồ replay {symbol}', { symbol }); if (frame.contentDocument) frame.contentDocument.title = `WMReplay · ${symbol}` }
        chart = widget.activeChart()
        layoutSave = createChartSave({
          snapshot: callback => widget.save(callback),
          persist: (at, layout) => writeChartSnapshot(localStorage, storageKey, at, layout),
          context: () => ({ generation: latest.current.orderGeneration, cutoff: Number(latest.current.cutoff) }),
          onState: value => { saveState = value; publishHeader(); if (value === 'error') setMessage('Không lưu được chart: bộ nhớ trình duyệt không khả dụng hoặc đã đầy.'); else if (value === 'saved') setMessage('Đã lưu chart trên trình duyệt này.'); else setMessage('') },
        })
        // Restoring a layout cannot change the authoritative dataset symbol.
        if (chart.symbol() !== symbol) chart.setSymbol(symbol)
        if (!adapter.supported.includes(chart.resolution())) chart.setResolution(adapter.interval)
        const refresh = () => {
          if (cancelled || !chart || !latest.current.rows.length) return
          for (const line of lines) line.remove()
          lines = []
          const state = latest.current
          if (state.levels) for (const kind of ['entry', 'stop', 'target']) {
            const line = chart.createOrderLine()
            if (!line) continue
            const value = state.levels[kind]
            const palette = nativeChartPalette(state.theme)
            const color = kind === 'stop' ? palette.negative : kind === 'target' ? palette.positive : palette.primary
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
              const palette = nativeChartPalette(latest.current.theme)
              const color = payload.annotation_type === 'sl' ? palette.negative : payload.annotation_type === 'tp' ? palette.positive : record.local ? palette.highlight : palette.primary
              const options = { shape, text: payload.label, lock: true, disableSelection: true, disableSave: true, disableUndo: true, showInObjectsTree: false,
                overrides: { linecolor: color, color, textColor: color, backgroundColor: color, transparency: 85 } }
              const id = points.length === 1 && shape !== 'text' ? chart.createShape(points[0], options) : chart.createMultipointShape(points, options)
              if (id) importedShapes.push(id)
            }
          } finally { restoringImports = false }
        }
        const ready = () => {
          if (cancelled) return
          // Saved layouts carry palette values; repaint with the native chart theme.
          widget.changeTheme(latest.current.theme === 'light' ? 'Light' : 'Dark').then(() => {
            if (cancelled) return
            widget.applyOverrides(paneAppearance(latest.current.theme))
            applyVolumeAppearance(widget, chart, latest.current.theme)
            refresh(); importAnnotations()
            setStatus('ready')
            chartReady = true
            publishHeader()
            if (!saved) scheduleSave()
          }).catch(error => { if (!cancelled) { setStatus('error'); setMessage(String(error.message || error)) } })
        }
        instance.current = { widget, adapter, chart, refresh, importAnnotations, save, scheduleSave }
        if (!adapter.update(latest.current.rows, latest.current.cutoff)) chart.resetData()
        // Pause before native drawing/pan/order gestures, not after a drag ends.
        let replayHoverRow = null
        widget.subscribe('mouse_down', () => {
          latest.current.onOrderDragStart()
          if (!latest.current.selectingReplayBar) return
          // Crosshair updates from the same native pointer event may arrive
          // after mouse_down. Read that event before selecting a known candle.
          requestAnimationFrame(() => { if (!cancelled && latest.current.selectingReplayBar && replayHoverRow) latest.current.onReplayBarSelect?.(Number(replayHoverRow.timestamp)) })
        })
        widget.subscribe('onAutoSaveNeeded', scheduleSave)
        widget.subscribe('study_event', scheduleSave)
        widget.subscribe('drawing_event', (id, event) => {
          if (restoringImports) return
          if (importedShapes.includes(id)) { if (event === 'remove') setTimeout(importAnnotations, 0); return }
          if (['create', 'move', 'remove', 'hide', 'show', 'properties_changed', 'points_changed'].includes(event)) scheduleSave()
        })
        chart.crossHairMoved().subscribe(null, event => {
          const row = latest.current.rows.find(row => Number(row.timestamp) === Number(event.time))
          replayHoverRow = row || null
          latest.current.onCrosshair?.(row ? { row } : null)
        })
        headerSlots = { save, fitOrder, intervals: adapter.supported,
          setInterval: value => { if (!cancelled && adapter.supported.includes(value)) { latest.current.onOrderDragStart(); chart.setResolution(value) } },
          setType: value => { if (!cancelled) { latest.current.onOrderDragStart(); chart.setChartType(value) } },
          action: value => { if (!cancelled) { latest.current.onOrderDragStart(); chart.executeActionById(value) } },
          objects: () => cancelled ? [] : [...chart.getAllStudies().map(item => ({ ...item, kind:'study', visible:chart.getStudyById(item.id).isVisible() })), ...chart.getAllShapes().filter(item => !importedShapes.includes(item.id)).map(item => ({ ...item, kind:'shape', visible:chart.getShapeById(item.id).getProperties().visible !== false }))],
          objectAction: (item, action) => {
            if (cancelled) return
            latest.current.onOrderDragStart()
            if (action === 'remove') chart.removeEntity(item.id)
            else if (action === 'visibility') chart.setEntityVisibility(item.id, !item.visible)
            else if (chart.selection().canBeAddedToSelection(item.id)) chart.selection().set(item.id)
            if (action !== 'select') scheduleSave()
            else publishHeader()
          },
          capture: async (mode = 'download') => {
            latest.current.onOrderDragStart()
            const generation = latest.current.orderGeneration, cutoff = Number(latest.current.cutoff), resolution = chart.resolution()
            try {
              // Client-only export; native takeScreenshot() uploads to a server.
              const canvas = await widget.takeClientScreenshot()
              if (cancelled || generation !== latest.current.orderGeneration) { if (!cancelled) setMessage('Cutoff đã đổi; chụp lại chart tại mốc mới.'); return }
              const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
              if (cancelled || generation !== latest.current.orderGeneration || cutoff !== Number(latest.current.cutoff) || resolution !== chart.resolution()) { if (!cancelled) setMessage('Chart đã đổi; chụp lại tại mốc mới.'); return }
              if (!blob) throw new Error('Không tạo được ảnh PNG.')
              if (mode === 'copy') {
                if (!navigator.clipboard?.write || !window.ClipboardItem) throw new Error(t('Trình duyệt chưa hỗ trợ sao chép ảnh.'))
                await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
                if (!cancelled) setMessage('Đã sao chép ảnh chart.')
                return
              }
              const url = URL.createObjectURL(blob), link = document.createElement('a')
              link.href = url; link.download = `WMReplay-${symbol}-${resolution}-cutoff-${cutoff}.png`; link.click()
              setTimeout(() => URL.revokeObjectURL(url), 1000)
            } catch (error) { if (!cancelled) setMessage(`Không chụp được chart: ${error.message || error}`) }
          },
        }
        widget.headerReady().then(() => {
          if (cancelled) return
          // Official extension hosts; native controls and their menus remain library-owned.
          for (const [key, align] of [['market', 'left'], ['layout', 'left'], ['session', 'right'], ['search', 'right'], ['tools', 'right']]) {
            const slot = widget.createButton({ align, useTradingViewStyle: false })
            slot.className = `legacy-${key}-host`
            slot.parentElement.parentElement.classList.add(`legacy-${key}-group`)
            headerSlots[key] = slot
          }
          nativeHeader = headerSlots.market.ownerDocument.querySelector('.layout__area--top')
          nativeHeader.addEventListener('pointerdown', pauseNative, true)
          nativeHeader.addEventListener('keydown', pauseNative, true)
          nativeHeader.ownerDocument.addEventListener('keydown', saveShortcut, true)
          document.addEventListener('keydown', saveShortcut, true)
          headerObserver = new ResizeObserver(() => { resizeChrome(); publishHeader() })
          headerObserver.observe(host.current)
          headerObserver.observe(host.current.closest('.chart-canvas'))
          resizeChrome()
          publishHeader()
        })
        chart.onIntervalChanged().subscribe(null, value => { publishHeader(value); scheduleSave() })
        chart.onChartTypeChanged().subscribe(null, () => { publishHeader(); scheduleSave() })
        publishHeader()
        chart.dataReady(ready)
      })
      if (new URLSearchParams(window.location.search).get('chart_iframe') === 'srcdoc') {
        // v23 always navigates to blob:. Some embedded browsers cancel that
        // navigation; load the same generated document with its original hash.
        const frame = host.current?.querySelector('iframe')
        if (!frame || !frame.src.startsWith('blob:')) throw new Error('Advanced Charts v23 iframe source is unavailable.')
        const source = new URL(frame.src)
        fetch(source.href.split('#')[0]).then(response => {
          if (!response.ok) throw new Error('Advanced Charts iframe document could not be loaded.')
          return response.text()
        }).then(html => {
          if (cancelled || !frame.isConnected) return
          const hash = JSON.stringify(source.hash).replaceAll('<', '\\u003c')
          frame.srcdoc = html.replace(/<head[^>]*>/i, head => `${head}<script>location.hash=${hash};</script>`)
        }).catch(error => { if (!cancelled) { setStatus('error'); setMessage(String(error.message || error)) } })
      }
    }).catch(error => { if (!cancelled) { setStatus('error'); setMessage(String(error.message || error)) } })
    return () => {
      cancelled = true; layoutSave?.dispose(); clearTimeout(loadingTimer); headerObserver?.disconnect(); nativeHeader?.removeEventListener('pointerdown', pauseNative, true); nativeHeader?.removeEventListener('keydown', pauseNative, true); nativeHeader?.ownerDocument.removeEventListener('keydown', saveShortcut, true); document.removeEventListener('keydown', saveShortcut, true); instance.current = null
      latest.current.onHeaderSlots?.(null)
      adapter?.dispose(); widget?.remove()
    }
  }, [workspace, sessionId, datasetId, symbol, assetClass, seconds, tickSize, storageKey, locale])

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
      if (item === instance.current) {
        item.widget.applyOverrides(paneAppearance(theme))
        applyVolumeAppearance(item.widget, item.chart, theme)
        item.refresh(); item.importAnnotations()
        item.scheduleSave()
      }
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
  return <div className="replay-chart advanced-replay-chart" data-testid="replay-chart" data-chart-engine="advanced" data-chart-status={status} data-visible-row-count={rows.length} data-cutoff={cutoff} role="group" aria-label={t('Advanced Charts · {symbol} · {count} nến đến cutoff {cutoff} UTC', { symbol, count: rows.length, cutoff })}>
    <div ref={host} className="advanced-chart-host" />
    {status === 'loading' && <div className="advanced-chart-message" role="status">{t("Đang mở Advanced Charts…")}</div>}
    {status === 'error' && <div className="advanced-chart-message" role="alert">{t(message)} <a href={fallbackUrl.href}>{t("Mở chart dự phòng")}</a></div>}
    {status === 'ready' && message && <span className="advanced-chart-save-status" role="status">{t(message)}</span>}
  </div>
}
