export function replayResolution(seconds) {
  const value = Number(seconds)
  if (!Number.isInteger(value) || value < 1 || (value >= 60 && value % 60)) throw new Error('Timeframe dataset không được Advanced Charts hỗ trợ.')
  return value % 86400 === 0 ? `${value / 86400}D` : value < 60 ? `${value}S` : String(value / 60)
}

export function resolutionSeconds(resolution) {
  const text = String(resolution)
  if (text.endsWith('D')) return Number(text.slice(0, -1) || 1) * 86400
  if (text.endsWith('W')) return Number(text.slice(0, -1) || 1) * 604800
  return text.endsWith('S') ? Number(text.slice(0, -1)) : Number(text) * 60
}

function bucketTime(timestamp, period) {
  if (period === '1M') {
    const date = new Date(timestamp * 1000)
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)
  }
  if (period === '1W') {
    const day = Math.floor(timestamp / 86400)
    return (day - (new Date(timestamp * 1000).getUTCDay() + 6) % 7) * 86400000
  }
  const seconds = typeof period === 'number' ? period : resolutionSeconds(period)
  return Math.floor(timestamp / seconds) * seconds * 1000
}

export function replayBars(rows, cutoff, period) {
  const buckets = new Map()
  for (const row of rows) {
    const timestamp = Number(row.timestamp)
    if (!Number.isFinite(timestamp) || timestamp > Number(cutoff)) continue
    const time = bucketTime(timestamp, period)
    const next = { time, open: Number(row.open), high: Number(row.high), low: Number(row.low), close: Number(row.close) }
    const volume = row.volume ?? row.tick_volume
    if (volume != null && Number.isFinite(Number(volume))) next.volume = Number(volume)
    if (![next.open, next.high, next.low, next.close].every(Number.isFinite)) continue
    const previous = buckets.get(time)
    if (!previous) buckets.set(time, next)
    else {
      const bucket = { ...previous, high: Math.max(previous.high, next.high), low: Math.min(previous.low, next.low), close: next.close }
      if (previous.volume != null && next.volume != null) bucket.volume = previous.volume + next.volume
      else delete bucket.volume
      buckets.set(time, bucket)
    }
  }
  return [...buckets.values()].sort((a, b) => a.time - b.time)
}

// The API-visible prefix is the only history source. No provider/CDN requests.
export function createAdvancedReplayDatafeed({ symbol, seconds, tickSize, rows, cutoff, assetClass = 'fx' }) {
  const interval = replayResolution(seconds)
  const calendar = seconds <= 86400 && 86400 % seconds === 0 ? ['1D', '1W', '1M'] : []
  const supported = [...new Set([interval, ...[1, 3, 5, 15, 30, 60, 120, 240].filter(minutes => minutes * 60 >= seconds && minutes * 60 % seconds === 0).map(String), ...calendar])]
  const precision = tickSize > 0 ? Math.min(8, String(Number(tickSize).toFixed(8)).replace(/0+$/, '').split('.')[1]?.length || 0) : 5
  const pricescale = 10 ** precision
  const type = { fx: 'forex', crypto: 'crypto', equity: 'stock', futures: 'futures' }[assetClass] || 'spread'
  let visible = rows, limit = cutoff, alive = true, generation = 0
  const subscriptions = new Map()
  const history = resolution => {
    if (!supported.includes(resolution)) throw new Error('Resolution không thuộc dataset hiện tại.')
    return replayBars(visible, limit, resolution.endsWith('S') || /^\d+$/.test(resolution) ? resolutionSeconds(resolution) : resolution)
  }
  const defer = callback => setTimeout(callback, 0)
  const datafeed = {
    onReady(callback) { defer(() => alive && callback({ supported_resolutions: supported, supports_marks: false, supports_timescale_marks: false, supports_time: false })) },
    searchSymbols(input, exchange, symbolType, callback) { defer(() => alive && callback(symbol.toLowerCase().includes(input.toLowerCase()) ? [{ symbol, full_name: symbol, description: symbol, exchange: 'Replay', ticker: symbol, type }] : [])) },
    resolveSymbol(name, callback, error) { defer(() => {
      if (!alive) return
      if (name !== symbol) { error('Chỉ symbol của dataset đã chọn được phép hiển thị.'); return }
      callback({ name: symbol, ticker: symbol, description: `${symbol} · Paper replay`, type, format: 'price', session: '24x7', timezone: 'Etc/UTC', exchange: 'Replay', listed_exchange: 'Replay',
        minmov: Math.max(1, Math.round(Number(tickSize || 1 / pricescale) * pricescale)), pricescale, has_intraday: seconds < 86400, has_seconds: seconds < 60,
        seconds_multipliers: seconds < 60 ? [String(seconds)] : [], intraday_multipliers: supported.filter(value => /^\d+$/.test(value)),
        supported_resolutions: supported, has_daily: supported.some(value => value.endsWith('D')), daily_multipliers: [String(seconds >= 86400 ? seconds / 86400 : 1)],
        has_weekly_and_monthly: calendar.includes('1W'), weekly_multipliers: ['1'], monthly_multipliers: ['1'], volume_precision: 0, data_status: 'streaming' })
    }) },
    getBars(info, resolution, period, callback, error) {
      const requestedGeneration = generation
      let bars
      try {
        if (info.ticker !== symbol) throw new Error('Symbol khác dataset.')
        const allowed = history(resolution).filter(bar => bar.time < period.to * 1000)
        const fromIndex = allowed.findIndex(bar => bar.time >= period.from * 1000)
        const start = Math.min(fromIndex < 0 ? allowed.length : fromIndex, Math.max(0, allowed.length - (period.countBack || 0)))
        bars = allowed.slice(start).map(bar => ({ ...bar }))
      } catch (cause) { defer(() => alive && requestedGeneration === generation && error(cause.message)); return }
      defer(() => alive && requestedGeneration === generation && callback(bars, { noData: bars.length === 0 }))
    },
    subscribeBars(info, resolution, callback, id, reset) {
      if (info.ticker !== symbol || !supported.includes(resolution)) return
      subscriptions.set(id, { resolution, callback, reset, last: history(resolution).at(-1) })
    },
    unsubscribeBars(id) { subscriptions.delete(id) },
  }
  return {
    datafeed, interval, supported,
    update(nextRows, nextCutoff) {
      const rewind = Number(nextCutoff) < Number(limit) || nextRows.length < visible.length
      visible = nextRows; limit = nextCutoff
      if (rewind) { generation += 1; subscriptions.forEach(item => { item.last = history(item.resolution).at(-1); item.reset() }); return false }
      subscriptions.forEach(item => {
        const bars = history(item.resolution)
        for (const bar of bars) {
          if (!item.last || bar.time > item.last.time || (bar.time === item.last.time && JSON.stringify(bar) !== JSON.stringify(item.last))) {
            item.last = { ...bar }; item.callback({ ...bar })
          }
        }
      })
      return true
    },
    dispose() { alive = false; generation += 1; subscriptions.clear() },
  }
}
