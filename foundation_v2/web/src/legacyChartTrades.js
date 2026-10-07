export function closedChartTrades(execution) {
  const ledger = execution?.ledger || []
  return ledger.filter(event => event.kind === 'protective_fill').map(event => {
    const details = event.details || {}, entry = ledger.find(item => item.kind === 'market_fill' && item.details?.position_id === details.position_id)
    return { ...details.closed_position, key:event.sequence, position_id:details.position_id, side:details.side || entry?.details.side, quantity:details.quantity || entry?.details.quantity,
      opened_time_utc:entry?.virtual_time_utc, closed_time_utc:event.virtual_time_utc, entry:entry?.details.fill_price, exit:details.fill_price, realized:details.net_pnl, commission:details.cost_breakdown?.commission_account }
  })
}
