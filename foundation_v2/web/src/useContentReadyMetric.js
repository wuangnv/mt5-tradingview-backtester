import { useEffect, useRef } from 'react'
import { frontendPerformance } from './frontendPerformance.js'

// Scope only resets the local timer; it is never sent to the collector. Callers
// pass their actual read state, so a skeleton mount cannot count as data ready.
export function useContentReadyMetric(route, status, scope) {
  const finish = useRef(null)
  useEffect(() => {
    finish.current = frontendPerformance().beginNavigation(route)
    return () => { finish.current?.('aborted'); finish.current = null }
  }, [route, scope])
  useEffect(() => {
    if (status === 'loading' || status === 'idle' || status === 'refreshing') return
    let first = 0, second = 0
    first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => finish.current?.(['error', 'denied', 'blocked', 'blocked_by_data'].includes(status) ? 'error' : 'ready'))
    })
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second) }
  }, [route, scope, status])
}
