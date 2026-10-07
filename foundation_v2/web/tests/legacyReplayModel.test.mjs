import test from 'node:test'
import assert from 'node:assert/strict'
import { replayIntervalSteps, replayAdvance, replayRewind, replayRewindBucket, replaySelectionCursor, replayDelay } from '../src/legacyReplayModel.js'

test('M1 replay intervals batch every underlying candle and reject invented sub-minute data', () => {
  assert.equal(replayIntervalSteps('5', 60), 5)
  assert.equal(replayIntervalSteps('60', 60), 60)
  assert.equal(replayIntervalSteps('240', 60), 240)
  assert.equal(replayIntervalSteps('5S', 60), null)
  assert.equal(replayIntervalSteps('3', 120), null)
  assert.equal(replayIntervalSteps('1D', 60), null)
  assert.equal(replayIntervalSteps('1M', 60), null)
  assert.equal(replayIntervalSteps('1', undefined), null)
})
test('second datasets replay seconds without exceeding the API batch limit', () => {
  assert.equal(replayIntervalSteps('15S', 5), 3)
  assert.equal(replayIntervalSteps('30', 5), 360)
  assert.equal(replayIntervalSteps('240', 5), null)
})
test('historical forward is read-only, clamps to canonical and then resumes authoritative cursor', () => {
  assert.deepEqual(replayAdvance({ cursor: 10, canonicalCursor: 100, historical: true, steps: 60 }), { kind: 'read', cursor: 70 })
  assert.deepEqual(replayAdvance({ cursor: 70, canonicalCursor: 100, historical: true, steps: 60, completed: true }), { kind: 'read', cursor: null })
  assert.deepEqual(replayAdvance({ cursor: 100, canonicalCursor: 100, historical: false, steps: 60 }), { kind: 'step', steps: 60 })
  assert.equal(replayAdvance({ cursor: 100, canonicalCursor: 100, historical: false, steps: 60, completed: true }), null)
  assert.equal(replayAdvance({ cursor: 10, canonicalCursor: 100, historical: true, steps: null }), null)
})
test('rewind respects replay interval and never reads a negative cursor', () => {
  assert.equal(replayRewind(100, 60), 40)
  assert.equal(replayRewind(40, 60), 0)
  assert.equal(replayRewind(0, 60), null)
})
test('native interval actions ask the server to resolve boundaries without future timestamps', () => {
  assert.deepEqual(replayAdvance({ cursor: 7, canonicalCursor: 75, historical: true, steps: 60, intervalSeconds: 3600 }), { kind: 'read', cursor: 7, advanceIntervalSeconds: 3600 })
  assert.deepEqual(replayAdvance({ cursor: 75, canonicalCursor: 75, historical: false, steps: 60, intervalSeconds: 3600 }), { kind: 'step', steps: 1, replayIntervalSeconds: 3600 })
})
test('rewind selects the previous occupied UTC bucket using only the visible prefix', () => {
  const rows = Array.from({ length: 68 }, (_, i) => ({ timestamp: i * 60 }))
  assert.equal(replayRewindBucket(rows, 67, 3600), 0)
  assert.equal(replayRewindBucket(rows, 67, 300), 60)
  const gap = [{ timestamp: 3600 }, { timestamp: 3660 }, { timestamp: 3 * 86400 }]
  assert.equal(replayRewindBucket(gap, 2, 3600), 0)
  assert.equal(replayRewindBucket([], 2, 3600), null)
  assert.equal(replayRewindBucket(rows, 67, NaN), null)
})
test('bar selection accepts only prior candles from visible prefix', () => {
  const rows = [{ timestamp: 100 }, { timestamp: 160 }, { timestamp: 220 }]
  assert.equal(replaySelectionCursor(rows, 100, 2), 0)
  assert.equal(replaySelectionCursor(rows, 220, 2), null)
  assert.equal(replaySelectionCursor(rows, 280, 2), null)
  assert.equal(replaySelectionCursor(rows, NaN, 2), null)
  assert.equal(replaySelectionCursor(rows.slice(1), 160, 2), 1)
})
test('speed schedules 1–16 events per second and caps catch-up to a single event', () => {
  assert.equal(replayDelay('1', 0, 0), 1000)
  assert.equal(replayDelay('16', 0, 0), 62.5)
  assert.equal(replayDelay('16', 0, 1000), 0)
  assert.equal(replayDelay('100', 0, 0), 62.5)
  assert.equal(replayDelay('0', 0, 0), 1000)
})
