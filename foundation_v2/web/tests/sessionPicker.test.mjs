import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultSession, duplicateSession, fetchReplaySessions, normalizeSessionCatalog, reportSessions, sessionAnalyticsQuery, sessionNavigationHref, updateSessionMetadata } from '../src/sessionCatalog.js'

const item = { record_id: 'session-2', revision: 7, dataset_id: 'dataset-2', cursor_index: 12 }

test('Sessions prefer explicit deep link, valid recently run session, then newest creation', () => {
  const items = [{ record_id: 'old', created_at_utc: '2024-01-01', updated_at_utc: '2026-01-01' }, { record_id: 'new', created_at_utc: '2025-01-01' }, { record_id: 'archived', archived: true, created_at_utc: '2026-01-01' }]
  assert.equal(defaultSession(items, '', 'old'), 'old')
  assert.equal(defaultSession(items, '', 'missing'), 'new')
  assert.equal(defaultSession(items, '', 'archived'), 'new')
  assert.equal(defaultSession(items, 'archived', 'old'), 'archived')
  assert.equal(defaultSession(items, 'missing'), 'missing')
  assert.equal(defaultSession([]), '')
})

test('Trades scope distinguishes all, empty, multi selection and explicit session deep links', () => {
  assert.equal(reportSessions(new URLSearchParams()), null)
  assert.equal(reportSessions(new URLSearchParams('session=old&sessions=all')), null)
  assert.deepEqual(reportSessions(new URLSearchParams('sessions=none')), [])
  assert.deepEqual(reportSessions(new URLSearchParams('sessions=a&sessions=b&sessions=a')), ['a', 'b'])
  assert.deepEqual(reportSessions(new URLSearchParams('session=old&cursor=20')), ['old'])
})

test('switching report session clears exact execution checkpoint; same session retains it', () => {
  const query = new URLSearchParams('session=old&event_sequence=60&cursor=20')
  assert.equal(sessionAnalyticsQuery(query, item).has('event_sequence'), false)
  query.set('session', item.record_id)
  assert.equal(sessionAnalyticsQuery(query, item).get('event_sequence'), '60')
})

test('session selection clears stale research and historical context while keeping workspace', () => {
  const query = new URLSearchParams('workspace=old&job=job-1&dataset=dataset-1&session=session-1&cursor=80&cutoff=123&side=buy&playbook=old&playbook_revision=9')
  const next = new URL(sessionNavigationHref('analytics', 'tenant-b', query, item), 'http://localhost').searchParams
  assert.equal(next.get('workspace'), 'tenant-b')
  assert.equal(next.get('view'), 'analytics')
  assert.equal(next.get('session'), 'session-2')
  assert.equal(next.get('dataset'), 'dataset-2')
  assert.equal(next.get('select'), '1')
  for (const key of ['job', 'cursor', 'cutoff', 'side', 'playbook', 'playbook_revision', 'surface']) assert.equal(next.has(key), false, key)
  const chart = new URL(sessionNavigationHref('replay', 'tenant-b', query, item, { surface: 'workspace', select: null }), 'http://localhost').searchParams
  assert.equal(chart.get('surface'), 'workspace')
  assert.equal(chart.has('select'), false)
})

test('session analytics receives the selected session rather than a stale job; summary clears filters', () => {
  const query = new URLSearchParams('job=old&job_id=older&session=old&replay_session=old&cursor=9&cutoff=23&trade=t1&side=sell&from=2026-01-01')
  const scoped = sessionAnalyticsQuery(query, item)
  assert.equal(scoped.get('session'), 'session-2')
  assert.equal(scoped.get('side'), 'sell')
  for (const key of ['job', 'job_id', 'replay_session', 'cursor', 'cutoff', 'trade']) assert.equal(scoped.has(key), false, key)
  const summary = sessionAnalyticsQuery(query, item, { summary: true })
  assert.equal(summary.has('side'), false)
  assert.equal(summary.has('from'), false)
  assert.equal(query.get('job'), 'old', 'input is immutable')
})

test('malformed catalog never turns into a trustworthy empty session list', () => {
  for (const payload of [{}, { items: null }, { items: [null] }, { items: [{ record_id: 'x', revision: 0 }] }]) assert.throws(() => normalizeSessionCatalog(payload))
  assert.deepEqual(normalizeSessionCatalog({ items: [] }), [])
  assert.deepEqual(normalizeSessionCatalog({ items: [item] }), [item])
})

test('catalog and mutations use workspace scope and exact revision/cursor without automatic retries', async (t) => {
  const calls = []
  t.mock.method(globalThis, 'fetch', async (path, options) => {
    calls.push({ path, options })
    return new Response(JSON.stringify(path.endsWith('/sessions') ? { items: [item] } : { record_id: item.record_id }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  })
  const controller = new AbortController()
  assert.deepEqual(await fetchReplaySessions('tenant-a', controller.signal), [item])
  await updateSessionMetadata('tenant-a', item, { name: 'Phiên mới', description: 'Mô tả', archived: true })
  await duplicateSession('tenant-a', item)
  assert.equal(calls.length, 3)
  assert.equal(calls[0].options.signal, controller.signal)
  for (const call of calls) assert.equal(call.options.headers['X-Workspace-Id'], 'tenant-a')
  assert.equal(calls[1].options.method, 'PATCH')
  assert.deepEqual(JSON.parse(calls[1].options.body), { name: 'Phiên mới', description: 'Mô tả', archived: true, expected_revision: 7 })
  assert.match(calls[2].path, /session-2\/branch$/)
  assert.deepEqual(JSON.parse(calls[2].options.body), { expected_revision: 7, cursor_index: 12 })
})

test('revision conflicts and authorization failures keep HTTP status for recovery UI', async (t) => {
  let count = 0
  t.mock.method(globalThis, 'fetch', async () => { count++; return new Response(JSON.stringify({ detail: 'revision_conflict' }), { status: 409 }) })
  await assert.rejects(updateSessionMetadata('tenant-a', item, { name: 'Draft' }), (error) => error.status === 409 && error.message === 'revision_conflict')
  assert.equal(count, 1)
})

test('an explicit same-session trade and historical cutoff survive analytics composition', () => {
  const query = new URLSearchParams('session=session-2&trade=t5&cursor=6&cutoff=123&side=sell')
  const scoped = sessionAnalyticsQuery(query, item)
  assert.equal(scoped.get('trade'), 't5')
  assert.equal(scoped.get('cursor'), '6')
  assert.equal(scoped.get('cutoff'), '123')
  const summary = sessionAnalyticsQuery(query, item, { summary: true })
  assert.equal(summary.has('cursor'), false)
  assert.equal(summary.has('trade'), false)
})
