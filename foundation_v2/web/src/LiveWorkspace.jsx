import { useEffect, useState } from 'react'
import { useTestingLocale } from './testingLocale.jsx'
import { TestingSkeleton } from './TestingReadState.jsx'
import LiveSurfaces from './LiveSurfaces.jsx'
import './live-workspace.css'

const LIVE_STATUS_URL = '/api/v2/live/status'
const LIVE_SECTIONS = Object.freeze({ calendar: 'Calendar', trades: 'Trades', notes: 'Notes', 'tag-analytics': 'Tag analytics', analytics: 'Analytics', 'trading-accounts': 'Trading accounts' })

function statusError(message, kind = 'error') {
  const error = new Error(message)
  error.kind = kind
  return error
}

async function readLiveStatus(workspace, signal) {
  const response = await fetch(LIVE_STATUS_URL, {
    method: 'GET',
    headers: { 'X-Workspace-Id': workspace },
    signal,
  })
  const payload = await response.json().catch(() => null)
  if (response.status === 404 || response.status === 501) throw statusError('live_status_unavailable', 'unavailable')
  if (!response.ok) throw statusError(String(payload?.detail || `HTTP ${response.status}`), response.status === 403 ? 'denied' : 'error')
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw statusError('invalid_live_status_payload', 'unavailable')
  if (!['ready', 'unavailable', 'locked'].includes(payload.status)) throw statusError('invalid_live_status_state', 'unavailable')
  return payload
}

function statusCopy(state) {
  if (state.status === 'loading') return { tone: 'loading', title: 'Reading account data…' }
  if (state.payload?.stale) return { tone: 'warning', title: 'Previous snapshot · connection interrupted' }
  if (state.status === 'ready') return { tone: 'ready', title: 'Synced · read only' }
  if (state.status === 'denied') return { tone: 'error', title: 'This workspace cannot read account data.' }
  if (state.status === 'unavailable') return { tone: 'muted', title: 'No account connected' }
  if (state.status === 'locked') return { tone: 'muted', title: 'Account data access is locked.' }
  return { tone: 'error', title: 'Could not read account data.' }
}

export default function LiveWorkspace({ workspace = 'tenant-a', query = new URLSearchParams(window.location.search), preview }) {
  const { t, locale } = useTestingLocale()
  const section = LIVE_SECTIONS[query.get('section')] ? query.get('section') : 'calendar'
  const [reloadToken, setReloadToken] = useState(0)
  const [snapshot, setState] = useState({ workspace, status: 'loading', payload: null })
  const state = preview ? { status: 'ready', payload: preview } : snapshot.workspace === workspace ? snapshot : { status: 'loading', payload: null }
  useEffect(() => {
    if (preview) return
    const controller = new AbortController()
    setState({ workspace, status: 'loading', payload: null })
    let refreshing = false
    const refresh = async () => {
      if (refreshing) return
      refreshing = true
      try {
        const payload = await readLiveStatus(workspace, controller.signal)
        if (!controller.signal.aborted) setState({ workspace, status: payload.status, payload: payload.status === 'ready' ? payload : null })
      } catch (error) {
        if (!controller.signal.aborted) setState(previous => ({ workspace, status: error.kind || 'error',
          payload: error.kind === 'denied' || previous.workspace !== workspace ? null : previous.payload ? { ...previous.payload, stale: true } : null, error }))
      } finally { refreshing = false }
    }
    refresh()
    const timer = setInterval(refresh, 5000)
    return () => { controller.abort(); clearInterval(timer) }
  }, [reloadToken, workspace, preview])
  const copy = statusCopy(state)
  return <section className="live-workspace wm-page" data-testid="live-workspace" aria-label={t('Live')}>
    <div className={`live-status live-status-${copy.tone}`} data-testid="live-status" role={copy.tone === 'error' ? 'alert' : 'status'}>
      <span className="live-status-dot" aria-hidden="true" /><span>{t(preview ? 'Sample account data' : copy.title)}</span>
      {!preview && ['error', 'denied', 'unavailable'].includes(state.status) && <button type="button" className="fxa-button live-retry" onClick={() => setReloadToken(value => value + 1)}>{t('Thử lại')}</button>}
    </div>
    {state.status === 'loading' ? <TestingSkeleton label="Reading account data…" /> : <LiveSurfaces key={`${workspace}:${section}:${Boolean(preview)}`} section={section} payload={state.payload} query={query} preview={Boolean(preview)} onRefresh={() => setReloadToken(value => value + 1)} />}
    <details className="live-source-details"><summary>{t('Data source and access')}</summary><dl>
      <div><dt>{t('Workspace')}</dt><dd>{workspace}</dd></div>
      <div><dt>{t('Source')}</dt><dd>{state.payload?.source || '—'}</dd></div>
      <div><dt>{t('Last snapshot (UTC)')}</dt><dd>{state.payload?.captured_at_utc ? new Date(state.payload.captured_at_utc).toLocaleString(locale, { timeZone: 'UTC' }) : '—'}</dd></div>
      <div><dt>{t('History from (UTC)')}</dt><dd>{state.payload?.history_from_utc ? new Date(state.payload.history_from_utc).toLocaleString(locale, { timeZone: 'UTC' }) : '—'}</dd></div>
    </dl><p>{t('Account data is read only. This page does not send orders or connect a broker.')}</p></details>
  </section>
}

export { LIVE_SECTIONS, readLiveStatus, statusCopy }
