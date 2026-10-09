import { scopedMutation } from './scopedMutation.js'
import { useEffect, useState } from 'react'
import { ReplayActivityClock, appendActivitySegment, REPLAY_ACTIVITY_FLUSH_MS } from './replayActivityClock.js'

const MAX_PENDING_EVENTS = 120

export default function useReplayActivity({ workspace, sessionId, enabled }) {
  const [waiting, setWaiting] = useState(false)
  useEffect(() => {
    if (!enabled || !sessionId) return undefined
    let disposed = false, sending = false
    const key = `tw:replay-activity:v1:${workspace}:${sessionId}`
    const endpoint = `/api/v2/replay/sessions/${encodeURIComponent(sessionId)}/activity`
    const headers = { 'Content-Type': 'application/json', 'X-Workspace-Id': workspace }
    const eligible = () => !document.hidden && document.hasFocus()
    const clock = new ReplayActivityClock(performance.now(), Date.now(), eligible())
    const segments = [], documents = new Map(), frames = new Map()
    let queue = []
    try {
      const stored = JSON.parse(sessionStorage.getItem(key) || '[]')
      if (Array.isArray(stored)) queue = stored.filter(event => {
        const start = Date.parse(event?.started_at_utc), end = Date.parse(event?.ended_at_utc)
        return typeof event?.event_id === 'string' && /^[0-9a-f-]{36}$/i.test(event.event_id)
          && end > start && end - start <= 30_000 && end <= Date.now() + 5000 && start > Date.now() - 86_400_000
      }).slice(0, MAX_PENDING_EVENTS)
    } catch { /* Unavailable browser storage cannot block replay or server saves. */ }
    const persist = () => {
      try { if (queue.length) sessionStorage.setItem(key, JSON.stringify(queue)); else sessionStorage.removeItem(key) }
      catch { /* Keep in-memory retries when browser storage is unavailable. */ }
    }
    const sample = () => {
      appendActivitySegment(segments, clock.sample(performance.now(), Date.now()))
      clock.setEligible(eligible() && queue.length < MAX_PENDING_EVENTS)
    }
    const prepare = () => {
      queue = queue.filter(event => Date.parse(event.started_at_utc) > Date.now() - 86_400_000)
      sample()
      while (segments.length && queue.length < MAX_PENDING_EVENTS) {
        const segment = segments.shift()
        const start = Math.trunc(segment.start), end = Math.trunc(segment.end)
        if (end > start) queue.push({ event_id: crypto.randomUUID(), started_at_utc: new Date(start).toISOString(), ended_at_utc: new Date(end).toISOString() })
      }
      persist()
    }
    const send = async () => {
      if (sending || disposed || !queue.length) return
      sending = true
      try {
        while (queue.length && !disposed) {
          const event = queue[0]
          const response = await scopedMutation(endpoint, workspace, { method: 'POST', headers: { ...headers, 'Idempotency-Key': event.event_id }, body: JSON.stringify(event), keepalive: true, signal: AbortSignal.timeout(8000) })
          if (!response.ok) throw new Error('activity_not_saved')
          const receipt = await response.json()
          if (receipt.schema_version !== 'replay-activity-v1' || receipt.event_id !== event.event_id || receipt.session_id !== sessionId
            || Math.abs(receipt.accepted_seconds - (Date.parse(event.ended_at_utc) - Date.parse(event.started_at_utc)) / 1000) > 0.000001
            || !Number.isFinite(receipt.accepted_seconds)) throw new Error('invalid_activity_receipt')
          // A replaced effect may already own the same outbox; its retry is idempotent.
          if (disposed) return
          queue = queue.filter(pending => pending.event_id !== event.event_id); persist()
        }
        if (!disposed) setWaiting(false)
      } catch { if (!disposed) setWaiting(true) }
      finally { sending = false }
    }
    const flush = () => { prepare(); void send() }
    const activity = () => { sample(); clock.touch(performance.now()); clock.setEligible(eligible() && queue.length < MAX_PENDING_EVENTS) }
    const events = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart']
    const attach = doc => {
      if (!doc || documents.has(doc)) return
      events.forEach(event => doc.addEventListener(event, activity, { capture: true, passive: true }))
      documents.set(doc, () => events.forEach(event => doc.removeEventListener(event, activity, true)))
    }
    const scanFrames = () => {
      const currentFrames = new Set(document.querySelectorAll('.advanced-chart-host iframe'))
      for (const [frame, detach] of frames) if (!currentFrames.has(frame)) { detach(); frames.delete(frame) }
      for (const frame of currentFrames) {
        const attachDocument = () => { try { attach(frame.contentDocument) } catch { /* Only same-origin chart input is observed. */ } }
        if (!frames.has(frame)) { frame.addEventListener('load', attachDocument); frames.set(frame, () => frame.removeEventListener('load', attachDocument)) }
        attachDocument()
      }
      for (const [doc, detach] of documents) if (doc !== document && ![...currentFrames].some(frame => frame.contentDocument === doc)) { detach(); documents.delete(doc) }
    }
    const visibility = () => { sample(); flush() }
    const focus = () => { sample(); clock.touch(performance.now()); clock.setEligible(eligible() && queue.length < MAX_PENDING_EVENTS) }
    attach(document); scanFrames()
    const observer = new MutationObserver(scanFrames)
    observer.observe(document.querySelector('.chart-canvas') || document.body, { childList: true, subtree: true })
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener('blur', visibility)
    window.addEventListener('focus', focus)
    window.addEventListener('pagehide', flush)
    const ticker = setInterval(sample, 1000), flusher = setInterval(flush, REPLAY_ACTIVITY_FLUSH_MS)
    setWaiting(queue.length > 0); void send()
    return () => {
      prepare(); void send(); disposed = true
      clearInterval(ticker); clearInterval(flusher); observer.disconnect()
      documents.forEach(detach => detach()); frames.forEach(detach => detach())
      document.removeEventListener('visibilitychange', visibility)
      window.removeEventListener('blur', visibility); window.removeEventListener('focus', focus); window.removeEventListener('pagehide', flush)
    }
  }, [workspace, sessionId, enabled])
  return waiting
}
