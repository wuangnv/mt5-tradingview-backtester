import React, { useMemo, useState } from 'react'
import { buildWorkspaceHref } from './workspaceContext.js'
import './session-picker.css'

const COPY = {
  replay: { action: 'Go to chart', newAction: 'New session' },
  trade: { action: 'Open trades', newAction: 'New session' },
  analytics: { action: 'Open analytics', newAction: 'New session' },
}

function safeLastSession(workspace) {
  if (typeof window === 'undefined') return ''
  try { return window.localStorage.getItem(`tw:replay:last:${workspace}`) || '' } catch { return '' }
}

function sessionHref(kind, workspace, query, selected) {
  const view = kind === 'replay' ? 'replay' : kind
  return buildWorkspaceHref(view, workspace, query, {
    surface: 'workspace',
    session: selected,
    cursor: null,
    cutoff: null,
  })
}

function NewSessionLink({ href, children }) {
  return <a className="fxr-button fxr-button-primary" href={href}><span aria-hidden="true">＋</span>{children}</a>
}

function sessionMarket(query) {
  const requested = query?.get?.('symbol') || query?.get?.('instrument') || ''
  return requested.trim() || 'EURUSD'
}

function SessionSelect({ kind, selected, query, onSelect, compact = false }) {
  const id = `fxr-${kind}-session-select`
  const market = sessionMarket(query)
  const dataset = query?.get?.('dataset') || ''
  const selectedLabel = selected || 'Select session'

  return (
    <div className={`fxr-session-control ${compact ? 'is-compact' : ''}`}>
      <label htmlFor={id}>{compact ? 'Sessions' : 'Select session'}</label>
      <div className="fxr-session-select-card">
        <select
          id={id}
          value={selected || '__new__'}
          onChange={(event) => onSelect?.(event.target.value === '__new__' ? '' : event.target.value)}
          aria-label={compact ? 'Select session' : 'Select backtesting session'}
        >
          {selected && <option value={selected}>{selected}</option>}
          <option value="__new__">New backtesting session</option>
        </select>
        <div className="fxr-session-select-details" aria-hidden="true">
          <strong>{selectedLabel}</strong>
          <span>{selected ? market : 'Local backtesting'}</span>
          {selected && dataset && <span>{dataset}</span>}
        </div>
        <span className="fxr-select-chevron" aria-hidden="true">⌄</span>
      </div>
    </div>
  )
}

function SessionToolbar({ kind, selected, workspace, query, newHref, onSelect }) {
  const copy = COPY[kind] || COPY.replay
  const analyticsHref = buildWorkspaceHref('analytics', workspace, query, { surface: 'workspace', session: selected || null })
  return (
    <div className="fxr-session-toolbar">
      <SessionSelect kind={kind} selected={selected} query={query} onSelect={onSelect} />
      <div className="fxr-session-actions">
        <NewSessionLink href={newHref}>{copy.newAction}</NewSessionLink>
        <a className="fxr-button fxr-button-secondary" href={analyticsHref}>Analytics <span aria-hidden="true">⌄</span></a>
        <button className="fxr-text-button" type="button" disabled={!selected}>Session Settings</button>
        <button className="fxr-button fxr-button-danger" type="button" disabled={!selected}>Delete session</button>
      </div>
    </div>
  )
}

function SessionsSurface({ selected, workspace, query, newHref, onSelect }) {
  return (
    <div className="fxr-sessions-surface" data-testid="replay-session-dashboard">
      <SessionToolbar kind="replay" selected={selected} workspace={workspace} query={query} newHref={newHref} onSelect={onSelect} />
      <div className="fxr-session-cards">
        <article className="fxr-session-card fxr-session-summary-card">
          <div>
            <h2>{selected || 'Select a session'}</h2>
            <p>{selected ? `${sessionMarket(query)} · local session` : 'Choose a local session to begin.'}</p>
            <div className="fxr-session-date">{query.get('dataset') || 'Dataset not selected'} <span className="fxr-muted-pill">Local</span></div>
            <a className="fxr-button fxr-button-primary fxr-chart-button" href={selected ? sessionHref('replay', workspace, query, selected) : newHref}>Go to chart <span aria-hidden="true">▶</span></a>
          </div>
          <div className="fxr-balance">
            <span>Account balance</span>
            <strong>—</strong>
          </div>
        </article>
        <article className="fxr-session-card fxr-description-card">
          <h2>Description</h2>
          <button className="fxr-edit-button" type="button" disabled={!selected} aria-label="Edit description">✎</button>
          <p>{selected ? 'No description added yet.' : 'Select a session to see its description.'}</p>
        </article>
      </div>
      <p className="fxr-no-analytics">No analytics here yet.</p>
      <div className="fxr-metrics-grid" aria-label="Session metrics">
        {['Total PnL', 'Win Rate', 'Risk/Reward', 'Month Gain/Loss', 'Week Gain/Loss', 'Daily Gain/Loss'].map((metric) => (
          <article className="fxr-metric-card" key={metric}><span>{metric}</span><strong>{metric === 'Win Rate' ? '0%' : metric === 'Risk/Reward' ? '0.00' : '—'}</strong><i aria-hidden="true">i</i></article>
        ))}
      </div>
      <div className="fxr-recent-trades">
        <div className="fxr-section-title"><h2>Recent Trades</h2><button className="fxr-button fxr-button-secondary" type="button" disabled>▤ Journal</button></div>
        <div className="fxr-empty-state"><div className="fxr-empty-glyph" aria-hidden="true">▤</div><strong>No trades taken yet</strong><span>Get started by placing some orders</span><a className="fxr-button fxr-button-primary" href={selected ? sessionHref('replay', workspace, query, selected) : newHref}>Go to chart <span aria-hidden="true">→</span></a></div>
      </div>
    </div>
  )
}

function CompactTradeToolbar({ kind = 'trade', selected, query, onSelect, newHref }) {
  return (
    <div className="fxr-table-toolbar fxr-compact-session-toolbar">
      <SessionSelect kind={kind} selected={selected} query={query} onSelect={onSelect} compact />
      <div><button className="fxr-round-button" type="button" aria-label="Refresh">↻</button><button className="fxr-round-button" type="button" aria-label="Edit">⌕</button><span className="fxr-filter-label">Filter by</span><button className="fxr-filter-button" type="button">Basic</button><button className="fxr-filter-button" type="button">Tags</button>{!selected && <a className="fxr-button fxr-button-primary fxr-compact-new" href={newHref}>＋ New session</a>}</div>
    </div>
  )
}

const TRADE_COLUMNS = ['Actions', 'Session', 'Type', 'Source', 'Entry Date (Realtime)', 'Entry Date (Chart)', 'Asset', 'Side', 'Entry type', 'Return ($)', 'Return (%)', 'Return (R)', 'Trade Rating', 'Entry price', 'Size', 'Stop loss', 'Take profit', 'Exit date', 'Exit price', 'Gross PnL', 'Fees']
const DEMO_TRADES = [
  ['▣', 'MK-02', 'Closed', '—', '9/21/26, 12:02:33 PM', '1/17/26, 12:59:55 AM', 'OANDA:EURUSD', 'Sell', 'market', '↙ -74,54', '-0.75%', '-0.74', '—', '1.73561', '45,000', '1.73896', '1.72826', '1/19/26, 6:46:20 AM', '1.73089', '↙ -74,54', '0'],
  ['▣', 'MK-02', 'Closed', '—', '9/21/26, 8:58:54 AM', '1/15/26, 8:49:55 PM', 'OANDA:EURUSD', 'Buy', 'market', '↙ -100,19', '-1%', '-1', '—', '1.73718', '92,000', '1.73555', '1.74534', '1/15/26, 9:55:10 PM', '1.73555', '↙ -100,19', '0'],
  ['▣', 'MK-02', 'Closed', '—', '9/20/26, 1:48:18 PM', '1/15/26, 7:39:55 AM', 'OANDA:EURUSD', 'Sell', 'market', '↙ -99,97', '-1%', '-1', '—', '1.74132', '86,000', '1.74306', '1.73778', '1/15/26, 9:51:50 AM', '1.74306', '↙ -99,97', '0'],
  ['▣', 'MK-02', 'Closed', '—', '9/17/26, 10:35:11 AM', '1/6/26, 5:29:55 PM', 'OANDA:EURUSD', 'Sell', 'market', '↗ 243,96', '2.44%', '2.44', '—', '1.74364', '92,000', '1.74526', '1.73969', '1/6/26, 9:36:40 PM', '1.73969', '↗ 243,96', '0'],
  ['▣', 'MK-02', 'Closed', '—', '9/17/26, 10:26:54 AM', '1/3/26, 1:14:55 AM', 'OANDA:EURUSD', 'Buy', 'market', '↗ 214,03', '2.14%', '2.15', '—', '1.75478', '81,000', '1.75662', '1.75082', '1/3/26, 3:57:55 AM', '1.75082', '↗ 214,03', '0'],
]

function TradesSurface({ selected, workspace, query, newHref, onSelect }) {
  const showDemoRows = query.get('dataset') === 'ui-replay-fixture' || selected === 'replay-fixture'
  return (
    <div className="fxr-trades-surface" data-testid="trade-session-dashboard">
      <CompactTradeToolbar selected={selected} query={query} onSelect={onSelect} newHref={newHref} />
      <div className="fxr-table-wrap"><table className="fxr-trades-table"><thead><tr>{TRADE_COLUMNS.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{showDemoRows ? DEMO_TRADES.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex} className={cell === 'Buy' ? 'fxr-buy' : cell === 'Sell' ? 'fxr-sell' : cell.includes('↗') ? 'fxr-positive' : cell.includes('↙') ? 'fxr-negative' : ''}>{cellIndex === 2 ? <span className="fxr-status-badge">{cell}</span> : cellIndex === 7 ? <span className={`fxr-side-badge ${cell === 'Buy' ? 'is-buy' : 'is-sell'}`}>{cell}</span> : cellIndex === 8 ? <span className="fxr-type-badge">{cell}</span> : cell}</td>)}</tr>) : <tr><td colSpan={TRADE_COLUMNS.length}><div className="fxr-table-empty">No trades recorded for this session.</div></td></tr>}</tbody></table></div>
      <div className="fxr-table-pagination"><span>‹‹</span><span>‹</span><strong>1</strong><span>2</span><span>›</span><span>››</span><select aria-label="Rows per page"><option>10</option></select></div>
    </div>
  )
}

function AnalyticsSurface({ selected, workspace, query, newHref, onSelect }) {
  const filters = ['Type', 'Assets', 'Side', 'Outcome', 'Tags', 'Session', 'Strategy', 'Day', 'Time', 'Timezone', 'Backtesting Date']
  return (
    <div className="fxr-analytics-surface" data-testid="analytics-session-dashboard">
      <div className="fxr-analytics-session-toolbar">
        <SessionSelect kind="analytics" selected={selected} query={query} onSelect={onSelect} compact />
        <div className="fxr-session-actions"><NewSessionLink href={newHref}>New session</NewSessionLink></div>
      </div>
      <div className="fxr-analytics-subtabs" role="tablist"><button className="is-active" type="button" role="tab" aria-selected="true">Sessions</button><button type="button" role="tab" aria-selected="false">Prop firm</button></div>
      <div className="fxr-filter-panel"><div className="fxr-filter-row">{filters.map((filter) => <button className="fxr-filter-pill" type="button" key={filter}>{filter}<span aria-hidden="true">⌄</span></button>)}<button className="fxr-apply-button" type="button">Apply</button><button className="fxr-round-button" type="button" aria-label="Download">⇩</button><button className="fxr-share-button" type="button">♧ Share</button></div><div className="fxr-applied-chips"><span>long, short</span><span>wins, losses</span><span>Asia/Ho_Chi_Minh</span><span>00:00 - 23:59</span><span>Backtesting, Battles, &amp; Prop Firm</span><button type="button">♲ Clear filters</button></div></div>
      <div className="fxr-analytics-empty" data-testid="analytics-empty"><div className="fxr-empty-chart" aria-hidden="true"><span /><span /><span /><span /><span /></div><h2>No session analytics yet!</h2><p>Start applying filters to generate your first performance<br className="fxr-desktop-only" /> insights and track your trading progress.</p><NewSessionLink href={newHref}>New session</NewSessionLink><a href={newHref}>Show demo data</a></div>
    </div>
  )
}

export default function SessionPicker({ kind = 'replay', workspace = 'tenant-a', query = new URLSearchParams() }) {
  const requestedSession = query.get('session') || query.get('replay_session') || ''
  const lastSession = safeLastSession(workspace)
  const initialSession = requestedSession || lastSession
  const [selectedSession, setSelectedSession] = useState(initialSession || '')
  const newHref = useMemo(() => buildWorkspaceHref('replay', workspace, query, { surface: 'workspace', fresh: '1', session: null, dataset: null, cursor: null, cutoff: null }), [query, workspace])
  const selected = selectedSession
  return (
    <section className={`fx-session-picker fxr-${kind}-picker`} aria-label={`${kind} session selector`} data-testid={`${kind}-session-picker`}>
      {kind === 'replay' ? <SessionsSurface selected={selected} workspace={workspace} query={query} newHref={newHref} onSelect={setSelectedSession} /> : kind === 'trade' ? <TradesSurface selected={selected} workspace={workspace} query={query} newHref={newHref} onSelect={setSelectedSession} /> : <AnalyticsSurface selected={selected} workspace={workspace} query={query} newHref={newHref} onSelect={setSelectedSession} />}
    </section>
  )
}
