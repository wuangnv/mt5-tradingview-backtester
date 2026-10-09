export function closedChartTrades(execution) {
  const ledger = execution?.ledger || []
  return ledger.filter(event => event.kind === 'protective_fill').map(event => {
    const details = event.details || {}, entry = ledger.find(item => item.kind === 'market_fill' && item.details?.position_id === details.position_id)
    return { ...details.closed_position, key:event.sequence, position_id:details.position_id, side:details.side || entry?.details.side, quantity:details.quantity || entry?.details.quantity,
      opened_time_utc:entry?.virtual_time_utc, closed_time_utc:event.virtual_time_utc, entry:entry?.details.fill_price, exit:details.fill_price, realized:details.net_pnl, commission:details.cost_breakdown?.commission_account }
  })
}

export function sessionChartTrades(execution, assetStates, symbol) {
  if (!assetStates) return closedChartTrades(execution).map(row => ({ ...row, symbol, assetClass:execution?.instrument_spec?.asset_class, currency:execution?.cost_model?.account_ccy }))
  return Object.entries(assetStates).flatMap(([id, state]) => closedChartTrades(state.execution).map(row => ({ ...row, key:`${id}:${row.key}`, symbol:state.execution.instrument_spec.instrument_id, assetClass:state.execution.instrument_spec.asset_class, currency:state.execution.cost_model.account_ccy }))).sort((a,b) => a.closed_time_utc - b.closed_time_utc || String(a.key).localeCompare(String(b.key)))
}
