import React, { useMemo, useState } from 'react'
import { buildAnalyticsModel } from './AnalyticsWorkspace.jsx'
import { FxAnalyticsFilters, FxAnalyticsReport, Metric, fmt } from './FxAnalytics.jsx'
import FxTradeLedger, { TradeInspector } from './FxTradeLedger.jsx'
import FxSelect from './FxSelect.jsx'
import SessionFilter from './SessionFilter.jsx'
import SessionPerformance from './SessionPerformance.jsx'
import DashboardSessions from './DashboardSessions.jsx'
import { SessionActions, SessionActionDialog } from './SessionActions.jsx'
import SessionSettingsDrawer from './SessionSettingsDrawer.jsx'
import { SessionSummaryCard, SessionDescriptionCard } from './SessionDetails.jsx'
import { SessionSelect } from './SessionPicker.jsx'
import MarketAssetCatalog from './MarketAssetCatalog.jsx'
import LiveBrokerSnapshot from './LiveBrokerSnapshot.jsx'
import { PlaybookList, PlaybookSummary } from './PlaybookWorkspace.jsx'
import { JournalRow, StoryRail } from './JournalWorkspace.jsx'
import { DEFAULT_EXTRA_FILTERS, filterAnalyticsRows, tradesCsv } from './tradingAnalyticsModel.js'
import { buildWorkspaceHref } from './workspaceContext.js'
import { DEMO_SESSIONS, DEMO_LEDGER, DEMO_ASSETS, DEMO_LIVE, DEMO_DATASETS, demoDashboardAnalytics, demoReplayContext, demoResult, demoOverview, demoFilterRows } from './demoFixtures.js'

function Objectives({ model }) {
  return <section className="fxa-prop-objectives" aria-label="Challenge objectives"><div className="fxa-section-heading"><h2>Challenge objectives</h2><span>Practice · Phase 1</span></div><div className="fxa-metrics"><Metric label="Balance" value={fmt(model.endingBalance, ' USD')} /><Metric label="Profit target" value="1.000 USD" /><Metric label="Daily loss limit" value="500 USD" /><Metric label="Overall loss limit" value="1.000 USD" /></div><table><thead><tr><th>Objective</th><th>Kết quả / ngưỡng</th><th>Trạng thái</th></tr></thead><tbody><tr><td>Profit target</td><td>{fmt(model.netPnl, ' USD')} / 1.000 USD</td><td>{model.netPnl >= 1000 ? 'Đạt' : 'Đang thực hiện'}</td></tr><tr><td>Overall drawdown</td><td>{fmt(model.maxDrawdown, ' USD')} / 1.000 USD</td><td>{model.maxDrawdown < 1000 ? 'Trong giới hạn' : 'Vi phạm'}</td></tr></tbody></table></section>
}

function DemoReports({ ledgerOnly, prop = false, query }) {
  const [ids, setIds] = useState(ledgerOnly ? null : DEMO_SESSIONS.find(item => item.record_id === query?.get('demo_session'))?.record_id || DEMO_SESSIONS[0].record_id)
  const [filters, setFilters] = useState({ side: 'all', outcome: 'all', from: '', to: '' })
  const [extra, setExtra] = useState({ ...DEFAULT_EXTRA_FILTERS })
  const [selected, setSelected] = useState(''), [config, setConfig] = useState({ stop_distance_ticks: 10, stop_multiplier: 1, target_r: 2 })
  const model = useMemo(() => {
    const rows = demoFilterRows(ledgerOnly ? ids : [ids], filters)
    return buildAnalyticsModel({ ...demoResult(rows, DEMO_SESSIONS.find(item => item.record_id === ids)), multi_session: ledgerOnly }, prop ? 'prop' : 'app')
  }, [ids, filters, ledgerOnly, prop])
  const row = model.ledger.find(item => item.tradeId === selected)
  const exportCsv = () => {
    const blob = new Blob([tradesCsv(filterAnalyticsRows(model.ledger, extra), 'USD', { source: 'UI demo' })], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob), anchor = document.createElement('a')
    anchor.href = url; anchor.download = 'demo-trades.csv'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const Inspector = ledgerOnly ? TradeInspector : 'section'
  const renderFilters = columnControl => <FxAnalyticsFilters persistInUrl={false} sourceType={prop ? 'Prop firm' : 'Backtesting'} columnControl={columnControl} ledgerOnly={ledgerOnly} filters={filters} onChange={patch => { setFilters(value => ({ ...value, ...patch })); setSelected('') }} extra={extra} onExtra={patch => setExtra(value => ({ ...value, ...patch }))} rows={model.ledger} onExport={exportCsv} sessionControl={<SessionFilter items={DEMO_SESSIONS} multiple={ledgerOnly} value={ids} onChange={value => { setIds(value); setSelected('') }} />} onClearSessions={() => setIds(ledgerOnly ? null : DEMO_SESSIONS[0].record_id)} />
  return <section className="wm-page as-page" aria-label={ledgerOnly ? 'Trades' : 'Analytics'}>
    <h1 className="sr-only">{ledgerOnly ? 'Trades' : 'Analytics'}</h1>
    {ledgerOnly ? <FxTradeLedger model={model} extra={extra} selected={selected} onSelect={setSelected} renderFilters={renderFilters} /> : renderFilters()}
    {prop && <Objectives model={model} />}
    {!ledgerOnly && <div className="fxa-report"><FxAnalyticsReport model={model} extra={extra} experimentStatus="unavailable" config={config} onConfig={setConfig} selected={selected} onSelect={setSelected} /></div>}
    {row && <Inspector onClose={() => setSelected('')} className="fxa-trade-inspector" aria-label="Chi tiết giao dịch"><div className="fxa-section-heading"><h2>{row.session_name} · {row.symbol}</h2><button className="fxa-button" type="button" onClick={() => setSelected('')}>Đóng chi tiết</button></div><div className="fxa-metrics"><Metric label="Net P/L" value={fmt(row.net_pnl, ' USD')} /><Metric label="Return (R)" value={fmt(row.realized_r, ' R')} /><Metric label="Entry" value={fmt(row.price_open, '', 6)} /><Metric label="Exit" value={fmt(row.price_close, '', 6)} /></div></Inspector>}
  </section>
}

function DemoSessions({ workspace, query }) {
  const [items, setItems] = useState(DEMO_SESSIONS)
  const [id, setId] = useState(DEMO_SESSIONS.find(item => item.record_id === query.get('demo_session'))?.record_id || DEMO_SESSIONS[0].record_id)
  const [editing, setEditing] = useState(false), [actionDialog, setActionDialog] = useState(null)
  const item = items.find(item => item.record_id === id)
  const payload = useMemo(() => item ? demoDashboardAnalytics(item, workspace) : null, [item, workspace])
  const model = useMemo(() => item ? buildAnalyticsModel(demoResult(payload.ledger, item)) : null, [payload, item])
  const dataset = DEMO_DATASETS.find(entry => entry.dataset_id === item?.dataset_id), replayRecord = item ? demoReplayContext(item) : null
  const href = (view, overrides = {}) => buildWorkspaceHref(view, workspace, query, { demo_session: id, select: '1', analytics_source: 'sessions', ...overrides })
  const save = draft => { setItems(current => current.map(entry => entry.record_id === id ? { ...entry, ...draft, revision: entry.revision + 1 } : entry)); setEditing(false); return true }
  const select = value => { setId(value); const url = new URL(window.location.href); if (value) url.searchParams.set('demo_session', value); else url.searchParams.delete('demo_session'); window.history.replaceState(null, '', url) }
  const mutate = action => {
    const next = action === 'delete' ? items.filter(entry => entry.record_id !== id) : items.map(entry => entry.record_id === id ? { ...entry, archived: !entry.archived, revision: entry.revision + 1 } : entry)
    setItems(next); setActionDialog(null)
    if (action === 'delete') select(next.find(entry => !entry.archived)?.record_id || next[0]?.record_id || '')
  }
  return <section className="wm-page fx-session-picker fxr-integrated-sessions fxs-page" aria-label="Sessions">
    <h1 className="sr-only">Sessions</h1>
    <div className="fxr-session-toolbar">
      <SessionSelect selected={id} catalog={{ status: 'ready', items }} onSelect={select} balance={fmt(model?.endingBalance, ' USD')} />
      <div className="fxr-session-actions">
        <button className="fxr-button fxr-button-primary" disabled type="button">＋ Phiên mới</button>
        {item && <><FxSelect className="fxs-analytics-button" label="Mở Analytics" value="session" triggerContent="Analytics" options={[{ value: 'session', label: 'Analytics phiên' }, { value: 'prop', label: 'Prop Firm' }]} onChange={value => window.location.assign(href('analytics', { analytics_source: value === 'prop' ? 'prop' : 'sessions' }))} />
        <button className="fxr-button fxr-button-secondary fxs-settings" type="button" onClick={() => setEditing(true)}>Cài đặt phiên</button>
        <SessionActions item={item} onAction={action => setActionDialog(action)} /></>}
      </div>
    </div>
    {item ? <><div className="fxr-session-cards">
      <SessionSummaryCard item={item} dataset={dataset} payload={payload} model={model} replayRecord={replayRecord} preview />
      <SessionDescriptionCard item={item} onSave={description => save({ description })} />
    </div>
    <div className="fxr-session-report"><SessionPerformance model={model} item={item} payload={payload} href={href} /></div>
    </> : <div className="fxr-empty-state"><h2>Chưa có phiên trong bản xem thử</h2><p>Tải lại trang để xem lại các phiên demo.</p></div>}
    {actionDialog && item && <SessionActionDialog key={actionDialog + id} mode={actionDialog} item={item} preview onClose={() => setActionDialog(null)} onSubmit={mutate} />}
    {editing && item && <SessionSettingsDrawer item={item} dataset={dataset} payload={payload} model={model} replayRecord={replayRecord} workspace={workspace} preview onClose={() => setEditing(false)} onSubmit={save} />}
  </section>
}

function DemoDashboard({ workspace, query }) {
  const preview = useMemo(() => ({ items: DEMO_SESSIONS, datasets: DEMO_DATASETS, analytics: demoDashboardAnalytics, replayContext: demoReplayContext,
    overview: (filters, items) => demoOverview(demoFilterRows(filters.session ? [items.find(item => item.record_id === filters.session)?.source_record_id || filters.session] : [...new Set(items.map(item => item.source_record_id || item.record_id))], filters)),
    propReport: <DemoReports prop /> }), [])
  return <section className="fx-dashboard" aria-label="Dashboard"><div className="fx-dashboard-inner"><DashboardSessions workspace={workspace} query={query} preview={preview} /></div></section>
}
const demoPlaybooks = DEMO_SESSIONS.map(item => ({ ...item, payload: { name: item.name, status: 'draft', execution_capability: 'replay_only', rules: { entry: 'breakout', exit: '2R', risk: '1%' } } }))
const demoNotes = DEMO_LEDGER.slice(0, 6).map(row => ({ record_id: row.trade_id, revision: 1, updated_at_utc: row.close_time_utc, payload: { entry_type: 'decision', note: `${row.session_name} · ${row.symbol}: chờ đóng nến xác nhận`, observation: 'Giá quay về vùng breakout', decision: 'Giữ rủi ro 1% theo kế hoạch', plan: 'SL ngoài vùng, mục tiêu 2R', actual_result: `${row.net_pnl} USD`, next_action: 'Đối chiếu entry với checklist', tags: row.tags, source: { type: 'replay_session', id: row.session_id } } }))

function DemoStrategies() {
  const [id, setId] = useState(demoPlaybooks[0].record_id)
  return <section className="pb-page wm-page" aria-label="Strategies"><h1>My strategies</h1><div className="pb-workspace-grid"><PlaybookList items={demoPlaybooks} selectedId={id} onSelect={setId} /><PlaybookSummary record={demoPlaybooks.find(item => item.record_id === id)} preview /></div></section>
}
function DemoJournal() {
  const [record, setRecord] = useState(demoNotes[0])
  return <section className="ja-page journal-page ja-story-page wm-page" aria-label="Journal"><h1>Journal</h1><div className="ja-workspace-grid"><div className="ja-list">{demoNotes.map(item => <JournalRow key={item.record_id} record={item} selected={record.record_id === item.record_id} onSelect={setRecord} />)}</div><StoryRail record={record} context={{}} /></div></section>
}
function DemoLive({ query }) {
  const section = query.get('section') || 'calendar'
  if (section === 'trades' || section === 'trading-accounts') return <section className="wm-page live-workspace" aria-label="Live"><LiveBrokerSnapshot payload={DEMO_LIVE} section={section} preview /></section>
  if (section === 'notes') return <DemoJournal />
  if (section === 'tag-analytics') return <DemoReports />
  return <section className="wm-page live-workspace" aria-label="Market calendar"><h1>Market calendar</h1><div className="live-table-scroll" role="region" tabIndex={0} aria-label="Lịch sự kiện mẫu"><table><thead><tr><th>UTC</th><th>Currency</th><th>Event</th><th>Impact</th><th>Previous</th><th>Forecast</th></tr></thead><tbody>{[['08:00', 'EUR', 'Services PMI', 'Medium', '52,3', '52,5'], ['12:30', 'USD', 'Non-farm payrolls', 'High', '142K', '150K'], ['14:00', 'USD', 'ISM services', 'High', '51,5', '52,0']].map(([time, ...values]) => <tr key={time}><td>{time}</td>{values.map((value, i) => <td key={i}>{value}</td>)}</tr>)}</tbody></table></div></section>
}

export default function DemoPreview({ view, workspace, query }) {
  if (view === 'overview') return <DemoDashboard workspace={workspace} query={query} />
  if (view === 'replay') return <DemoSessions workspace={workspace} query={query} />
  if (view === 'trade') return <DemoReports ledgerOnly />
  if (view === 'analytics' || view === 'testing' || view === 'prop') return <DemoReports query={query} prop={view !== 'analytics' || query.get('analytics_source') === 'prop'} />
  if (view === 'market-data') return <main className="wm-page market-data-workspace" aria-label="Market Data"><MarketAssetCatalog workspace={workspace} query={query} showHeading={false} preview={DEMO_ASSETS} /></main>
  if (view === 'live') return <DemoLive query={query} />
  if (view === 'playbook') return <DemoStrategies />
  return <DemoJournal />
}
