import React, { useCallback, useEffect, useMemo, useState } from 'react'
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

function numberOr(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
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
  const instrument = execution?.instrument_spec || DEFAULT_INSTRUMENT
  const rows = replay?.visible_rows || []
  const current = rows[rows.length - 1]
  const price = numberOr(current?.close, 1.1)
  const pip = numberOr(instrument.pip_size, 0.0001)
  return {
    side: 'BUY',
    quantity: String(instrument.quantity_min || '0.01'),
    stopLoss: (price - pip * 20).toFixed(5),
    takeProfit: (price + pip * 40).toFixed(5),
  }
}

function validateDraft(draft, entry) {
  const quantity = numberOr(draft.quantity, NaN)
  const stopLoss = numberOr(draft.stopLoss, NaN)
  const takeProfit = numberOr(draft.takeProfit, NaN)
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
  const quantity = numberOr(draft.quantity)
  const stop = numberOr(draft.stopLoss)
  const target = numberOr(draft.takeProfit)
  const contract = numberOr(instrument?.contract_size)
  const rate = numberOr(costModel?.quote_to_account_rate, 1)
  const risk = Math.abs(entry - stop) * quantity * contract * rate
  const reward = Math.abs(target - entry) * quantity * contract * rate
  const fees = (numberOr(costModel?.commission_per_side_account) * 2) + numberOr(costModel?.minimum_fee_account)
  const netRisk = risk + fees
  const rMultiple = risk > 0 ? reward / risk : NaN
  return (
    <div className="trade-risk-preview" data-testid="trade-risk-preview">
      <div><span>Risk tới SL</span><strong>{formatMoney(netRisk, costModel?.account_ccy || 'USD')}</strong><small>gross {formatMoney(risk, costModel?.account_ccy || 'USD')} + phí {formatMoney(fees, costModel?.account_ccy || 'USD')}</small></div>
      <div><span>Reward tới TP</span><strong>{formatMoney(reward - fees, costModel?.account_ccy || 'USD')}</strong><small>ước tính theo giá tham chiếu</small></div>
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
  const [datasets, setDatasets] = useState([])
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
  const manifest = datasets.find((item) => item.dataset_id === datasetId)
  const instrument = execution?.instrument_spec || manifest?.instrument_spec || DEFAULT_INSTRUMENT
  const costModel = execution?.cost_model || DEFAULT_COST_MODEL
  const revision = numberOr(replay?.revision, 0)
  const hasSession = Boolean(sessionId || replay?.record_id)

  const fetchReplay = useCallback(async () => {
    const id = sessionId || replay?.record_id
    if (!id || controlledReplay) return
    setState((current) => ({ ...current, status: 'loading', error: null }))
    try {
      const response = await fetch(`/api/v2/replay/sessions/${encodeURIComponent(id)}`, { headers: { 'X-Workspace-Id': workspace } })
      const next = await readJson(response)
      setState({ status: 'ready', replay: next, error: null })
      setDraft((current) => ({ ...initialDraft(next), ...current }))
    } catch (error) {
      setState({ status: 'error', replay: null, error: error.message })
    }
  }, [controlledReplay, replay?.record_id, sessionId, workspace])

  useEffect(() => {
    if (!controlledReplay && sessionId) fetchReplay()
  }, [controlledReplay, fetchReplay, sessionId])

  useEffect(() => {
    let cancelled = false
    fetch('/api/v2/data/datasets', { headers: { 'X-Workspace-Id': workspace } })
      .then(readJson)
      .then((value) => { if (!cancelled) setDatasets(value.items || []) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [workspace])

  useEffect(() => {
    if (replay) setDraft((current) => ({ ...initialDraft(replay), ...current }))
  }, [replay?.record_id])

  const applyReplay = useCallback((next) => {
    if (onReplayChange) onReplayChange(next)
    else setState({ status: 'ready', replay: next, error: null })
  }, [onReplayChange])

  const initialize = useCallback(async (event) => {
    event.preventDefault()
    if (!replay?.record_id || !instrument) return
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
          spread_price: String(numberOr(spread)),
          timeframe_seconds: Number(manifest?.timeframe_seconds || 3600),
          starting_balance: String(numberOr(startingBalance, 10000)),
        }),
      })
      applyReplay(await readJson(response))
      setNotice({ kind: 'ok', text: 'Đã khởi tạo execution state local cho replay.' })
    } catch (error) {
      setNotice({ kind: 'error', text: `Không khởi tạo được: ${error.message}` })
    } finally { setPending('') }
  }, [applyReplay, costModel, instrument, manifest?.timeframe_seconds, replay?.record_id, revision, spread, startingBalance, workspace])

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

  const stateLabel = state.status === 'loading' ? 'Đang tải session' : state.status === 'error' ? 'Có lỗi' : !hasSession ? 'Chưa chọn session' : execution ? 'Execution sẵn sàng' : 'Chưa khởi tạo execution'
  const account = execution ? { balance: execution.balance, equity: execution.equity, floating: execution.floating_pl } : null

  return (
    <main className="trade-workspace" data-testid="trade-workspace">
      <div className="trade-heading">
        <div><span className="trade-eyebrow">TRADE DESK / REPLAY CONTEXT</span><h1>Trade draft</h1><p>Tạo lệnh giả lập từ đúng decision cutoff hiện tại, kiểm tra risk trước khi queue.</p></div>
        <div className="trade-heading-state"><span>Session</span><strong>{stateLabel}</strong><small>{payload?.dataset_id || 'Chưa có dataset'}</small></div>
      </div>
      <SimulatorBanner />
      {state.status === 'loading' && <div className="trade-message">Đang tải replay session…</div>}
      {state.status === 'error' && <div className="trade-message is-error">Không đọc được replay: {state.error}</div>}
      {!hasSession && state.status !== 'loading' && <div className="trade-empty"><strong>Mở Practice trước</strong><span>Trade draft cần session, dataset và decision cutoff. Hãy mở một replay session rồi quay lại Trade desk.</span><a className="trade-link" href={`/?workspace=${encodeURIComponent(workspace)}&view=replay`}>Mở Practice →</a></div>}
      {replay && (
        <>
          <div className="trade-context-strip"><span><b>Instrument</b>{instrument.instrument_id || 'N/A'}</span><span><b>Cutoff</b>{replay.cutoff_timestamp ? new Date(Number(replay.cutoff_timestamp) * 1000).toISOString().replace('T', ' ').slice(0, 16) : 'N/A'} UTC</span><span><b>Revision</b>r{revision}</span><span><b>Giá tham chiếu</b>{formatPrice(entryReference)}</span></div>
          {!execution && (
            <section className="trade-init-section" aria-labelledby="trade-init-title">
              <div><span className="trade-eyebrow">STEP 01</span><h2 id="trade-init-title">Khởi tạo simulator state</h2><p>Execution state được gắn vào session và giữ cùng provenance. Chi phí dưới đây là fixture/model, chưa phải báo giá broker.</p></div>
              <form className="trade-init-form" onSubmit={initialize}>
                <label>Starting balance<input type="number" min="1" step="0.01" value={startingBalance} onChange={(event) => setStartingBalance(event.target.value)} /></label>
                <label>Spread (price)<input type="number" min="0" step="0.00001" value={spread} onChange={(event) => setSpread(event.target.value)} /></label>
                <button className="trade-primary" type="submit" disabled={Boolean(pending)}>{pending === 'initialize' ? 'Đang khởi tạo…' : 'Khởi tạo local simulator'}</button>
              </form>
            </section>
          )}
          {execution && (
            <section className="trade-grid">
              <div className="trade-main-column">
                <section className="trade-account-strip" aria-label="Tài khoản mô phỏng">
                  <div><span>Balance</span><strong>{formatMoney(account.balance, costModel.account_ccy)}</strong></div><div><span>Equity</span><strong>{formatMoney(account.equity, costModel.account_ccy)}</strong></div><div><span>Floating P/L</span><strong>{formatMoney(account.floating, costModel.account_ccy)}</strong></div><div><span>Position</span><strong>{execution.position ? `${execution.position.side} ${execution.position.quantity}` : execution.pending_market_order ? 'Pending' : 'Flat'}</strong></div>
                </section>
                <section className="trade-draft-section" aria-labelledby="trade-draft-title">
                  <div className="trade-section-title"><div><span className="trade-eyebrow">STEP 02</span><h2 id="trade-draft-title">Draft tại chart cutoff</h2></div><span className="trade-cutoff-label">future fill: nến kế tiếp</span></div>
                  {execution.position || execution.pending_market_order ? (
                    <div className="trade-active-state"><strong>{execution.position ? 'Đang có vị thế trong simulator' : 'Đã có market order đang chờ fill'}</strong><span>{execution.position ? `${execution.position.side} ${execution.position.quantity} · SL ${formatPrice(execution.position.stop_loss)} · TP ${formatPrice(execution.position.take_profit)}` : `${execution.pending_market_order.side} ${execution.pending_market_order.quantity} · sẽ fill ở bar kế tiếp`}</span></div>
                  ) : (
                    <form className="trade-draft-form" onSubmit={queueOrder}>
                      <div className="trade-side-toggle" role="group" aria-label="Hướng lệnh"><button className={draft.side === 'BUY' ? 'is-buy' : ''} type="button" onClick={() => setDraft((current) => ({ ...current, side: 'BUY' }))}>BUY</button><button className={draft.side === 'SELL' ? 'is-sell' : ''} type="button" onClick={() => setDraft((current) => ({ ...current, side: 'SELL' }))}>SELL</button></div>
                      <label>Quantity<input type="number" min={instrument.quantity_min || 0.01} step={instrument.quantity_step || 0.01} value={draft.quantity} onChange={(event) => setDraft((current) => ({ ...current, quantity: event.target.value }))} /></label>
                      <label>Stop loss<input type="number" min="0" step={instrument.tick_size || 0.0001} value={draft.stopLoss} onChange={(event) => setDraft((current) => ({ ...current, stopLoss: event.target.value }))} /></label>
                      <label>Take profit<input type="number" min="0" step={instrument.tick_size || 0.0001} value={draft.takeProfit} onChange={(event) => setDraft((current) => ({ ...current, takeProfit: event.target.value }))} /></label>
                      <RiskPreview draft={draft} entry={entryReference} instrument={instrument} costModel={costModel} />
                      <div className="trade-form-actions"><button className="trade-primary" type="submit" disabled={Boolean(pending) || !Number.isFinite(entryReference)}>{pending === 'queue' ? 'Đang queue…' : 'Queue vào simulator'}</button><span>Không gửi broker · operation sẽ gắn vào ledger local</span></div>
                    </form>
                  )}
                </section>
              </div>
              <aside className="trade-side-column"><section className="trade-context-panel"><div className="trade-section-title"><div><span className="trade-eyebrow">MODEL</span><h2>Execution assumptions</h2></div></div><dl><div><dt>Fill basis</dt><dd>Market · next bar open</dd></div><div><dt>Spread</dt><dd>{execution.spread_price}</dd></div><div><dt>Commission</dt><dd>{costModel.commission_per_side_account} / side</dd></div><div><dt>Contract</dt><dd>{instrument.contract_size}</dd></div><div><dt>Data suffix</dt><dd>{String(replay.dataset_sha256 || '').slice(0, 12) || 'N/A'}</dd></div></dl></section><section className="trade-safety-note"><strong>Live execution bị khóa</strong><span>Trade draft và queue chỉ thay đổi replay state. Không có route gửi lệnh broker trong màn hình này.</span></section>{notice && <div className={`trade-notice is-${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.text}</div>}</aside>
            </section>
          )}
        </>
      )}
    </main>
  )
}

export { DEFAULT_COST_MODEL, DEFAULT_INSTRUMENT, RiskPreview, validateDraft }
