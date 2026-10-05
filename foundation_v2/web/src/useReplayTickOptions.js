import { useEffect, useState } from 'react'

export function useReplayTickOptions(workspace, replay) {
  const session = replay?.record_id
  const initialized = Boolean(replay?.payload?.execution)
  const scope = `${workspace}:${session}:${replay?.revision}:${initialized}`
  const [state, setState] = useState(null)
  const [mode, setMode] = useState('auto')
  const [leverage, setLeverage] = useState('100')
  useEffect(() => { setMode('auto') }, [workspace, session])
  useEffect(() => {
    if (!session || initialized) return
    const controller = new AbortController()
    fetch(`/api/v2/replay/sessions/${encodeURIComponent(session)}/tick-data`, {
      headers: { 'X-Workspace-Id': workspace }, signal: controller.signal,
    }).then(async response => {
      if (!response.ok) throw new Error('tick status unavailable')
      return response.json()
    }).then(value => { if (!controller.signal.aborted) setState({ scope, value }) })
      .catch(error => { if (!controller.signal.aborted) setState({ scope, value: { available: false, reason: 'Chưa đọc được trạng thái tick.' } }) })
    return () => controller.abort()
  }, [workspace, session, scope, initialized])
  const options = state?.scope === scope ? state.value : null
  return { options, mode, setMode, leverage, setLeverage,
    useTicks: mode === 'tick' || (mode === 'auto' && Boolean(options?.available)) }
}
