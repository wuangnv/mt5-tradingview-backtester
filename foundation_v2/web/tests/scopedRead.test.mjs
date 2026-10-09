import test from 'node:test'
import assert from 'node:assert/strict'
import { scopedRead } from '../src/scopedRead.js'

test('simultaneous scoped readers share network work and receive independent bodies; no persistent cache', async t => {
  let finish, calls = 0
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Promise(resolve => { finish = () => resolve(new Response('{"items":[1]}')) }) })
  const first = scopedRead('/fixture/shared', 'a'), second = scopedRead('/fixture/shared', 'a')
  assert.equal(calls, 1)
  finish()
  const responses = await Promise.all([first, second])
  assert.deepEqual(await Promise.all(responses.map(response => response.json())), [{ items: [1] }, { items: [1] }])
  const next = scopedRead('/fixture/shared', 'a')
  assert.equal(calls, 2)
  finish(); await next
})

test('workspace and query isolate simultaneous reads', async t => {
  const calls = []
  t.mock.method(globalThis, 'fetch', async (path, options) => { calls.push([path, options.headers['X-Workspace-Id']]); return new Response('{}') })
  await Promise.all([scopedRead('/fixture/page?offset=0', 'a'), scopedRead('/fixture/page?offset=1', 'a'), scopedRead('/fixture/page?offset=0', 'b')])
  assert.equal(calls.length, 3)
})

test('one unmounted consumer does not cancel another; last consumer cancels network', async t => {
  let networkSignal, finish, calls = 0
  t.mock.method(globalThis, 'fetch', async (path, { signal }) => {
    calls++; networkSignal = signal
    return new Promise((resolve, reject) => {
      finish = () => resolve(new Response('{}'))
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
  })
  const a = new AbortController(), b = new AbortController()
  const first = scopedRead('/fixture/abort', 'a', a.signal), second = scopedRead('/fixture/abort', 'a', b.signal)
  a.abort(); await assert.rejects(first, { name: 'AbortError' })
  assert.equal(networkSignal.aborted, false)
  b.abort(); await assert.rejects(second, { name: 'AbortError' })
  assert.equal(networkSignal.aborted, true)
  const next = scopedRead('/fixture/abort', 'a')
  assert.equal(calls, 2)
  finish(); await next
})

test('cancellation lasts through body download, and errors retain status without caching', async t => {
  let signal, calls = 0
  t.mock.method(globalThis, 'fetch', async (path, options) => {
    calls++; signal = options.signal
    if (calls > 1) return new Response('{"detail":"denied"}', { status: 403 })
    return { arrayBuffer: () => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })) }
  })
  const controller = new AbortController(), pending = scopedRead('/fixture/body', 'a', controller.signal)
  await Promise.resolve(); controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(signal.aborted, true)
  const response = await scopedRead('/fixture/body', 'a')
  assert.equal(response.status, 403)
  assert.deepEqual(await response.json(), { detail: 'denied' })
})

test('an already cancelled reader does not issue network work', async t => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('unexpected fetch'))
  const controller = new AbortController(); controller.abort()
  await assert.rejects(scopedRead('/fixture/preabort', 'a', controller.signal), { name: 'AbortError' })
})
