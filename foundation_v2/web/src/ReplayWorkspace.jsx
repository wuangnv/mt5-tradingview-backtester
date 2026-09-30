import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CandlestickSeries, createChart } from 'lightweight-charts'
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

function ReplayChart({ rows, onCrosshair, onAnchorSelect }) {
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
    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#63b982',
      downColor: '#df7676',
      borderVisible: false,
      wickUpColor: '#63b982',
      wickDownColor: '#df7676',
    })

    // The chart accepts only the API-visible prefix. Dataset suffix rows never reach this component.
    series.setData(rows.map((row) => ({
      time: Number(row.timestamp),
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
    })))
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
  }, [onAnchorSelect, onCrosshair, rows])

  return (
    <div
      ref={hostRef}
      className="replay-chart"
      data-testid="replay-chart"
      data-visible-row-count={rows.length}
      aria-label={`Biểu đồ replay với ${rows.length} nến đã được mở; bấm vào nến để tạo annotation draft local`}
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
                <ReplayChart rows={visibleRows} onCrosshair={setCrosshair} onAnchorSelect={handleChartAnchor} />
                <div className="chart-badge chart-badge-left">{replay.payload.dataset_id}</div>
                <div className="chart-badge chart-badge-right">{replay.historical_view ? 'HISTORICAL CUTOFF' : 'LIVE REPLAY CURSOR'}</div>
              </div>

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
