import { workspaceHeaders } from './researchDataApi.js'

const streams = new Map()
const MAX_FRAME = 256 * 1024 + 1024

function notify(stream, event, data) {
  for (const callback of stream.listeners) {
    try { callback({ event, data }) } catch { /* One consumer cannot stop the workspace stream. */ }
  }
}

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
      throw new Error('Invalid workspace event scope')
    }
    stream.snapshot = data
    stream.retry = 1000
  }
  notify(stream, event, data)
}

async function connect(stream) {
  const controller = new AbortController()
  stream.controller = controller
  let reader
  let expired = false
  let watchdog
  const heartbeat = () => {
    clearTimeout(watchdog)
    watchdog = setTimeout(() => { expired = true; controller.abort() }, 45000)
  }
  heartbeat()
  try {
    const response = await fetch('/api/v2/events', {
      headers: workspaceHeaders(stream.workspace, { Accept: 'text/event-stream' }),
      signal: controller.signal,
      cache: 'no-store',
    })
    if (!response.ok || !response.headers.get('content-type')?.startsWith('text/event-stream') || !response.body) {
      throw new Error(`Workspace events unavailable (${response.status})`)
    }
    reader = response.body.getReader()
    const decoder = new TextDecoder()
    let pending = ''
    while (stream.listeners.size) {
      const { value, done } = await reader.read()
      if (done) break
      heartbeat()
      pending += decoder.decode(value, { stream: true })
      // Server uses LF; normalize a CRLF only after both characters have arrived.
      pending = pending.replace(/\r\n/g, '\n')
      let boundary
      while ((boundary = pending.indexOf('\n\n')) !== -1) {
        if (boundary > MAX_FRAME) throw new Error('Workspace event exceeds buffer limit')
        frame(stream, pending.slice(0, boundary))
        pending = pending.slice(boundary + 2)
      }
      if (pending.length > MAX_FRAME) throw new Error('Workspace event exceeds buffer limit')
    }
    if (stream.listeners.size) { stream.snapshot = null; notify(stream, 'error', { reason: 'stream_disconnected' }) }
  } catch (error) {
    if (!controller.signal.aborted || expired) {
      stream.snapshot = null
      notify(stream, 'error', { reason: expired ? 'stream_heartbeat_timeout' : error.message })
    }
  } finally {
    clearTimeout(watchdog)
    await reader?.cancel().catch(() => {})
    reader?.releaseLock()
    if (stream.listeners.size && streams.get(stream.workspace) === stream) {
      // Reconnect always receives the current durable snapshot; no process-local event replay.
      stream.timer = setTimeout(() => connect(stream), stream.retry)
      stream.retry = Math.min(stream.retry * 2, 30000)
    }
  }
}

/** One authenticated connection per workspace, shared by all mounted consumers. */
export function subscribeWorkspaceEvents(workspaceId, callback, { signal } = {}) {
  const workspace = String(workspaceId || '').trim()
  if (!workspace || signal?.aborted) return () => {}
  let stream = streams.get(workspace)
  if (!stream) {
    stream = { workspace, listeners: new Set(), retry: 1000, timer: null, controller: null, snapshot: null }
    streams.set(workspace, stream)
  }
  stream.listeners.add(callback)
  if (stream.snapshot) callback({ event: 'snapshot', data: stream.snapshot })
  if (!stream.controller) void connect(stream)
  let active = true
  const unsubscribe = () => {
    if (!active) return
    active = false
    signal?.removeEventListener('abort', unsubscribe)
    stream.listeners.delete(callback)
    if (!stream.listeners.size) {
      clearTimeout(stream.timer)
      stream.controller?.abort()
      streams.delete(workspace)
    }
  }
  signal?.addEventListener('abort', unsubscribe, { once: true })
  return unsubscribe
}
