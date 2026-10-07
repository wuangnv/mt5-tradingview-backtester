import { useEffect, useState } from 'react'
import { useTestingLocale } from './testingLocale.jsx'
import { DEFAULT_COST_MODEL, RiskPreview, validateDraft } from './TradeWorkspace.jsx'
import { finiteNumber, marketQuotes, orderDraft, protectionReference, replayAtCutoff } from './replayOrderModel.js'
import { useReplayTickOptions } from './useReplayTickOptions.js'

export function useChartOrder({ workspace, replay, dataset, ready, blocked, submit }) {
  const execution = replayAtCutoff(replay)?.payload?.execution
  const instrument = execution?.instrument_spec || dataset?.instrument_spec
  const [draft, setDraft] = useState(() => orderDraft(replay, instrument))
  const [notice, setNotice] = useState(null)
  const [startingBalance, setStartingBalance] = useState('10000')
  const [spread, setSpread] = useState('0.0002')
  const [pending, setPending] = useState(false)
  const tick = useReplayTickOptions(workspace, replay)
  useEffect(() => { setDraft(orderDraft(replay, instrument)); setNotice(null) }, [replay?.record_id, replay?.revision, instrument])
  const active = execution?.position || execution?.pending_market_order
  const costs = execution?.cost_model || (dataset ? DEFAULT_COST_MODEL : null)
  const quotes = marketQuotes(replay)
  const reference = active ? protectionReference(replay) : execution ? (draft.side === 'BUY' ? quotes.ask : quotes.bid) : protectionReference(replay)
  const disabled = !ready || blocked || pending
  const canInitialize = Boolean(instrument && dataset?.timeframe_seconds && costs)
  const run = async (endpoint, body) => {
    if (disabled) return
    setPending(true)
    setNotice(null)
    try {
      const success = await submit(endpoint, body)
      if (success) setNotice({ kind: 'ok', text: endpoint === 'execution' ? 'Simulator sẵn sàng.' : endpoint.endsWith('protection') ? 'TP/SL đã lưu; áp dụng từ nến tiếp theo.' : execution?.quote_source === 'broker_bid_ask' ? 'Đã queue; fill ở tick đầu tiên của nến kế tiếp.' : 'Đã queue; fill ở giá mở nến kế tiếp.' })
      return success
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
    if (!canInitialize || tick.options === null) return
    const balance = finiteNumber(startingBalance), spreadValue = tick.useTicks ? 0 : finiteNumber(spread)
    if (!(balance > 0) || spreadValue === null || spreadValue < 0) { setNotice({ kind: 'error', text: 'Nhập vốn dương và spread không âm.' }); return }
    const leverage = finiteNumber(tick.leverage)
    if (tick.useTicks && (!tick.options?.available || !tick.options.snapshot_id || !Number.isInteger(leverage) || leverage < 1 || leverage > 1000)) {
      setNotice({ kind: 'error', text: 'Cần tick tại phút đang chọn và đòn bẩy nguyên từ 1 đến 1000.' }); return
    }
    return run('execution', { instrument_spec: instrument, cost_model: costs, spread_price: String(spreadValue), timeframe_seconds: Number(dataset.timeframe_seconds), starting_balance: String(balance),
      ...(tick.useTicks ? { tick_snapshot_id: tick.options.snapshot_id, research_margin: { version: 'fixed-starting-balance-leverage-v1', leverage: String(leverage) } } : {}) })
  }
  return { draft, setDraft, execution, instrument, costs, active, reference, disabled, pending, notice, startingBalance, setStartingBalance, spread, setSpread, tick, canInitialize, initialize, save, changePrice, chooseSide }
}

function LegacyOrderForm({ order, blockedReason, onClose, onJournal }) {
  const { t } = useTestingLocale()
  const [journal, setJournal] = useState(false)
  const { draft, setDraft, execution, disabled, instrument, active } = order
  const change = (key, value) => setDraft(current => ({ ...current, [key]:value }))
  return <><form className="legacy-order-form" onSubmit={async event => { event.preventDefault(); if (await order.save()) { onClose(); if (journal) onJournal() } }}>
    <div className="legacy-order-grid"><label>{t('Hướng')}<select value={draft.side} disabled={disabled || Boolean(active)} onChange={event => order.chooseSide(event.target.value)}><option value="BUY">Buy</option><option value="SELL">Sell</option></select></label><label>{t('Loại lệnh')}<select value="market" disabled><option value="market">Market</option></select></label>
    <label>{t(instrument?.asset_class==='fx' ? 'Khối lượng (lot)' : 'Khối lượng (quantity)')}<input aria-label={t('Khối lượng lệnh')} type="number" min={instrument?.quantity_min || '0'} step={instrument?.quantity_step || 'any'} value={draft.quantity} disabled={disabled || Boolean(active) || !execution} onChange={event => change('quantity',event.target.value)} /></label><label>{t('Giá vào lệnh')}<input type="text" readOnly value={order.reference ?? '—'} /></label></div>
    {[['stopLoss','Stop loss'],['takeProfit','Take profit']].map(([key,label]) => <div className="legacy-protection-row" key={key} title={t('Simulator hiện yêu cầu cả SL và TP.')}><label><input type="checkbox" role="switch" checked={Boolean(execution)} disabled readOnly />{t(label)}</label>{execution && <input aria-label={t(label)} type="number" min="0" required step={instrument?.tick_size || 'any'} value={draft[key]} disabled={disabled} onChange={event => change(key,event.target.value)} />}</div>)}
    <div className="legacy-protection-row is-unavailable" title={t('Chưa hỗ trợ tự dời SL về hòa vốn')}><label><input type="checkbox" role="switch" disabled />Auto Break-even</label><small>{t('Sắp có')}</small></div>
    <label>{t('Chiến lược')}<select disabled><option>{t('Mặc định của phiên')}</option></select></label><button type="button" className="legacy-strategy-create" disabled>{t('+ Tạo chiến lược mới')}</button>
    {!execution && <p role="status">{t('Chưa có dữ liệu lệnh tại cutoff này.')}</p>}
    {blockedReason && <p role="status">{t(blockedReason)}</p>}
    {execution && <p className="legacy-order-hint">{t(active ? 'Thay đổi TP/SL áp dụng từ nến tiếp theo.' : 'Market được queue và khớp ở nến tiếp theo; giá trên là giá tham chiếu.')} · SIM</p>}
    {order.notice && <p role={order.notice.kind === 'error' ? 'alert' : 'status'}>{t(order.notice.text)}</p>}
    <footer><label><input type="checkbox" checked={journal} onChange={event => setJournal(event.target.checked)} />{t('Mở nhật ký sau khi đặt lệnh')}</label><button type="button" onClick={onClose}>{t('Hủy')}</button><button type="submit" className="legacy-order-save" disabled={disabled || !execution || order.reference === null}>{t(order.pending ? 'Đang lưu…' : 'Save')}</button></footer>
  </form>{!execution && !blockedReason && <details className="legacy-init-details"><summary>{t('Khởi tạo simulator')}</summary><ChartOrderPanel order={order} /></details>}</>
}

export default function ChartOrderPanel({ order, blockedReason, legacy = false, onClose, onJournal }) {
  const { t, fmt } = useTestingLocale()
  const money = (value, currency) => fmt(value, ` ${currency || t('Đơn vị tài khoản')}`)

  const { execution, draft, setDraft, active, instrument, costs, disabled, notice } = order
  if (legacy) return <LegacyOrderForm order={order} blockedReason={blockedReason} onClose={onClose} onJournal={onJournal} />
  return <section className="chart-order-panel" aria-label={t("Lệnh mô phỏng")}>
    <div className="chart-order-mode"><strong>{t("SIMULATOR")}</strong><span>{t("Broker locked")}</span></div>
    {blockedReason && <p role="status">{t(blockedReason)}</p>}
    {!execution ? <form onSubmit={event => { event.preventDefault(); order.initialize() }}>
      <h2>{t("Khởi tạo tài khoản")}</h2><p>{t("Chi phí mô phỏng, không phải báo giá broker.")}</p>
      <label>{t("Vốn ban đầu (")}{costs?.account_ccy || t("Chưa rõ tiền tệ")})<input type="number" min="1" step="0.01" value={order.startingBalance} onChange={event => order.setStartingBalance(event.target.value)} disabled={disabled} /></label>
      <label className="replay-tick-toggle"><input type="checkbox" checked={order.tick.useTicks} disabled={disabled || !order.tick.options?.available} onChange={event => order.tick.setMode(event.target.checked ? 'tick' : 'bar')} />{t("Khớp lệnh bằng tick Bid/Ask")}</label>
      <p role="status">{t(order.tick.options?.reason || 'Đang kiểm tra lịch sử tick…')}</p>
      {order.tick.useTicks ? <label>{t("Đòn bẩy mô phỏng")}<input type="number" min="1" max="1000" step="1" value={order.tick.leverage} onChange={event => order.tick.setLeverage(event.target.value)} disabled={disabled} /></label> : <label>{t("Spread (đơn vị giá)")}<input type="number" min="0" step={instrument?.tick_size || 'any'} value={order.spread} onChange={event => order.setSpread(event.target.value)} disabled={disabled} /></label>}
      <button type="submit" disabled={disabled || !order.canInitialize || order.tick.options === null}>{t("Khởi tạo simulator")}</button>
      {!order.canInitialize && <p>{t("Đang thiếu instrument hoặc timeframe trong dataset.")}</p>}
    </form> : <>
      <dl className="chart-account"><div><dt>{t("Balance")}</dt><dd>{money(execution.balance, costs?.account_ccy)}</dd></div><div><dt>{t("Equity")}</dt><dd>{money(execution.equity, costs?.account_ccy)}</dd></div><div><dt>{t("Floating P/L")}</dt><dd>{money(execution.floating_pl, costs?.account_ccy)}</dd></div></dl>
      <form onSubmit={event => { event.preventDefault(); order.save() }}>
        <h2>{execution.position ? t("Vị thế đang mở") : active ? t("Lệnh chờ nến kế tiếp") : t("Lệnh mới")}</h2>
        <div className="chart-order-sides">{['BUY', 'SELL'].map(side => <button key={side} type="button" aria-pressed={draft.side === side} className={side.toLowerCase()} disabled={disabled || Boolean(active)} onClick={() => order.chooseSide(side)}>{side}</button>)}</div>
        <label>{t("Khối lượng (")}{instrument?.asset_class === 'fx' ? t("lot") : t("quantity")})<input aria-label={t("Khối lượng lệnh")} type="number" min={instrument?.quantity_min || '0'} step={instrument?.quantity_step || 'any'} value={draft.quantity} disabled={disabled || Boolean(active)} onChange={event => setDraft(current => ({ ...current, quantity: event.target.value }))} /></label>
        <label>{t("Stop loss")}<input aria-label={t("Stop loss")} type="number" min="0" step={instrument?.tick_size || 'any'} value={draft.stopLoss} disabled={disabled} onChange={event => setDraft(current => ({ ...current, stopLoss: event.target.value }))} /></label>
        <label>{t("Take profit")}<input aria-label={t("Take profit")} type="number" min="0" step={instrument?.tick_size || 'any'} value={draft.takeProfit} disabled={disabled} onChange={event => setDraft(current => ({ ...current, takeProfit: event.target.value }))} /></label>
        {!active && <RiskPreview draft={draft} entry={order.reference} instrument={instrument} costModel={costs} />}
        <button type="submit" disabled={disabled}>{order.pending ? t("Đang lưu…") : active ? t("Lưu TP/SL") : t("Queue lệnh mô phỏng")}</button>
        <p>{active ? t("Kéo TP/SL trên chart hoặc nhập giá rồi lưu. Thay đổi áp dụng từ nến kế tiếp.") : execution.quote_source === 'broker_bid_ask' ? t("Entry là Bid/Ask tại cutoff. Market fill ở tick đầu tiên của nến kế tiếp; phí theo model.") : t("Entry là giá tham chiếu. Market fill ở giá mở nến kế tiếp, có spread và phí.")}</p>
      </form>
    </>}
    {notice && <p className={`chart-order-notice is-${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{t(notice.text)}</p>}
  </section>
}
