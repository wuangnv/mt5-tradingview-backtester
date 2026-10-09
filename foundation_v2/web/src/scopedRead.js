// Share only requests that are currently in flight. Persisting responses would
// require a server revision/invalidation contract and could expose stale data.
const pending = new Map()

export function scopedRead(path, workspace, signal) {
  if (signal?.aborted) return Promise.reject(signal.reason || new DOMException('Aborted', 'AbortError'))
  const key = JSON.stringify([workspace, path])
  let entry = pending.get(key)
  if (!entry) {
    const controller = new AbortController()
    entry = { controller, consumers: 0 }
    entry.promise = fetch(path, { headers: { 'X-Workspace-Id': workspace }, signal: controller.signal }).then(async response => ({
      body: await response.arrayBuffer(), status: response.status, statusText: response.statusText, headers: response.headers,
    })).finally(() => {
      if (pending.get(key) === entry) pending.delete(key)
    })
    pending.set(key, entry)
  }
  entry.consumers += 1
  return new Promise((resolve, reject) => {
    let finished = false
    const release = () => {
      if (finished) return false
      finished = true
      signal?.removeEventListener('abort', abort)
      entry.consumers -= 1
      if (!entry.consumers && pending.get(key) === entry) {
        pending.delete(key)
        entry.controller.abort()
      }
      return true
    }
    const abort = () => { if (release()) reject(signal.reason || new DOMException('Aborted', 'AbortError')) }
    signal?.addEventListener('abort', abort, { once: true })
    entry.promise.then(response => {
      if (release()) resolve(new Response([204, 205, 304].includes(response.status) ? null : response.body, response))
    }, error => { if (release()) reject(error) })
  })
}
