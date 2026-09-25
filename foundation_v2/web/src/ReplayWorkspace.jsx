import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CandlestickSeries, createChart } from 'lightweight-charts'

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

function ReplayChart({ rows }) {
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
    chart.timeScale().fitContent()

    const observer = new ResizeObserver(() => {
      chart.applyOptions({ width: host.clientWidth, height: host.clientHeight })
    })
    observer.observe(host)
    return () => {
      observer.disconnect()
      chart.remove()
    }
  }, [rows])

  return (
    <div
      ref={hostRef}
      className="replay-chart"
      data-testid="replay-chart"
      data-visible-row-count={rows.length}
      aria-label={`Biểu đồ replay với ${rows.length} nến đã được mở`}
    />
  )
}

function replaceSessionInUrl(sessionId) {
  const url = new URL(window.location.href)
  url.searchParams.set('view', 'replay')
  url.searchParams.set('session', sessionId)
  url.searchParams.delete('dataset')
  window.history.replaceState(null, '', url)
}

export default function ReplayWorkspace({ workspace, query }) {
  const storageKey = `tw:replay:last:${workspace}`
  const requestedSession = query.get('session') || ''
  const requestedDataset = query.get('dataset') || ''
  const requestedStart = Number(query.get('start') || 0)
  const [sessionId, setSessionId] = useState(requestedSession)
  const [state, setState] = useState({ status: 'idle', payload: null, error: null })
  const [pendingAction, setPendingAction] = useState('')
  const [conflict, setConflict] = useState(false)
  const [branchCursor, setBranchCursor] = useState(0)
  const [datasetDraft, setDatasetDraft] = useState(requestedDataset)
  const [startDraft, setStartDraft] = useState(Number.isFinite(requestedStart) ? Math.max(0, requestedStart) : 0)

  const rememberSession = useCallback((nextSessionId) => {
    setSessionId(nextSessionId)
    window.localStorage.setItem(storageKey, nextSessionId)
    replaceSessionInUrl(nextSessionId)
  }, [storageKey])

  const loadSession = useCallback(async (targetSessionId) => {
    if (!targetSessionId) return
    setState((current) => ({ status: 'loading', payload: current.payload, error: null }))
    setConflict(false)
    try {
      const response = await fetch(`/api/v2/replay/sessions/${encodeURIComponent(targetSessionId)}`, {
        headers: { 'X-Workspace-Id': workspace },
      })
      const payload = await readJson(response)
      rememberSession(payload.record_id)
      setBranchCursor(Math.max(0, Number(payload.payload.cursor_index) - 1))
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
      rememberSession(payload.record_id)
      setBranchCursor(Math.max(0, Number(payload.payload.cursor_index) - 1))
      setState({ status: 'ready', payload, error: null })
    } catch (error) {
      setState({ status: 'error', payload: null, error: String(error.message || error) })
    } finally {
      setPendingAction('')
    }
  }, [datasetDraft, rememberSession, startDraft, workspace])

  useEffect(() => {
    if (requestedSession) {
      loadSession(requestedSession)
      return
    }
    const persisted = window.localStorage.getItem(storageKey)
    if (persisted) {
      loadSession(persisted)
      return
    }
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
      if (kind === 'branch') rememberSession(payload.record_id)
      setBranchCursor(Math.max(0, Number(payload.payload.cursor_index) - 1))
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
  const cursor = Number(replay?.payload?.cursor_index ?? 0)
  const revision = Number(replay?.revision ?? 0)
  const visibleRows = replay?.visible_rows || []
  const currentBar = visibleRows.length ? visibleRows[visibleRows.length - 1] : null
  const completed = replay?.payload?.status === 'completed' || replay?.has_future_rows === false
  const lineage = replay?.payload?.parent_session_id
  const canBranch = Boolean(replay) && cursor > 0 && branchCursor < cursor && !conflict
  const learnHref = useMemo(() => {
    const params = new URLSearchParams({ view: 'learn', workspace, from: 'replay' })
    if (sessionId) {
      params.set('session', sessionId)
    } else if (datasetDraft.trim()) {
      params.set('dataset', datasetDraft.trim())
      params.set('start', String(startDraft))
    }
    return `/?${params.toString()}`
  }, [datasetDraft, sessionId, startDraft, workspace])

  const statusLabel = useMemo(() => {
    if (conflict) return 'Xung đột phiên'
    if (completed) return 'Hoàn tất dataset'
    if (state.status === 'loading') return 'Đang tải'
    if (state.status === 'error') return 'Có lỗi'
    return 'Tạm dừng'
  }, [completed, conflict, state.status])

  return (
    <main className="replay-shell">
      <header className="replay-topbar">
        <div>
          <div className="eyebrow">THỰC HÀNH / REPLAY VIEWER V1</div>
          <h1>Replay thị trường</h1>
          <p>Chỉ hiển thị phần dữ liệu đã mở tới decision cutoff hiện tại.</p>
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
        <section className="replay-start" aria-label="Mở replay">
          <div>
            <h2>Mở một replay session</h2>
            <p>Nhập dataset đã có trong Workspace. Session được lưu để tải lại tiếp tục đúng vị trí.</p>
          </div>
          <label>
            Dataset ID
            <input
              value={datasetDraft}
              onChange={(event) => setDatasetDraft(event.target.value)}
              placeholder="dataset-id"
              data-testid="dataset-id"
            />
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
          <button className="primary-action" type="button" onClick={createSession} disabled={pendingAction === 'create'}>
            {pendingAction === 'create' ? 'Đang tạo…' : 'Bắt đầu replay'}
          </button>
        </section>
      )}

      {state.status === 'loading' && <div className="replay-message">Đang tải trạng thái replay…</div>}
      {state.status === 'error' && <div className="replay-message replay-error">Không đọc được replay: {state.error}</div>}

      {replay && (
        <>
          <section className="replay-status" aria-label="Trạng thái replay">
            <div><span>Workspace</span><strong>{workspace}</strong></div>
            <div><span>Dataset</span><code>{replay.payload.dataset_id}</code></div>
            <div><span>Revision</span><strong>r{revision}</strong></div>
            <div><span>Đã mở</span><strong>{replay.visible_row_count} nến</strong></div>
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

          <section className="replay-workspace">
            <div className="replay-main">
              <div className="replay-toolbar" aria-label="Điều khiển replay">
                <div className="toolbar-group">
                  <button
                    type="button"
                    data-testid="step-1"
                    onClick={() => mutate('step', { expected_revision: revision, steps: 1 })}
                    disabled={completed || conflict || Boolean(pendingAction)}
                  >
                    +1 nến
                  </button>
                  <button
                    type="button"
                    data-testid="step-10"
                    onClick={() => mutate('step', { expected_revision: revision, steps: 10 })}
                    disabled={completed || conflict || Boolean(pendingAction)}
                  >
                    +10 nến
                  </button>
                </div>
                <div className="cutoff-readout">
                  <span>Decision cutoff</span>
                  <strong>{formatTimestamp(replay.cutoff_timestamp)} UTC</strong>
                </div>
              </div>

              <ReplayChart rows={visibleRows} />

              <div className="bar-readout" aria-label="OHLC nến hiện tại">
                <span>Nến #{cursor}</span>
                <span>O <strong>{formatPrice(currentBar?.open)}</strong></span>
                <span>H <strong>{formatPrice(currentBar?.high)}</strong></span>
                <span>L <strong>{formatPrice(currentBar?.low)}</strong></span>
                <span>C <strong>{formatPrice(currentBar?.close)}</strong></span>
              </div>
            </div>

            <aside className="replay-side">
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
                  max={Math.max(0, cursor - 1)}
                  value={Math.min(branchCursor, Math.max(0, cursor - 1))}
                  onChange={(event) => setBranchCursor(Number(event.target.value))}
                  disabled={cursor <= 0 || conflict || Boolean(pendingAction)}
                  aria-label="Nến bắt đầu branch"
                />
                <button
                  className="secondary-action"
                  type="button"
                  data-testid="branch-replay"
                  disabled={!canBranch || Boolean(pendingAction)}
                  onClick={() => mutate('branch', { expected_revision: revision, cursor_index: branchCursor })}
                >
                  Tạo branch từ nến #{branchCursor}
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
