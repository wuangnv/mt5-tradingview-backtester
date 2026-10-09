import test from 'node:test'
import assert from 'node:assert/strict'
import { subscribeWorkspaceEvents } from '../src/workspaceEvents.js'

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
    assert.equal(a[0].event, 'snapshot')
    assert.deepEqual(a, alsoA)
    assert.equal(b.length, 0)
    offA()
    assert.equal(requests[0].options.signal.aborted, false)
    offAlsoA()
    assert.equal(requests[0].options.signal.aborted, true)
    streams[1].enqueue(new TextEncoder().encode(event))
    await wait()
    assert.equal(b[0].event, 'error')
    assert.match(b[0].data.reason, /scope/)
    assert.equal(b.some(value => value.event === 'snapshot'), false)
  } finally { offA(); offAlsoA(); offB(); globalThis.fetch = originalFetch }
})

test('aborted subscriber never opens a stream', () => {
  const controller = new AbortController(); controller.abort()
  let calls = 0
  const off = subscribeWorkspaceEvents('a', () => calls++, { signal: controller.signal })
  off(); assert.equal(calls, 0)
})
