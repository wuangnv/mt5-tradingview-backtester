import test from 'node:test'
import assert from 'node:assert/strict'
import { subscribeWorkspaceEvents, createWorkspaceEventHub } from '../src/workspaceEvents.js'

const wait = () => new Promise(resolve => setTimeout(resolve, 10))
test('one authorized stream per workspace, scoped snapshots and teardown', async () => {
  const originalFetch = globalThis.fetch
  const requests = []
  const streams = []
  globalThis.fetch = async (url, options) => {
    let transport
    const body = new ReadableStream({ start(controller) { transport = controller; streams.push(controller) } })
    requests.push({url,options})
    options.signal.addEventListener('abort', () => { try { transport.close() } catch {} }, { once: true })
    return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } })
  }
  const a = [], alsoA = [], b = []
  const offA = subscribeWorkspaceEvents('a', value => a.push(value))
  const offAlsoA = subscribeWorkspaceEvents('a', value => alsoA.push(value))
  const offB = subscribeWorkspaceEvents('b', value => b.push(value))
  try {
    await wait()
    assert.equal(requests.length, 2)
    assert.equal(requests[0].options.headers['X-Workspace-Id'], 'a')
    assert.equal(requests[1].options.headers['X-Workspace-Id'], 'b')
    const event = `event: snapshot\nid: r\ndata: ${JSON.stringify({schema_version:'workspace-events-v1',workspace_id:'a',revision:'r'})}\n\n`
    // UTF8/line frames can arrive in separate transport chunks.
    streams[0].enqueue(new TextEncoder().encode(event.slice(0, 15)))
    streams[0].enqueue(new TextEncoder().encode(event.slice(15)))
    await wait()
    assert.equal(a.filter(value => value.event === 'snapshot').length, 1)
    assert.deepEqual(a.filter(value => value.event === 'snapshot'), alsoA.filter(value => value.event === 'snapshot'))
    assert.equal(b.filter(value => value.event === 'snapshot').length, 0)
    offA()
    assert.equal(requests[0].options.signal.aborted, false)
    offAlsoA()
    assert.equal(requests[0].options.signal.aborted, true)
    streams[1].enqueue(new TextEncoder().encode(event))
    await wait()
    assert.match(b.find(value => value.event === 'error').data.reason, /scope/)
    assert.equal(b.some(value => value.event === 'snapshot'), false)
  } finally { offA(); offAlsoA(); offB(); globalThis.fetch = originalFetch }
})

function fixture(extra = {}) {
  const requests = [], transports = []
  const hub = createWorkspaceEventHub({ retryMs: 10, maxRetryMs: 20, random: () => 0.5, ...extra,
    fetch: async (url, options) => {
      requests.push(options)
      let transport
      const body = new ReadableStream({ start(controller) { transport = controller; transports.push(controller) } })
      options.signal.addEventListener('abort', () => { try { transport.close() } catch {} }, { once: true })
      return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } })
    },
  })
  const send = (index, workspace = 'a', revision = 'r') => transports[index].enqueue(new TextEncoder().encode(
    `event: snapshot\ndata: ${JSON.stringify({ schema_version: 'workspace-events-v1', workspace_id: workspace, revision })}\n\n`))
  return { hub, requests, transports, send }
}

test('disconnected stream reconnects once even when another consumer subscribes during backoff', async () => {
  const f = fixture(), seen = [], off = f.hub.subscribe('a', value => seen.push(value))
  let second
  try {
    await wait(); f.send(0); await wait()
    f.transports[0].close()
    await new Promise(resolve => setTimeout(resolve, 1))
    second = f.hub.subscribe('a', () => {})
    assert.equal(f.requests.length, 1)
    await new Promise(resolve => setTimeout(resolve, 25))
    assert.equal(f.requests.length, 2)
    f.send(1, 'a', 'new'); await wait()
    assert.equal(seen.filter(value => value.event === 'snapshot').at(-1).data.revision, 'new')
  } finally { off(); second?.() }
})

test('hidden tabs pause, visible tabs reconcile a new snapshot and remove visibility listeners on teardown', async () => {
  const page = new EventTarget(); page.visibilityState = 'visible'
  const f = fixture({ document: page }), seen = [], off = f.hub.subscribe('a', value => seen.push(value))
  try {
    await wait(); f.send(0); await wait()
    page.visibilityState = 'hidden'; page.dispatchEvent(new Event('visibilitychange'))
    await new Promise(resolve => setTimeout(resolve, 30))
    assert.equal(f.requests[0].signal.aborted, true)
    assert.equal(f.requests.length, 1)
    page.visibilityState = 'visible'; page.dispatchEvent(new Event('visibilitychange'))
    await wait(); assert.equal(f.requests.length, 2)
    f.send(1, 'a', 'after-hidden'); await wait()
    assert.equal(seen.filter(value => value.event === 'snapshot').at(-1).data.revision, 'after-hidden')
  } finally { off() }
  page.dispatchEvent(new Event('visibilitychange')); await wait()
  assert.equal(f.requests.length, 2)
})

test('401/403 are terminal: no infinite reconnect, late subscribers see denied state', async () => {
  for (const code of [401, 403]) {
    let requests = 0
    const hub = createWorkspaceEventHub({ retryMs: 5, fetch: async () => { requests++; return new Response('', { status: code }) } })
    const events = [], off = hub.subscribe('a', event => events.push(event))
    let second
    try {
      await wait()
      second = hub.subscribe('a', event => events.push(event))
      await new Promise(resolve => setTimeout(resolve, 20))
      assert.equal(requests, 1)
      assert.equal(events.find(event => event.event === 'error').data.status, code)
      assert.equal(events.at(-1).data.state, 'denied')
    } finally { off(); second?.() }
  }
})

test('oversized partial frames fail boundedly and heartbeat timeouts recover', async () => {
  const huge = fixture(), errors = [], offHuge = huge.hub.subscribe('a', event => errors.push(event))
  try {
    await wait()
    huge.transports[0].enqueue(new TextEncoder().encode('x'.repeat(270 * 1024)))
    await wait()
    assert.match(errors.find(event => event.event === 'error').data.reason, /buffer limit/)
  } finally { offHuge() }
  const stalled = fixture({ heartbeatMs: 15 }), seen = [], offStalled = stalled.hub.subscribe('a', event => seen.push(event))
  try {
    await new Promise(resolve => setTimeout(resolve, 40))
    assert.equal(seen.some(event => event.data.reason === 'stream_heartbeat_timeout'), true)
    assert.equal(stalled.requests.length >= 2, true)
  } finally { offStalled() }
})

test('cancel during retry prevents resurrection and retry delay spreads tab reconnects', async () => {
  const scheduled = []
  const hub = createWorkspaceEventHub({ random: () => 0, setTimeout: (fn, delay) => {
    const task = { fn, delay, cancelled: false }; scheduled.push(task); return task
  }, clearTimeout: task => { if (task) task.cancelled = true }, fetch: async () => { throw new TypeError('offline') } })
  const abort = new AbortController(), off = hub.subscribe('a', () => {}, { signal: abort.signal })
  await wait()
  const retry = scheduled.find(task => task.delay === 750)
  assert.ok(retry)
  abort.abort(); off()
  assert.equal(retry.cancelled, true)
  retry.fn(); await wait()
  assert.equal(scheduled.filter(task => task.delay === 750).length, 1)
})

test('aborted subscriber never opens a stream', () => {
  const controller = new AbortController(); controller.abort()
  let calls = 0
  const off = subscribeWorkspaceEvents('a', () => calls++, { signal: controller.signal })
  off(); assert.equal(calls, 0)
})
