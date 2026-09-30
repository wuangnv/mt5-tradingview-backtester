import React, { useMemo, useState } from 'react'
import { buildWorkspaceHref } from './workspaceContext.js'
import './session-picker.css'

const COPY = {
  replay: {
    title: 'Select session',
    subtitle: 'Choose a backtesting session to continue.',
    action: 'Open session',
    newAction: 'Create a new session',
  },
  trade: {
    title: 'Select session',
    subtitle: 'Choose a session before opening Trades.',
    action: 'Open trades',
    newAction: 'Choose a session in Testing',
  },
  analytics: {
    title: 'Select session',
    subtitle: 'Choose the replay context for this workspace.',
    action: 'Open analytics',
    newAction: 'Choose a session in Testing',
  },
}

function safeLastSession(workspace) {
  if (typeof window === 'undefined') return ''
  try { return window.localStorage.getItem(`tw:replay:last:${workspace}`) || '' } catch { return '' }
}

export default function SessionPicker({ kind = 'replay', workspace = 'tenant-a', query = new URLSearchParams() }) {
  const copy = COPY[kind] || COPY.replay
  const requestedSession = query.get('session') || query.get('replay_session') || ''
  const lastSession = safeLastSession(workspace)
  const initialSession = requestedSession || lastSession
  const [selectedSession, setSelectedSession] = useState(initialSession || '__new__')
  const selected = selectedSession !== '__new__' ? selectedSession : ''
  const href = useMemo(() => {
    const view = kind === 'replay' ? 'replay' : kind
    if (!selected) {
      return buildWorkspaceHref('replay', workspace, query, {
        surface: 'workspace',
        fresh: '1',
        session: null,
        dataset: null,
        cursor: null,
        cutoff: null,
      })
    }
    return buildWorkspaceHref(view, workspace, query, {
      surface: 'workspace',
      session: selected,
      cursor: null,
      cutoff: null,
    })
  }, [kind, query, selected, workspace])
  const newHref = buildWorkspaceHref('replay', workspace, query, {
    surface: 'workspace',
    fresh: '1',
    session: null,
    dataset: null,
    cursor: null,
    cutoff: null,
  })

  return (
    <section className="fx-session-picker" aria-labelledby="session-picker-title" data-testid={`${kind}-session-picker`}>
      <div className="fx-session-picker-head">
        <div>
          <span className="fx-eyebrow">{kind === 'replay' ? 'SESSIONS' : kind.toUpperCase()}</span>
          <h1 id="session-picker-title">{copy.title}</h1>
          <p>{copy.subtitle}</p>
        </div>
        <a className="fx-session-picker-new" href={newHref}>{copy.newAction}</a>
      </div>

      <div className="fx-session-picker-panel">
        <label className="fx-session-picker-label" htmlFor={`${kind}-session-select`}>Session</label>
        <select id={`${kind}-session-select`} value={selectedSession} onChange={(event) => setSelectedSession(event.target.value)}>
          {initialSession && <option value={initialSession}>{initialSession}</option>}
          <option value="__new__">New backtesting session</option>
        </select>
        <div className={`fx-session-picker-card ${selected ? 'is-ready' : ''}`}>
          <div className="fx-session-picker-mark" aria-hidden="true">{selected ? '✓' : '+'}</div>
          <div className="fx-session-picker-copy">
            <strong>{selected || 'No session selected'}</strong>
            <small>{selected ? 'Local replay context · broker locked' : 'Start from Testing to create a replay session'}</small>
          </div>
          <a className="fx-session-picker-action" href={href}>{selected ? copy.action : 'Start session'}</a>
        </div>
      </div>
    </section>
  )
}
