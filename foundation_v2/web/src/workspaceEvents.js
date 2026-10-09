import { workspaceHeaders } from './researchDataApi.js'

const MAX_FRAME = 256 * 1024 + 1024

/** A tab shares one stream per workspace. Dependencies keep lifecycle tests deterministic. */
export function createWorkspaceEventHub({ fetch: request = (...args) => fetch(...args), document: page = globalThis.document,
  setTimeout: later = setTimeout, clearTimeout: cancel = clearTimeout, random = Math.random,
  heartbeatMs = 45000, retryMs = 1000, maxRetryMs = 30000 } = {}) {
  const streams = new Map()
  const visible = () => page?.visibilityState !== 'hidden'
  const notify = (stream, event, data) => {
    for (const callback of stream.listeners) {
      try { callback({ event, data }) } catch { /* Consumers cannot stop other listeners. */ }
    }
  }
  const status = (stream, state) => { stream.state = state; notify(stream, 'connection', { state }) }
  function frame(stream, text) {
    let event = 'message'
    const lines = []
    for (const line of text.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      if (line.startsWith('data:')) lines.push(line.slice(5).trimStart())
    }
    if (!lines.length) return
    const data = JSON.parse(lines.join('\n'))
    if (event === 'snapshot') {
      if (data.schema_version !== 'workspace-events-v1' || data.workspace_id !== stream.workspace) {
        stream.terminal = true
        throw new Error('Invalid workspace event scope')
      }
      stream.snapshot = data
      stream.retry = retryMs
      status(stream, 'connected')
    }
    notify(stream, event, data)
  }
  const active = stream => stream.listeners.size && streams.get(stream.workspace) === stream
  function schedule(stream, immediate = false) {
    if (!active(stream) || stream.terminal || !visible() || stream.timer || stream.controller) return
    // Spread reconnects across tabs, capped even after extended downtime.
    const delay = immediate ? 0 : Math.min(maxRetryMs, stream.retry * (0.75 + random() * 0.5))
    stream.timer = later(() => { stream.timer = null; void connect(stream) }, delay)
    if (!immediate) stream.retry = Math.min(stream.retry * 2, maxRetryMs)
  }
  async function connect(stream) {
    if (!active(stream) || stream.terminal || !visible() || stream.controller) return
    const controller = new AbortController()
    stream.controller = controller
    status(stream, 'connecting')
    let reader, watchdog, expired = false
    const heartbeat = () => {
      cancel(watchdog)
      watchdog = later(() => { expired = true; controller.abort() }, heartbeatMs)
    }
    heartbeat()
    try {
      const response = await request('/api/v2/events', {
        headers: workspaceHeaders(stream.workspace, { Accept: 'text/event-stream' }),
        signal: controller.signal, cache: 'no-store',
      })
      if (response.status === 401 || response.status === 403) {
        stream.terminal = true
        const error = new Error(`Workspace events denied (${response.status})`)
        error.status = response.status
        throw error
      }
      if (!response.ok || !response.headers.get('content-type')?.startsWith('text/event-stream') || !response.body) {
        throw new Error(`Workspace events unavailable (${response.status})`)
      }
      reader = response.body.getReader()
      const decoder = new TextDecoder()
      let pending = ''
      while (active(stream) && !controller.signal.aborted) {
        const { value, done } = await reader.read()
        if (done || controller.signal.aborted) break
        heartbeat()
        pending = (pending + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n')
        let boundary
        while ((boundary = pending.indexOf('\n\n')) !== -1) {
          if (boundary > MAX_FRAME) throw new Error('Workspace event exceeds buffer limit')
          frame(stream, pending.slice(0, boundary))
          pending = pending.slice(boundary + 2)
        }
        if (pending.length > MAX_FRAME) throw new Error('Workspace event exceeds buffer limit')
      }
      if (expired) throw new Error('Workspace event heartbeat expired')
      if (active(stream) && !controller.signal.aborted) {
        stream.snapshot = null
        status(stream, 'disconnected')
        notify(stream, 'error', { reason: 'stream_disconnected' })
      }
    } catch (error) {
      if (!controller.signal.aborted || expired) {
        stream.snapshot = null
        status(stream, stream.terminal ? 'denied' : 'disconnected')
        notify(stream, 'error', { reason: expired ? 'stream_heartbeat_timeout' : error.message, status: error.status, terminal: stream.terminal })
      }
    } finally {
      cancel(watchdog)
      await reader?.cancel().catch(() => {})
      reader?.releaseLock()
      if (stream.controller === controller) stream.controller = null
      const resume = stream.resume
      stream.resume = false
      schedule(stream, resume)
    }
  }
  function visibilityChanged() {
    for (const stream of streams.values()) {
      cancel(stream.timer); stream.timer = null
      stream.snapshot = null
      if (!visible()) {
        status(stream, 'paused')
        stream.controller?.abort()
      } else {
        // The server sends its durable current snapshot on each reconnect.
        stream.resume = Boolean(stream.controller)
        if (!stream.controller) schedule(stream, true)
      }
    }
  }
  function subscribe(workspaceId, callback, { signal } = {}) {
    const workspace = String(workspaceId || '').trim()
    if (!workspace || signal?.aborted) return () => {}
    let stream = streams.get(workspace)
    if (!stream) {
      if (!streams.size) page?.addEventListener('visibilitychange', visibilityChanged)
      stream = { workspace, listeners: new Set(), retry: retryMs, timer: null, controller: null, snapshot: null, state: visible() ? 'disconnected' : 'paused', terminal: false }
      streams.set(workspace, stream)
    }
    stream.listeners.add(callback)
    notifyOne(callback, { event: 'connection', data: { state: stream.state } })
    if (stream.snapshot) notifyOne(callback, { event: 'snapshot', data: stream.snapshot })
    if (!stream.controller && !stream.timer) void connect(stream)
    let subscribed = true
    const unsubscribe = () => {
      if (!subscribed) return
      subscribed = false
      signal?.removeEventListener('abort', unsubscribe)
      stream.listeners.delete(callback)
      if (!stream.listeners.size) {
        cancel(stream.timer); stream.timer = null
        stream.controller?.abort()
        streams.delete(workspace)
        if (!streams.size) page?.removeEventListener('visibilitychange', visibilityChanged)
      }
    }
    signal?.addEventListener('abort', unsubscribe, { once: true })
    return unsubscribe
  }
  return { subscribe }
}

function notifyOne(callback, value) { try { callback(value) } catch { /* Same isolation as live delivery. */ } }
const hub = createWorkspaceEventHub()
export const subscribeWorkspaceEvents = hub.subscribe
