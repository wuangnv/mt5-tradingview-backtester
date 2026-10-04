import { useEffect, useRef } from 'react'

// Reconcile persisted reads on return to the app; never retries a mutation.
export default function useReadRefresh(refresh, enabled = true) {
  const latest = useRef(refresh)
  latest.current = refresh
  useEffect(() => {
    if (!enabled) return
    let last = 0
    const reconcile = () => {
      if (document.visibilityState === 'hidden' || Date.now() - last < 2000) return
      last = Date.now()
      latest.current()
    }
    window.addEventListener('focus', reconcile)
    window.addEventListener('online', reconcile)
    return () => { window.removeEventListener('focus', reconcile); window.removeEventListener('online', reconcile) }
  }, [enabled])
}
