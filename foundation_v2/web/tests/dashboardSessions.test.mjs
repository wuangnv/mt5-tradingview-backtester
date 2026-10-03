import test from 'node:test'
import assert from 'node:assert/strict'
import { canResumeSession, recentSessions, readLastSession, rememberSession } from '../src/sessionCatalog.js'

test('recent sessions filters archived, searches domain fields and sorts without changing catalog', () => {
  const items = [
    { record_id: 'b', name: 'EURUSD buổi sáng', timeframe: '60s', updated_at_utc: '2026-10-01T09:00:00Z' },
    { record_id: 'a', instrument_id: 'GBPUSD', updated_at_utc: '2026-10-02T09:00:00Z' },
    { record_id: 'c', archived: true, updated_at_utc: '2026-10-03T09:00:00Z' },
    { record_id: 'd', updated_at_utc: 'unknown' },
  ]
  assert.deepEqual(recentSessions(items).map(i => i.record_id), ['a', 'b', 'd'])
  assert.deepEqual(recentSessions(items, { archived: true }).map(i => i.record_id), ['c', 'a', 'b', 'd'])
  assert.deepEqual(recentSessions(items, { sort: 'oldest' }).map(i => i.record_id), ['d', 'b', 'a'])
  for (const search of ['eurusd', '  BUỔI SÁNG  ', '60s']) assert.equal(recentSessions(items, { search })[0].record_id, 'b')
  assert.equal(recentSessions(items, { search: 'GBPUSD' })[0].record_id, 'a')
  assert.equal(recentSessions(items, { search: 'missing' }).length, 0)
  assert.deepEqual(items.map(i => i.record_id), ['b', 'a', 'c', 'd'])
  assert.deepEqual(recentSessions([{ record_id: 'b' }, { record_id: 'a' }]).map(i => i.record_id), ['a', 'b'])
})

test('resume eligibility requires an active session with confirmed dataset availability', () => {
  assert.equal(canResumeSession({ dataset_available: true, archived: false }), true)
  for (const item of [null, {}, { dataset_available: 'true' }, { dataset_available: false }, { dataset_available: true, archived: true }]) assert.equal(canResumeSession(item), false)
})

test('last session storage remains workspace-scoped and tolerates inaccessible storage', () => {
  const previous = globalThis.window
  const values = new Map()
  try {
    globalThis.window = { localStorage: { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) } }
    rememberSession('a', 'session-a'); rememberSession('b', 'session-b')
    assert.equal(readLastSession('a'), 'session-a'); assert.equal(readLastSession('b'), 'session-b')
    rememberSession('a', ''); assert.equal(readLastSession('a'), '')
    globalThis.window = { get localStorage() { throw new Error('denied') } }
    assert.equal(readLastSession('a'), '')
    assert.doesNotThrow(() => rememberSession('a', 'session-a'))
  } finally { globalThis.window = previous }
})
