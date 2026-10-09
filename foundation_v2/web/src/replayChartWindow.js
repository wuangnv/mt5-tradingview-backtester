import { frontendPerformance } from './frontendPerformance.js'

const MAX_BARS = 2000

// Owned by one chart instance: neither portfolio changes nor workspace changes share history.
export function createReplayChartWindowReader({ workspace, sessionId, datasetId, datasetSha256, fetchImpl = fetch }) {
  const cache = new Map(), pending = new Map()
  let generation = 0, disposed = false
  const clear = () => {
    generation += 1
    cache.clear()
    for (const item of pending.values()) item.controller.abort()
    pending.clear()
  }
  return {
    async read({ resolution, to, from, countBack = 300, cursorIndex, cutoff }) {
      if (disposed) throw new Error('Chart history reader đã đóng.')
      if (!Number.isFinite(countBack) || countBack <= 0 || !Number.isInteger(cursorIndex) || cursorIndex < 0 || !Number.isFinite(Number(cutoff))) {
        throw new Error('Chart history request không hợp lệ.')
      }
      const count = Math.min(MAX_BARS, Math.max(1, Math.ceil(countBack)))
      const key = JSON.stringify([cursorIndex, cutoff, resolution, to, from, count])
      if (cache.has(key)) {
        const value = cache.get(key)
        cache.delete(key); cache.set(key, value)
        return value.bars.map(bar => ({ ...bar }))
      }
      if (!pending.has(key)) {
        if (pending.size >= 8) {
          const oldest = pending.keys().next().value
          pending.get(oldest).controller.abort()
          pending.delete(oldest)
        }
        const controller = new AbortController(), requestGeneration = generation
        const finish = frontendPerformance().beginDomain('chart-history')
        const query = new URLSearchParams({ dataset_id: datasetId, dataset_sha256: datasetSha256,
          cursor_index: String(cursorIndex), resolution: String(resolution), count_back: String(count) })
        if (Number.isFinite(to)) query.set('to_utc', String(Math.floor(to)))
        if (Number.isFinite(from)) query.set('from_utc', String(Math.floor(from)))
        const promise = (async () => {
          const response = await fetchImpl(`/api/v2/replay/sessions/${encodeURIComponent(sessionId)}/chart-window?${query}`, {
            headers: { 'X-Workspace-Id': workspace }, signal: controller.signal, cache: 'no-store',
          })
          if (!response.ok) {
            if (response.status === 401 || response.status === 403) clear()
            throw new Error(`Không đọc được lịch sử chart (${response.status}).`)
          }
          const payload = await response.json()
          if (disposed || controller.signal.aborted || generation !== requestGeneration) throw new DOMException('Chart scope changed', 'AbortError')
          if (payload.schema_version !== 'replay-chart-window-v1' || payload.workspace_id !== workspace || payload.session_id !== sessionId
              || payload.dataset_id !== datasetId || payload.dataset_sha256 !== datasetSha256 || payload.cursor_index !== cursorIndex
              || payload.cutoff_timestamp !== Number(cutoff) || payload.resolution !== String(resolution)
              || !Array.isArray(payload.bars) || payload.bars.length > count) throw new Error('Chart history sai phạm vi replay.')
          let previous = -Infinity
          const bars = payload.bars.map(bar => {
            if (![bar.time, bar.open, bar.high, bar.low, bar.close].every(Number.isFinite)
                || (bar.volume != null && !Number.isFinite(bar.volume)) || bar.time <= previous
                || bar.time > Number(cutoff) * 1000 || (Number.isFinite(to) && bar.time >= to * 1000)) {
              throw new Error('Chart history chứa nến không hợp lệ hoặc vượt cutoff.')
            }
            previous = bar.time
            return { ...bar }
          })
          cache.set(key, { resolution: String(resolution), bars })
          while (cache.size > 8) cache.delete(cache.keys().next().value)
          finish('ready')
          return bars
        })().catch(error => {
          finish(error?.name === 'AbortError' ? 'aborted' : 'error')
          throw error
        }).finally(() => { if (pending.get(key)?.controller === controller) pending.delete(key) })
        pending.set(key, { promise, controller })
      }
      return (await pending.get(key).promise).map(bar => ({ ...bar }))
    },
    reset: clear,
    nativeRow(timestamp, resolution) {
      for (const entry of cache.values()) {
        if (entry.resolution !== String(resolution)) continue
        const bar = entry.bars.find(item => item.time === timestamp * 1000)
        if (bar) return { timestamp, open: bar.open, high: bar.high, low: bar.low, close: bar.close,
          ...(bar.volume == null ? {} : { volume: bar.volume }) }
      }
      return null
    },
    dispose() { disposed = true; clear() },
  }
}
