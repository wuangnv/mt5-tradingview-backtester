// A layout snapshot is only clean if no newer edit or replay generation replaced it.
export function createChartSave({ snapshot, persist, context, onState, delay = 5000, timeout = 10000 }) {
  let disposed = false, revision = 0, attempt = 0, timer, watchdog, state = 'saved'
  const publish = value => { state = value; if (!disposed) onState(value) }
  const save = () => {
    if (disposed || state === 'saved' || state === 'saving') return
    clearTimeout(timer)
    const request = ++attempt, edit = revision, scope = context()
    publish('saving')
    const fail = () => { if (!disposed && request === attempt) { attempt++; clearTimeout(watchdog); publish('error') } }
    watchdog = setTimeout(fail, timeout)
    try {
      snapshot(layout => {
        if (disposed || request !== attempt) return
        clearTimeout(watchdog)
        const current = context()
        if (scope.generation !== current.generation || scope.cutoff !== current.cutoff) { dirty(); return }
        try { persist(scope.cutoff, layout) } catch { fail(); return }
        if (edit === revision) publish('saved')
        else { publish('dirty'); timer = setTimeout(save, delay) }
      })
    } catch { fail() }
  }
  const dirty = () => {
    if (disposed) return
    revision++
    // Invalidate in-flight callbacks rather than marking an older snapshot as saved.
    attempt++; clearTimeout(watchdog); clearTimeout(timer)
    publish('dirty'); timer = setTimeout(save, delay)
  }
  return { save, dirty, dispose: () => { disposed = true; attempt++; clearTimeout(timer); clearTimeout(watchdog) } }
}
