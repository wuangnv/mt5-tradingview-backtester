import React, { useEffect, useState } from 'react'
import { DEFAULT_COST_MODEL, RiskPreview, validateDraft } from './TradeWorkspace.jsx'
import { finiteNumber, money, orderDraft, protectionReference, replayAtCutoff } from './replayOrderModel.js'

export function useChartOrder({ replay, dataset, ready, blocked, submit }) {
  const execution = replayAtCutoff(replay)?.payload?.execution
  const instrument = execution?.instrument_spec || dataset?.instrument_spec
  const [draft, setDraft] = useState(() => orderDraft(replay, instrument))
  const [notice, setNotice] = useState(null)
  const [startingBalance, setStartingBalance] = useState('10000')
  const [spread, setSpread] = useState('0.0002')
  const [pending, setPending] = useState(false)
  useEffect(() => { setDraft(orderDraft(replay, instrument)); setNotice(null) }, [replay?.record_id, replay?.revision, instrument])
  const active = execution?.position || execution?.pending_market_order
  const costs = execution?.cost_model || (dataset ? DEFAULT_COST_MODEL : null)
  const reference = protectionReference(replay)
  const disabled = !ready || blocked || pending
  const canInitialize = Boolean(instrument && dataset?.timeframe_seconds && costs)
  const run = async (endpoint, body) => {
    if (disabled) return
    setPending(true)
    setNotice(null)
    try {
      const success = await submit(endpoint, body)
      if (success) setNotice({ kind: 'ok', text: endpoint === 'execution' ? 'Simulator sẵn sàng.' : endpoint.endsWith('protection') ? 'TP/SL đã lưu; áp dụng từ nến tiếp theo.' : 'Đã queue; fill ở giá mở nến kế tiếp.' })
    } catch (error) { setNotice({ kind: 'error', text: error.message }) }
    finally { setPending(false) }
  }
  const save = (nextDraft = draft) => {
    if (disabled || !execution || reference === null) return
    const validation = validateDraft(nextDraft, reference)
    if (validation) { setNotice({ kind: 'error', text: validation }); return }
    const operation_id = `chart-${crypto.randomUUID()}`
    return run(active ? 'orders/protection' : 'orders/market', active
      ? { operation_id, target_id: execution.position?.position_id || execution.pending_market_order.operation_id, stop_loss: nextDraft.stopLoss, take_profit: nextDraft.takeProfit }
      : { operation_id, side: nextDraft.side, quantity: nextDraft.quantity, stop_loss: nextDraft.stopLoss, take_profit: nextDraft.takeProfit })
  }
  const changePrice = (kind, price) => {
    if (disabled || !(price > 0)) return
    const next = { ...draft, [kind === 'stop' ? 'stopLoss' : 'takeProfit']: String(price) }
    if (active) save(next)
    else setDraft(next)
  }
  const chooseSide = side => {
    if (!active && !disabled) { setDraft(current => ({ ...orderDraft(replay, instrument, side), quantity: current.quantity })); setNotice(null) }
  }
  const initialize = () => {
    if (!canInitialize) return
    const balance = finiteNumber(startingBalance), spreadValue = finiteNumber(spread)
    if (!(balance > 0) || spreadValue === null || spreadValue < 0) { setNotice({ kind: 'error', text: 'Nhập vốn dương và spread không âm.' }); return }
    return run('execution', { instrument_spec: instrument, cost_model: costs, spread_price: String(spreadValue), timeframe_seconds: Number(dataset.timeframe_seconds), starting_balance: String(balance) })
  }
  return { draft, setDraft, execution, instrument, costs, active, reference, disabled, pending, notice, startingBalance, setStartingBalance, spread, setSpread, canInitialize, initialize, save, changePrice, chooseSide }
}

export default function ChartOrderPanel({ order, blockedReason }) {
  const { execution, draft, setDraft, active, instrument, costs, disabled, notice } = order
  return <section className="chart-order-panel" aria-label="Lệnh mô phỏng">
    <div className="chart-order-mode"><strong>SIMULATOR</strong><span>Broker locked</span></div>
    {blockedReason && <p role="status">{blockedReason}</p>}
    {!execution ? <form onSubmit={event => { event.preventDefault(); order.initialize() }}>
      <h2>Khởi tạo tài khoản</h2><p>Chi phí mô phỏng, không phải báo giá broker.</p>
      <label>Vốn ban đầu ({costs?.account_ccy || 'Chưa rõ tiền tệ'})<input type="number" min="1" step="0.01" value={order.startingBalance} onChange={event => order.setStartingBalance(event.target.value)} disabled={disabled} /></label>
      <label>Spread (đơn vị giá)<input type="number" min="0" step={instrument?.tick_size || 'any'} value={order.spread} onChange={event => order.setSpread(event.target.value)} disabled={disabled} /></label>
      <button type="submit" disabled={disabled || !order.canInitialize}>Khởi tạo simulator</button>
      {!order.canInitialize && <p>Đang thiếu instrument hoặc timeframe trong dataset.</p>}
    </form> : <>
      <dl className="chart-account"><div><dt>Balance</dt><dd>{money(execution.balance, costs?.account_ccy)}</dd></div><div><dt>Equity</dt><dd>{money(execution.equity, costs?.account_ccy)}</dd></div><div><dt>Floating P/L</dt><dd>{money(execution.floating_pl, costs?.account_ccy)}</dd></div></dl>
      <form onSubmit={event => { event.preventDefault(); order.save() }}>
        <h2>{execution.position ? 'Vị thế đang mở' : active ? 'Lệnh chờ nến kế tiếp' : 'Lệnh mới'}</h2>
        <div className="chart-order-sides">{['BUY', 'SELL'].map(side => <button key={side} type="button" aria-pressed={draft.side === side} className={side.toLowerCase()} disabled={disabled || Boolean(active)} onClick={() => order.chooseSide(side)}>{side}</button>)}</div>
        <label>Khối lượng ({instrument?.asset_class === 'fx' ? 'lot' : 'quantity'})<input aria-label="Khối lượng lệnh" type="number" min={instrument?.quantity_min || '0'} step={instrument?.quantity_step || 'any'} value={draft.quantity} disabled={disabled || Boolean(active)} onChange={event => setDraft(current => ({ ...current, quantity: event.target.value }))} /></label>
        <label>Stop loss<input aria-label="Stop loss" type="number" min="0" step={instrument?.tick_size || 'any'} value={draft.stopLoss} disabled={disabled} onChange={event => setDraft(current => ({ ...current, stopLoss: event.target.value }))} /></label>
        <label>Take profit<input aria-label="Take profit" type="number" min="0" step={instrument?.tick_size || 'any'} value={draft.takeProfit} disabled={disabled} onChange={event => setDraft(current => ({ ...current, takeProfit: event.target.value }))} /></label>
        {!active && <RiskPreview draft={draft} entry={order.reference} instrument={instrument} costModel={costs} />}
        <button type="submit" disabled={disabled}>{order.pending ? 'Đang lưu…' : active ? 'Lưu TP/SL' : 'Queue lệnh mô phỏng'}</button>
        <p>{active ? 'Kéo TP/SL trên chart hoặc nhập giá rồi lưu. Thay đổi áp dụng từ nến kế tiếp.' : 'Entry là giá tham chiếu. Market fill ở giá mở nến kế tiếp, có spread và phí.'}</p>
      </form>
    </>}
    {notice && <p className={`chart-order-notice is-${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.text}</p>}
  </section>
}
