// Local diagnostics only: callers opt in explicitly; never retain URLs or business data.
const ROUTES = new Set(['overview', 'analytics', 'trade', 'replay', 'research', 'market-data', 'journal', 'settings', 'learn', 'prop', 'risk', 'playbook', 'live', 'reference'])
const DOMAINS = new Set(['api-read', 'dashboard-read', 'analytics-project', 'chart-history', 'history-decode', 'worker-progress'])
const TYPES = new Set(['script', 'css', 'fetch', 'xmlhttprequest', 'img', 'link', 'other'])
const finite = value => Number.isFinite(value) && value >= 0 ? value : 0
const rounded = value => Math.round(finite(value) * 100) / 100
const routeLabel = value => ROUTES.has(value) ? value : 'other'

export function createFrontendPerformance({ enabled = false, capacity = 100, environment = globalThis } = {}) {
  const limit = Math.min(200, Math.max(1, Math.trunc(Number(capacity)) || 100))
  const records = [], observers = [], supportedEntryTypes = [], pending = new Set()
  const totals = { resources: 0, transferBytes: 0, encodedBytes: 0, decodedBytes: 0, longTasks: 0, longTaskMs: 0, maxInteractionMs: 0, layoutShiftSum: 0, largestContentfulPaintMs: 0, resourceTypes: {} }
  let active = enabled === true && typeof environment.performance?.now === 'function'
  let dropped = 0
  const now = () => environment.performance.now()
  const append = record => {
    if (!active) return
    if (records.length === limit) { records.shift(); dropped += 1 }
    records.push(record)
  }
  const process = entries => {
    if (!active) return
    for (const entry of entries) {
      if (entry.entryType === 'resource') {
        const type = TYPES.has(entry.initiatorType) ? entry.initiatorType : 'other'
        totals.resources += 1
        totals.resourceTypes[type] = (totals.resourceTypes[type] || 0) + 1
        totals.transferBytes += finite(entry.transferSize)
        totals.encodedBytes += finite(entry.encodedBodySize)
        totals.decodedBytes += finite(entry.decodedBodySize)
      } else if (entry.entryType === 'longtask') {
        totals.longTasks += 1; totals.longTaskMs += finite(entry.duration)
      } else if (entry.entryType === 'event' && entry.interactionId) {
        // This diagnostic maximum is not the field INP percentile algorithm.
        totals.maxInteractionMs = Math.max(totals.maxInteractionMs, finite(entry.duration))
      } else if (entry.entryType === 'layout-shift' && !entry.hadRecentInput) totals.layoutShiftSum += finite(entry.value)
      else if (entry.entryType === 'largest-contentful-paint') totals.largestContentfulPaintMs = finite(entry.startTime)
    }
  }
  if (active && typeof environment.PerformanceObserver === 'function') {
    for (const type of ['resource', 'longtask', 'event', 'layout-shift', 'largest-contentful-paint']) {
      if (!environment.PerformanceObserver.supportedEntryTypes?.includes(type)) continue
      try {
        const observer = new environment.PerformanceObserver(list => process(list.getEntries()))
        observer.observe({ type, buffered: true, ...(type === 'event' ? { durationThreshold: 16 } : {}) })
        observers.push(observer)
        supportedEntryTypes.push(type)
      } catch { /* Unsupported entry types do not affect the application. */ }
    }
  }
  const drain = () => { for (const observer of observers) process(observer.takeRecords()) }
  const begin = (kind, label) => {
    if (!active) return () => {}
    const started = now()
    let finished = false
    const end = (status = 'ready', bytes) => {
      if (finished || !active) return
      finished = true; pending.delete(end)
      append({ kind, label, status: ['ready', 'error', 'aborted'].includes(status) ? status : 'error', durationMs: rounded(now() - started), ...(Number.isFinite(bytes) && bytes >= 0 ? { payloadBytes: Math.trunc(bytes) } : {}) })
    }
    // Bound forgotten timers, too: stale completions cannot grow the buffer.
    if (pending.size >= limit) { const oldest = pending.values().next().value; oldest('aborted') }
    pending.add(end)
    return end
  }
  return {
    beginNavigation(route) { return begin('navigation-content-ready', routeLabel(route)) },
    beginDomain(domain) { return DOMAINS.has(domain) ? begin('domain', domain) : () => {} },
    async measure(domain, task) {
      const end = this.beginDomain(domain)
      try { const result = await task(); end(); return result }
      catch (error) { end(error?.name === 'AbortError' ? 'aborted' : 'error'); throw error }
    },
    snapshot() {
      drain()
      const navigation = environment.performance?.getEntriesByType?.('navigation')?.[0]
      return { schema: 'frontend-performance-v1', enabled: active, supportedEntryTypes: [...supportedEntryTypes], capacity: limit, dropped, pending: pending.size, records: records.map(record => ({ ...record })), totals: { ...totals, longTaskMs: rounded(totals.longTaskMs), maxInteractionMs: rounded(totals.maxInteractionMs), layoutShiftSum: rounded(totals.layoutShiftSum), largestContentfulPaintMs: rounded(totals.largestContentfulPaintMs), resourceTypes: { ...totals.resourceTypes } }, navigation: active && navigation ? { responseMs: rounded(navigation.responseEnd), domContentLoadedMs: rounded(navigation.domContentLoadedEventEnd), loadMs: rounded(navigation.loadEventEnd) } : null }
    },
    stop() { drain(); for (const observer of observers) observer.disconnect(); observers.length = 0; pending.clear(); active = false },
  }
}

let current = createFrontendPerformance()
export function startFrontendPerformance(options = {}) { current.stop(); current = createFrontendPerformance(options); return current }
export function frontendPerformance() { return current }
