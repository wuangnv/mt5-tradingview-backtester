export function sessionDate(value, time = false, locale = 'vi-VN') {
  if (value == null || value === '' || typeof value === 'boolean' || !Number.isFinite(Number(value))) return '—'
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', ...(time ? { timeStyle: 'short' } : {}), timeZone: 'UTC' }).format(new Date(Number(value) * 1000))
}

export function sessionRemainingDays(dataset, payload, record) {
  const cutoff = record?.cutoff_timestamp ?? payload?.provenance?.cutoff_timestamp ?? payload?.cutoff_timestamp
  return typeof cutoff === 'number' && Number.isFinite(cutoff) && typeof dataset?.last_timestamp === 'number' && Number.isFinite(dataset.last_timestamp)
    ? Math.max(0, Math.ceil((dataset.last_timestamp - cutoff) / 86400)) : null
}

export function sessionRange(item, dataset, payload, record) {
  return { first: dataset?.first_timestamp, last: dataset?.last_timestamp, days: sessionRemainingDays(dataset, payload, record) }
}

export function sessionSettingsFacts(item, dataset, payload, model, record) {
  const execution = record?.payload?.execution
  const costs = execution?.cost_model
  return {
    strategy: payload?.provenance?.playbook_id || record?.payload?.playbook_id || 'Chưa gắn strategy',
    balance: execution?.balance ?? record?.payload?.starting_balance ?? model?.endingBalance ?? null,
    startingBalance: execution?.starting_balance ?? record?.payload?.starting_balance ?? model?.startBalance ?? null,
    currency: costs?.account_ccy || record?.payload?.starting_balance_ccy || model?.result?.account_currency || payload?.metrics?.account_currency,
    asset: item?.instrument_id || dataset?.instrument_id || '—',
    first: dataset?.first_timestamp,
    last: dataset?.last_timestamp,
    costs,
    spread: execution?.spread_price,
  }
}
