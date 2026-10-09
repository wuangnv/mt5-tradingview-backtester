import test from 'node:test'
import assert from 'node:assert/strict'
import { createFrontendPerformance } from '../src/frontendPerformance.js'

function fixture() {
  let clock = 0
  const observers = []
  class Observer {
    static supportedEntryTypes = ['resource', 'longtask', 'event', 'layout-shift', 'largest-contentful-paint']
    constructor(callback) { this.callback = callback; observers.push(this) }
    observe(options) { this.type = options.type }
    takeRecords() { return [] }
    disconnect() { this.disconnected = true }
  }
  return { environment: { performance: { now: () => clock, getEntriesByType: () => [] }, PerformanceObserver: Observer }, observers, tick: ms => { clock += ms } }
}

test('disabled diagnostics collect nothing and install no observers', () => {
  const f = fixture(), perf = createFrontendPerformance({ environment: f.environment })
  perf.beginNavigation('overview')()
  assert.equal(f.observers.length, 0)
  assert.equal(perf.snapshot().enabled, false)
  assert.deepEqual(perf.snapshot().records, [])
})

test('allowlisted labels, bounded records and aggregate-only entries preserve privacy', () => {
  const f = fixture(), perf = createFrontendPerformance({ enabled: true, capacity: 2, environment: f.environment })
  for (let i = 0; i < 3; i += 1) { const end = perf.beginNavigation(i ? 'overview' : 'https://secret/?account=user'); f.tick(5); end() }
  perf.beginDomain('private-account:123')('ready', 42)
  f.observers.find(observer => observer.type === 'resource').callback({ getEntries: () => [{ entryType: 'resource', name: 'https://private/account/abc', initiatorType: 'fetch', transferSize: 20, encodedBodySize: 10, decodedBodySize: 30 }] })
  const snapshot = perf.snapshot()
  assert.equal(snapshot.dropped, 1)
  assert.equal(snapshot.records.length, 2)
  assert.equal(snapshot.totals.resources, 1)
  assert.equal(snapshot.totals.decodedBytes, 30)
  assert.doesNotMatch(JSON.stringify(snapshot), /secret|private|account|https/)
  assert.deepEqual(snapshot.records.map(record => record.durationMs), [5, 5])
  snapshot.records[0].label = 'changed'
  snapshot.totals.resourceTypes.fetch = 200
  snapshot.supportedEntryTypes.length = 0
  assert.equal(perf.snapshot().records[0].label, 'overview')
  assert.equal(perf.snapshot().totals.resourceTypes.fetch, 1)
  assert.equal(perf.snapshot().supportedEntryTypes.length, 5)
})

test('stop disconnects, clears timers, freezes records and does not alter task outcomes', async () => {
  const f = fixture(), perf = createFrontendPerformance({ enabled: true, environment: f.environment })
  assert.equal(await perf.measure('api-read', async () => 4), 4)
  const original = new Error('business detail must never enter metrics')
  await assert.rejects(perf.measure('api-read', async () => { throw original }), error => error === original)
  const end = perf.beginNavigation('analytics')
  perf.stop(); end()
  assert.equal(perf.snapshot().pending, 0)
  assert.equal(perf.snapshot().records.length, 2)
  assert.ok(f.observers.every(observer => observer.disconnected))
  assert.doesNotMatch(JSON.stringify(perf.snapshot()), /business detail/)
})

test('pending timers are bounded and malformed performance values cannot poison totals', () => {
  const f = fixture(), perf = createFrontendPerformance({ enabled: true, capacity: 1, environment: f.environment })
  const first = perf.beginNavigation('overview'); perf.beginNavigation('analytics'); first()
  assert.equal(perf.snapshot().pending, 1)
  assert.equal(perf.snapshot().records[0].status, 'aborted')
  f.observers.find(observer => observer.type === 'resource').callback({ getEntries: () => [{ entryType: 'resource', transferSize: Infinity, encodedBodySize: -1 }] })
  assert.equal(perf.snapshot().totals.transferBytes, 0)
})

test('unapproved labels collapse to other and error text is never recorded', () => {
  const f = fixture(), perf = createFrontendPerformance({ enabled: true, environment: f.environment })
  const end = perf.beginNavigation('/accounts/private-123?secret=token'); end('message containing private account')
  assert.deepEqual(perf.snapshot().records[0], { kind: 'navigation-content-ready', label: 'other', status: 'error', durationMs: 0 })
})

test('native entry diagnostics do not masquerade as field INP or session-window CLS', () => {
  const f = fixture(), perf = createFrontendPerformance({ enabled: true, environment: f.environment })
  const deliver = (type, entries) => f.observers.find(observer => observer.type === type).callback({ getEntries: () => entries })
  deliver('event', [{ entryType: 'event', interactionId: 2, duration: 80 }, { entryType: 'event', interactionId: 3, duration: 40 }])
  deliver('layout-shift', [{ entryType: 'layout-shift', value: .1, hadRecentInput: true }, { entryType: 'layout-shift', value: .02, hadRecentInput: false }])
  deliver('longtask', [{ entryType: 'longtask', duration: 60 }])
  assert.equal(perf.snapshot().totals.maxInteractionMs, 80)
  assert.equal(perf.snapshot().totals.layoutShiftSum, .02)
  assert.equal(perf.snapshot().totals.longTasks, 1)
  assert.equal(perf.snapshot().totals.longTaskMs, 60)
})
