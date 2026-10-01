import React, { useCallback, useEffect, useRef, useState } from 'react'
import './TradeWorkspace.css'

const DEFAULT_INSTRUMENT = {
  instrument_id: 'EURUSD',
  asset_class: 'fx',
  base_ccy: 'EUR',
  quote_ccy: 'USD',
  account_ccy: 'USD',
  tick_size: '0.0001',
  pip_size: '0.0001',
  contract_size: '100000',
  quantity_min: '0.01',
  quantity_step: '0.01',
  effective_from_utc: '2026-01-01T00:00:00Z',
  effective_to_utc: '',
}

const DEFAULT_COST_MODEL = {
  version: 'replay-fixture-cost-v1',
  spread_basis: 'bid_ask_embedded',
  commission_per_side_account: '1',
  minimum_fee_account: '0',
  slippage_price_per_side: '0',
  financing_account: '0',
  quote_to_account_rate: '1',
  account_ccy: 'USD',
  rounding_decimals: 2,
}

const MAX_GET_RETRIES = 3

function numberOr(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function optionalNumber(value) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function formatMoney(value, currency = 'USD') {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return 'N/A'
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(value))
}

function formatPrice(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return 'N/A'
  return new Intl.NumberFormat('vi-VN', { minimumFractionDigits: 4, maximumFractionDigits: 8 }).format(Number(value))
}

async function readJson(response) {
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(String(payload?.detail || `HTTP ${response.status}`))
    error.status = response.status
    throw error
  }
  return payload
}

function initialDraft(replay) {
  const execution = replay?.payload?.execution
  const instrument = execution?.instrument_spec || null
  const rows = replay?.visible_rows || []
  const current = rows[rows.length - 1]
  const price = optionalNumber(current?.close)
  const pip = optionalNumber(instrument?.pip_size)
  const hasPrice = Number.isFinite(price)
  const hasPip = Number.isFinite(pip) && pip > 0
  return {
    side: 'BUY',
    quantity: instrument?.quantity_min === null || instrument?.quantity_min === undefined ? '' : String(instrument.quantity_min),
    stopLoss: hasPrice && hasPip ? (price - pip * 20).toFixed(5) : '',
    takeProfit: hasPrice && hasPip ? (price + pip * 40).toFixed(5) : '',
  }
}

function validateDraft(draft, entry) {
  const quantity = optionalNumber(draft.quantity)
  const stopLoss = optionalNumber(draft.stopLoss)
  const takeProfit = optionalNumber(draft.takeProfit)
  if (![quantity, stopLoss, takeProfit].every(Number.isFinite) || quantity <= 0 || stopLoss <= 0 || takeProfit <= 0) {
    return 'Khối lượng, SL và TP phải là số dương.'
  }
  if (draft.side === 'BUY' && !(stopLoss < entry && takeProfit > entry)) {
    return 'Lệnh BUY cần SL dưới giá tham chiếu và TP trên giá tham chiếu.'
  }
  if (draft.side === 'SELL' && !(stopLoss > entry && takeProfit < entry)) {
    return 'Lệnh SELL cần SL trên giá tham chiếu và TP dưới giá tham chiếu.'
  }
  return ''
}

function RiskPreview({ draft, entry, instrument, costModel }) {
  const quantity = optionalNumber(draft.quantity)
  const stop = optionalNumber(draft.stopLoss)
  const target = optionalNumber(draft.takeProfit)
  const contract = optionalNumber(instrument?.contract_size)
  const rate = optionalNumber(costModel?.quote_to_account_rate)
  const commission = optionalNumber(costModel?.commission_per_side_account)
  const minimumFee = optionalNumber(costModel?.minimum_fee_account)
  const complete = [entry, quantity, stop, target, contract, rate, commission, minimumFee].every(Number.isFinite)
  const risk = complete ? Math.abs(entry - stop) * quantity * contract * rate : null
  const reward = complete ? Math.abs(target - entry) * quantity * contract * rate : null
  const fees = complete ? (commission * 2) + minimumFee : null
  const netRisk = risk !== null && fees !== null ? risk + fees : null
  const netReward = reward !== null && fees !== null ? reward - fees : null
  const rMultiple = risk > 0 && reward !== null ? reward / risk : NaN
  return (
    <div className="trade-risk-preview" data-testid="trade-risk-preview">
      <div><span>Risk tới SL</span><strong>{formatMoney(netRisk, costModel?.account_ccy || 'USD')}</strong><small>gross {formatMoney(risk, costModel?.account_ccy || 'USD')} + phí {formatMoney(fees, costModel?.account_ccy || 'USD')}</small></div>
      <div><span>Reward tới TP</span><strong>{formatMoney(netReward, costModel?.account_ccy || 'USD')}</strong><small>ước tính theo giá tham chiếu</small></div>
      <div><span>Planned R</span><strong>{Number.isFinite(rMultiple) ? `${rMultiple.toFixed(2)}R` : 'N/A'}</strong><small>chưa phải kết quả thực tế</small></div>
    </div>
  )
}

function SimulatorBanner() {
  return (
    <div className="trade-simulator-banner" role="status" data-testid="trade-simulator-banner">
      <span className="trade-lock-mark">SIM</span>
      <div><strong>SIMULATOR / PAPER ONLY</strong><span>Queue order chỉ ghi vào replay ledger local. Broker/live execution đang khóa.</span></div>
    </div>
  )
}

export default function TradeWorkspace({ workspace, query, replay: controlledReplay = null, onReplayChange }) {
  const sessionId = query?.get('session') || ''
  const [state, setState] = useState({ status: controlledReplay ? 'ready' : sessionId ? 'loading' : 'idle', replay: controlledReplay, error: null })
  const [datasetState, setDatasetState] = useState({ status: 'loading', items: [], error: null })
  const replayRequestRef = useRef(0)
  const replayAbortRef = useRef(null)
  const datasetRequestRef = useRef(0)
  const datasetAbortRef = useRef(null)
  const [replayRetryToken, setReplayRetryToken] = useState(0)
  const [replayRetryCount, setReplayRetryCount] = useState(0)
  const [datasetRetryToken, setDatasetRetryToken] = useState(0)
  const [datasetRetryCount, setDatasetRetryCount] = useState(0)
  const [draft, setDraft] = useState(() => initialDraft(controlledReplay))
  const [startingBalance, setStartingBalance] = useState('10000')
  const [spread, setSpread] = useState('0.0002')
  const [pending, setPending] = useState('')
  const [notice, setNotice] = useState(null)

  const replay = controlledReplay || state.replay
  const payload = replay?.payload
  const execution = payload?.execution
  const rows = replay?.visible_rows || []
  const currentBar = rows[rows.length - 1]
  const entryReference = numberOr(currentBar?.close, NaN)
  const datasetId = payload?.dataset_id || ''
  const manifest = datasetState.items.find((item) => item.dataset_id === datasetId)
  const catalogManifest = datasetState.status === 'ready' ? manifest : null
  const instrument = execution?.instrument_spec || catalogManifest?.instrument_spec || null
  const costModel = execution?.cost_model || (catalogManifest ? DEFAULT_COST_MODEL : null)
  const revision = numberOr(replay?.revision, 0)
  const hasSession = Boolean(sessionId || replay?.record_id)

  const fetchReplay = useCallback(async () => {
    const id = sessionId
    if (!id || controlledReplay) return
    const requestId = replayRequestRef.current + 1
    replayRequestRef.current = requestId
    replayAbortRef.current?.abort()
    const controller = new AbortController()
    replayAbortRef.current = controller
    setState((current) => ({ ...current, status: 'loading', error: null }))
    try {
      const response = await fetch(`/api/v2/replay/sessions/${encodeURIComponent(id)}`, { headers: { 'X-Workspace-Id': workspace }, signal: controller.signal })
      const next = await readJson(response)
      if (requestId !== replayRequestRef.current) return
      setState({ status: 'ready', replay: next, error: null })
      setReplayRetryCount(0)
      // The draft is not visible until the replay has loaded. Resetting it to
      // the loaded cutoff avoids carrying an incomplete pre-hydration draft
      // into the real session.
      setDraft(initialDraft(next))
    } catch (error) {
      if (error?.name === 'AbortError' || requestId !== replayRequestRef.current) return
      setState({ status: 'error', replay: null, error: error.message })
    }
  }, [controlledReplay, sessionId, workspace])

  useEffect(() => {
    setReplayRetryCount(0)
  }, [controlledReplay, sessionId, workspace])

  useEffect(() => {
    if (!controlledReplay && sessionId) fetchReplay()
    return () => {
      replayAbortRef.current?.abort()
      replayRequestRef.current += 1
    }
  }, [controlledReplay, fetchReplay, replayRetryToken, sessionId])

  const fetchDatasets = useCallback(async () => {
    const requestId = datasetRequestRef.current + 1
    datasetRequestRef.current = requestId
    datasetAbortRef.current?.abort()
    const controller = new AbortController()
    datasetAbortRef.current = controller
    setDatasetState((current) => ({ ...current, status: 'loading', error: null }))
    try {
      const response = await fetch('/api/v2/data/datasets', { headers: { 'X-Workspace-Id': workspace }, signal: controller.signal })
      const value = await readJson(response)
      if (requestId !== datasetRequestRef.current) return
      setDatasetState({ status: 'ready', items: Array.isArray(value.items) ? value.items : [], error: null })
      setDatasetRetryCount(0)
    } catch (error) {
      if (error?.name === 'AbortError' || requestId !== datasetRequestRef.current) return
      setDatasetState((current) => ({ ...current, status: 'error', error: error.message }))
    }
  }, [workspace])

  useEffect(() => {
    setDatasetRetryCount(0)
  }, [workspace])

  useEffect(() => {
    fetchDatasets()
    return () => {
      datasetAbortRef.current?.abort()
      datasetRequestRef.current += 1
    }
  }, [datasetRetryToken, fetchDatasets])

  const retryReplay = useCallback(() => {
    if (replayRetryCount >= MAX_GET_RETRIES || state.status === 'loading') return
    setReplayRetryCount((current) => current + 1)
    setReplayRetryToken((current) => current + 1)
  }, [replayRetryCount, state.status])

  const retryDatasets = useCallback(() => {
    if (datasetRetryCount >= MAX_GET_RETRIES || datasetState.status === 'loading') return
    setDatasetRetryCount((current) => current + 1)
    setDatasetRetryToken((current) => current + 1)
  }, [datasetRetryCount, datasetState.status])

  useEffect(() => {
    if (replay) setDraft(initialDraft(replay))
  }, [replay?.record_id])

  const applyReplay = useCallback((next) => {
    if (onReplayChange) onReplayChange(next)
    else setState({ status: 'ready', replay: next, error: null })
  }, [onReplayChange])

  const initialize = useCallback(async (event) => {
    event.preventDefault()
    if (!replay?.record_id || !datasetId || datasetState.status !== 'ready' || !catalogManifest || !instrument || !costModel) {
      setNotice({ kind: 'error', text: 'Chưa xác định được dataset context và execution assumptions; chưa thể khởi tạo simulator.' })
      return
    }
    const spreadValue = optionalNumber(spread)
    const startingBalanceValue = optionalNumber(startingBalance)
    if (![spreadValue, startingBalanceValue].every(Number.isFinite) || startingBalanceValue <= 0 || spreadValue < 0) {
      setNotice({ kind: 'error', text: 'Spread và starting balance phải được nhập đầy đủ; giá trị rỗng không được đổi thành 0.' })
      return
    }
    setPending('initialize')
    setNotice(null)
    try {
      const response = await fetch(`/api/v2/replay/sessions/${encodeURIComponent(replay.record_id)}/execution`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Workspace-Id': workspace },
        body: JSON.stringify({
          expected_revision: revision,
          instrument_spec: instrument,
          cost_model: costModel,
          spread_price: String(spreadValue),
          timeframe_seconds: Number(catalogManifest.timeframe_seconds || 3600),
          starting_balance: String(startingBalanceValue),
        }),
      })
      const next = await readJson(response)
      applyReplay(next)
      setDraft(initialDraft(next))
      setNotice({ kind: 'ok', text: 'Đã khởi tạo execution state local cho replay.' })
    } catch (error) {
      setNotice({ kind: 'error', text: `Không khởi tạo được: ${error.message}` })
    } finally { setPending('') }
  }, [applyReplay, catalogManifest, costModel, datasetId, datasetState.status, instrument, replay?.record_id, revision, spread, startingBalance, workspace])

  const queueOrder = useCallback(async (event) => {
    event.preventDefault()
    if (!replay?.record_id || !Number.isFinite(entryReference)) return
    const validation = validateDraft(draft, entryReference)
    if (validation) { setNotice({ kind: 'error', text: validation }); return }
    setPending('queue')
    setNotice(null)
    const operationId = `draft-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    try {
      const response = await fetch(`/api/v2/replay/sessions/${encodeURIComponent(replay.record_id)}/orders/market`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Workspace-Id': workspace },
        body: JSON.stringify({
          expected_revision: revision,
          operation_id: operationId,
          side: draft.side,
          quantity: String(draft.quantity),
          stop_loss: String(draft.stopLoss),
          take_profit: String(draft.takeProfit),
        }),
      })
      applyReplay(await readJson(response))
      setNotice({ kind: 'ok', text: 'Trade draft đã được queue vào replay simulator. Chưa có broker action.' })
    } catch (error) {
      setNotice({ kind: 'error', text: `Không queue được draft: ${error.message}` })
    } finally { setPending('') }
  }, [applyReplay, draft, entryReference, replay?.record_id, revision, workspace])

  const stateLabel = state.status === 'loading' ? 'Đang tải session' : state.status === 'error' ? 'Có lỗi' : !hasSession ? 'Chưa chọn session' : execution ? 'Execution sẵn sàng' : datasetState.status === 'loading' ? 'Đang tải context' : datasetState.status === 'error' ? 'Context unavailable' : datasetId && !catalogManifest ? 'Dataset chưa xác nhận' : 'Chưa khởi tạo execution'
  const catalogContextLabel = datasetState.status === 'loading' ? 'Đang tải…' : datasetState.status === 'error' ? 'Unavailable' : datasetId && !catalogManifest ? 'Chưa xác nhận' : catalogManifest ? 'Verified' : 'Không cần'
  const canInitialize = Boolean(replay?.record_id && datasetId && datasetState.status === 'ready' && catalogManifest && instrument && costModel)
  const replayRetryExhausted = replayRetryCount >= MAX_GET_RETRIES
  const datasetRetryExhausted = datasetRetryCount >= MAX_GET_RETRIES
  const account = execution ? { balance: execution.balance, equity: execution.equity, floating: execution.floating_pl } : null

  return (
    <main className="trade-workspace" data-testid="trade-workspace">
      <div className="trade-heading">
        <div><span className="trade-eyebrow">TRADE DESK / REPLAY CONTEXT</span><h1>Trade draft</h1><p>Tạo lệnh giả lập từ đúng decision cutoff hiện tại, kiểm tra risk trước khi queue.</p></div>
        <div className="trade-heading-state"><span>Session</span><strong>{stateLabel}</strong><small>{payload?.dataset_id || 'Chưa có dataset'}</small></div>
      </div>
      <SimulatorBanner />
      {state.status === 'loading' && <div className="trade-message">Đang tải replay session…</div>}
      {state.status === 'error' && <div className="trade-message is-error" role="alert">Không đọc được replay: {state.error}<button className="trade-inline-retry" data-testid="trade-replay-retry" type="button" onClick={retryReplay} disabled={replayRetryExhausted} aria-describedby={replayRetryExhausted ? 'trade-replay-retry-note' : undefined}>{replayRetryExhausted ? 'Đã hết lượt thử' : 'Thử lại'}</button>{replayRetryExhausted && <small id="trade-replay-retry-note">Đã thử lại {MAX_GET_RETRIES} lần. Kiểm tra backend trước khi tiếp tục.</small>}</div>}
      {datasetState.status === 'error' && <div className="trade-message is-error" role="alert">Không đọc được catalog dataset: {datasetState.error}<button className="trade-inline-retry" data-testid="trade-dataset-retry" type="button" onClick={retryDatasets} disabled={datasetRetryExhausted} aria-describedby={datasetRetryExhausted ? 'trade-dataset-retry-note' : undefined}>{datasetRetryExhausted ? 'Đã hết lượt thử' : 'Thử lại'}</button>{datasetRetryExhausted && <small id="trade-dataset-retry-note">Đã thử lại {MAX_GET_RETRIES} lần. Kiểm tra backend trước khi tiếp tục.</small>}</div>}
      {!hasSession && state.status !== 'loading' && <div className="trade-empty"><strong>Mở Practice trước</strong><span>Trade draft cần session, dataset và decision cutoff. Hãy mở một replay session rồi quay lại Trade desk.</span><a className="trade-link" href={`/?workspace=${encodeURIComponent(workspace)}&view=replay`}>Mở Practice →</a></div>}
      {replay && (
        <>
          <div className="trade-context-strip"><span><b>Instrument</b>{instrument?.instrument_id || 'Chưa xác định'}</span><span><b>Dataset catalog</b>{catalogContextLabel}</span><span><b>Cutoff</b>{replay.cutoff_timestamp ? new Date(Number(replay.cutoff_timestamp) * 1000).toISOString().replace('T', ' ').slice(0, 16) : 'N/A'} UTC</span><span><b>Revision</b>r{revision}</span><span><b>Giá tham chiếu</b>{formatPrice(entryReference)}</span></div>
          {!execution && (
            <section className="trade-init-section" aria-labelledby="trade-init-title">
              <div><span className="trade-eyebrow">STEP 01</span><h2 id="trade-init-title">Khởi tạo simulator state</h2><p>Execution state được gắn vào session và giữ cùng provenance. Chi phí dưới đây là fixture/model, chưa phải báo giá broker.</p></div>
              {canInitialize ? <form className="trade-init-form" onSubmit={initialize}>
                <label>Starting balance<input type="number" min="1" step="0.01" value={startingBalance} onChange={(event) => setStartingBalance(event.target.value)} /></label>
                <label>Spread (price)<input type="number" min="0" step="0.00001" value={spread} onChange={(event) => setSpread(event.target.value)} /></label>
                <button className="trade-primary" type="submit" disabled={Boolean(pending)}>{pending === 'initialize' ? 'Đang khởi tạo…' : 'Khởi tạo local simulator'}</button>
              </form> : <div className="trade-message" role="status" data-testid="trade-context-unknown">{datasetState.status === 'loading' ? 'Đang chờ dataset context trước khi mở simulator…' : datasetState.status === 'error' ? 'Dataset context đang unavailable; hãy thử lại trước khi mở simulator.' : 'Dataset chưa có manifest/instrument assumptions đủ để mở simulator.'}</div>}
            </section>
          )}
          {execution && (
            <section className="trade-grid">
              <div className="trade-main-column">
                <section className="trade-account-strip" aria-label="Tài khoản mô phỏng">
                  <div><span>Balance</span><strong>{formatMoney(account.balance, costModel?.account_ccy)}</strong></div><div><span>Equity</span><strong>{formatMoney(account.equity, costModel?.account_ccy)}</strong></div><div><span>Floating P/L</span><strong>{formatMoney(account.floating, costModel?.account_ccy)}</strong></div><div><span>Position</span><strong>{execution.position ? `${execution.position.side} ${execution.position.quantity}` : execution.pending_market_order ? 'Pending' : 'Flat'}</strong></div>
                </section>
                <section className="trade-draft-section" aria-labelledby="trade-draft-title">
                  <div className="trade-section-title"><div><span className="trade-eyebrow">STEP 02</span><h2 id="trade-draft-title">Draft tại chart cutoff</h2></div><span className="trade-cutoff-label">future fill: nến kế tiếp</span></div>
                  {execution.position || execution.pending_market_order ? (
                    <div className="trade-active-state"><strong>{execution.position ? 'Đang có vị thế trong simulator' : 'Đã có market order đang chờ fill'}</strong><span>{execution.position ? `${execution.position.side} ${execution.position.quantity} · SL ${formatPrice(execution.position.stop_loss)} · TP ${formatPrice(execution.position.take_profit)}` : `${execution.pending_market_order.side} ${execution.pending_market_order.quantity} · sẽ fill ở bar kế tiếp`}</span></div>
                  ) : (
                    <form className="trade-draft-form" onSubmit={queueOrder}>
                      <div className="trade-side-toggle" role="group" aria-label="Hướng lệnh"><button className={draft.side === 'BUY' ? 'is-buy' : ''} type="button" aria-pressed={draft.side === 'BUY'} onClick={() => setDraft((current) => ({ ...current, side: 'BUY' }))}>BUY</button><button className={draft.side === 'SELL' ? 'is-sell' : ''} type="button" aria-pressed={draft.side === 'SELL'} onClick={() => setDraft((current) => ({ ...current, side: 'SELL' }))}>SELL</button></div>
                      <label>Quantity<input type="number" min={instrument?.quantity_min || undefined} step={instrument?.quantity_step || undefined} value={draft.quantity} onChange={(event) => setDraft((current) => ({ ...current, quantity: event.target.value }))} /></label>
                      <label>Stop loss<input type="number" min="0" step={instrument?.tick_size || undefined} value={draft.stopLoss} onChange={(event) => setDraft((current) => ({ ...current, stopLoss: event.target.value }))} /></label>
                      <label>Take profit<input type="number" min="0" step={instrument?.tick_size || undefined} value={draft.takeProfit} onChange={(event) => setDraft((current) => ({ ...current, takeProfit: event.target.value }))} /></label>
                      <RiskPreview draft={draft} entry={entryReference} instrument={instrument} costModel={costModel} />
                      <div className="trade-form-actions"><button className="trade-primary" type="submit" disabled={Boolean(pending) || !Number.isFinite(entryReference)}>{pending === 'queue' ? 'Đang queue…' : 'Queue vào simulator'}</button><span>Không gửi broker · operation sẽ gắn vào ledger local</span></div>
                    </form>
                  )}
                </section>
              </div>
              <aside className="trade-side-column"><section className="trade-context-panel"><div className="trade-section-title"><div><span className="trade-eyebrow">MODEL</span><h2>Execution assumptions</h2></div></div><dl><div><dt>Fill basis</dt><dd>Market · next bar open</dd></div><div><dt>Spread</dt><dd>{execution.spread_price ?? 'N/A'}</dd></div><div><dt>Commission</dt><dd>{costModel?.commission_per_side_account ?? 'N/A'} / side</dd></div><div><dt>Contract</dt><dd>{instrument?.contract_size ?? 'N/A'}</dd></div><div><dt>Data suffix</dt><dd>{String(replay.dataset_sha256 || '').slice(0, 12) || 'N/A'}</dd></div></dl></section><section className="trade-safety-note"><strong>Live execution bị khóa</strong><span>Trade draft và queue chỉ thay đổi replay state. Không có route gửi lệnh broker trong màn hình này.</span></section>{notice && <div className={`trade-notice is-${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.text}</div>}</aside>
            </section>
          )}
        </>
      )}
    </main>
  )
}

export { DEFAULT_COST_MODEL, DEFAULT_INSTRUMENT, RiskPreview, validateDraft }
