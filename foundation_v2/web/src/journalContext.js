export function readJournalContext(payload, workspace, session) {
  if (payload?.schema_version !== 'replay-journal-context-v1' || payload.workspace_id !== workspace || payload.session_id !== session
    || !Number.isSafeInteger(payload.record_count) || payload.record_count < 0 || !Array.isArray(payload.trades)) throw new Error('journal_context_invalid')
  const byTrade = new Map()
  for (const item of payload.trades) {
    if (!item || typeof item.trade_id !== 'string' || byTrade.has(item.trade_id) || !Number.isSafeInteger(item.record_count)
      || item.record_count < 0 || !Array.isArray(item.tags) || item.tags.some(tag => typeof tag !== 'string')) throw new Error('journal_context_invalid')
    byTrade.set(item.trade_id, { tags: [...new Set(item.tags)], count: item.record_count })
  }
  return { workspace, session, count: payload.record_count, byTrade }
}

export function enrichJournalTags(ledger, context) {
  return ledger.map(trade => {
    const tags = context?.byTrade.get(trade.tradeId)?.tags || []
    return { ...trade, tags: [...new Set([...(Array.isArray(trade.tags) ? trade.tags : []), ...tags])], tag_source: tags.length ? 'journal_annotation' : 'ledger' }
  })
}
