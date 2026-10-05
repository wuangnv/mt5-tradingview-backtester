export const finiteNumber = value => value === '' || value === null || value === undefined || !Number.isFinite(Number(value)) ? null : Number(value)

export function replayAtCutoff(replay) {
  const execution = replay?.payload?.execution
  const cursor = replay?.view_cursor_index ?? replay?.payload?.cursor_index
  if (!execution || execution.cursor_index === cursor) return replay
  return { ...replay, payload: { ...replay.payload, execution: null }, execution_view_status: 'unavailable' }
}

export function orderDraft(replay, instrument, side = 'BUY') {
  replay = replayAtCutoff(replay)
  const active = replay?.payload?.execution?.position || replay?.payload?.execution?.pending_market_order
  if (active) return { side: active.side, quantity: String(active.quantity), stopLoss: String(active.stop_loss), takeProfit: String(active.take_profit) }
  const quotes = marketQuotes(replay)
  const entry = replay?.payload?.execution ? (side === 'BUY' ? quotes.ask : quotes.bid) : finiteNumber(replay?.visible_rows?.at(-1)?.close)
  const pip = finiteNumber(instrument?.pip_size)
  const distance = pip > 0 ? pip * 20 : null
  return { side, quantity: instrument?.quantity_min == null ? '' : String(instrument.quantity_min),
    stopLoss: entry > 0 && distance ? String(Number((entry + (side === 'BUY' ? -distance : distance)).toFixed(8))) : '',
    takeProfit: entry > 0 && distance ? String(Number((entry + (side === 'BUY' ? distance * 2 : -distance * 2)).toFixed(8))) : '' }
}

export function protectionReference(replay) {
  replay = replayAtCutoff(replay)
  const execution = replay?.payload?.execution
  const close = finiteNumber(replay?.visible_rows?.at(-1)?.close)
  if (close === null) return null
  const active = execution?.position || (execution?.quote_source === 'broker_bid_ask' ? execution.pending_market_order : null)
  if (!active) return close
  const quote = marketQuotes(replay)
  return active.side === 'BUY' ? quote.bid : quote.ask
}

export function orderLevels(replay, draft) {
  replay = replayAtCutoff(replay)
  const execution = replay?.payload?.execution
  const active = execution?.position || execution?.pending_market_order
  const quotes = marketQuotes(replay)
  const entry = finiteNumber(execution?.position?.entry_fill ?? (execution ? (draft.side === 'BUY' ? quotes.ask : quotes.bid) : replay?.visible_rows?.at(-1)?.close))
  const stop = finiteNumber(draft.stopLoss)
  const target = finiteNumber(draft.takeProfit)
  if (![entry, stop, target].every(value => value !== null && value > 0)) return null
  const modified = active && (stop !== Number(active.stop_loss) || target !== Number(active.take_profit))
  return { entry, stop, target, side: active?.side || draft.side, state: modified ? 'edit' : execution?.position ? 'position' : active ? 'queued' : 'draft',
    floating: execution?.position ? execution.floating_pl : null, currency: execution?.cost_model?.account_ccy,
    timestamp: execution?.position?.opened_time_utc ?? replay?.visible_rows?.at(-1)?.timestamp }
}

export function marketQuotes(replay) {
  replay = replayAtCutoff(replay)
  const execution = replay?.payload?.execution
  if (execution?.quote_source === 'broker_bid_ask') {
    const bid = finiteNumber(execution.last_bid)
    const ask = finiteNumber(execution.last_ask)
    return bid > 0 && ask >= bid ? { bid, ask } : { bid: null, ask: null }
  }
  const close = finiteNumber(replay?.visible_rows?.at(-1)?.close)
  const spread = finiteNumber(replay?.payload?.execution?.spread_price)
  const tick = finiteNumber(replay?.payload?.execution?.instrument_spec?.tick_size)
  if (close === null || spread === null || !(tick > 0)) return { bid: null, ask: null }
  const roundTick = (value, round) => {
    const units = value / tick
    const nearest = Math.round(units)
    // Decimal tick boundaries should not move by a tick due to binary float noise.
    const rounded = Math.abs(units - nearest) <= Number.EPSILON * Math.max(1, Math.abs(units)) * 4 ? nearest : round(units)
    return Number((rounded * tick).toFixed(8))
  }
  return { bid: roundTick(close - spread / 2, Math.floor), ask: roundTick(close + spread / 2, Math.ceil) }
}

export function money(value, currency) {
  const amount = finiteNumber(value)
  if (amount === null || !currency) return 'N/A'
  try { return new Intl.NumberFormat('vi-VN', { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount) } catch { return 'N/A' }
}
