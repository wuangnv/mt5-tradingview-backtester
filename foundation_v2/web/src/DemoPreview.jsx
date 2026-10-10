import { navigate } from './clientNavigation.js'
import { useTestingLocale } from './testingLocale.jsx'
import { useEffect, useMemo, useState } from 'react'
import { buildAnalyticsModel } from './AnalyticsWorkspace.jsx'
import { FxAnalyticsFilters, FxAnalyticsReport, Metric } from './FxAnalytics.jsx'
import FxTradeLedger, { TradeInspector } from './FxTradeLedger.jsx'
import FxSelect from './FxSelect.jsx'
import TestingIcon from './TestingIcon.jsx'
import SessionFilter from './SessionFilter.jsx'
import SessionPerformance from './SessionPerformance.jsx'
import DashboardSessions from './DashboardSessions.jsx'
import { SessionActions, SessionActionDialog } from './SessionActions.jsx'
import SessionSettingsDrawer from './SessionSettingsDrawer.jsx'
import { SessionSummaryCard, SessionDescriptionCard } from './SessionDetails.jsx'
import { SessionSelect } from './SessionPicker.jsx'
import DataDeskWorkspace from './DataDeskWorkspace.jsx'
import LiveWorkspace from './LiveWorkspace.jsx'
import { PlaybookList, PlaybookSummary } from './PlaybookWorkspace.jsx'
import { JournalRow, StoryRail } from './JournalWorkspace.jsx'
import { DEFAULT_EXTRA_FILTERS, filterAnalyticsRows, tradesCsv } from './tradingAnalyticsModel.js'
import { buildWorkspaceHref } from './workspaceContext.js'
import { DEMO_SESSIONS, DEMO_MANY_SESSIONS, DEMO_LEDGER, DEMO_LIVE, DEMO_DATASETS, demoSessionItems, demoDashboardAnalytics, demoReplayContext, demoResult, demoOverview, demoFilterRows } from './demoFixtures.js'
const DEMO_DATA_LIBRARY = { datasets:DEMO_DATASETS, providers:[] }

function Objectives({ model }) {


  const { t, fmt } = useTestingLocale()

  return <section className="fxa-prop-objectives" aria-label={t("Challenge objectives")}><div className="fxa-section-heading"><h2>{t("Challenge objectives")}</h2><span>{t("Practice · Phase 1")}</span></div><div className="fxa-metrics"><Metric label={t("Balance")} value={fmt(model.endingBalance, t(" USD"))} /><Metric label={t("Profit target")} value={fmt(1000, ' USD')} /><Metric label={t("Daily loss limit")} value={fmt(500, ' USD')} /><Metric label={t("Overall loss limit")} value={fmt(1000, ' USD')} /></div><table><thead><tr><th>{t("Objective")}</th><th>{t("Kết quả / ngưỡng")}</th><th>{t("Trạng thái")}</th></tr></thead><tbody><tr><td>{t("Profit target")}</td><td>{fmt(model.netPnl, t(" USD"))} / {fmt(1000, ' USD')}</td><td>{model.netPnl >= 1000 ? t("Đạt") : t("Đang thực hiện")}</td></tr><tr><td>{t("Overall drawdown")}</td><td>{fmt(model.maxDrawdown, t(" USD"))} / {fmt(1000, ' USD')}</td><td>{model.maxDrawdown < 1000 ? t("Trong giới hạn") : t("Vi phạm")}</td></tr></tbody></table></section>
}

function DemoReports({ ledgerOnly, prop = false, query }) {


  const { t, fmt } = useTestingLocale()

  const sessions = demoSessionItems(query)
  const [ids, setIds] = useState(ledgerOnly ? null : sessions.find(item => item.record_id === query?.get('demo_session'))?.record_id || sessions[0].record_id)
  const [filters, setFilters] = useState({ side: 'all', outcome: 'all', from: '', to: '' })
  const [extra, setExtra] = useState({ ...DEFAULT_EXTRA_FILTERS })
  const [selected, setSelected] = useState(''), [config, setConfig] = useState({ stop_distance_ticks: 10, stop_multiplier: 1, target_r: 2 })
  const model = useMemo(() => {
    const rows = demoFilterRows(ledgerOnly ? ids : [ids], filters)
    return buildAnalyticsModel({ ...demoResult(rows, sessions.find(item => item.record_id === ids)), multi_session: ledgerOnly }, prop ? 'prop' : 'app')
  }, [ids, filters, ledgerOnly, prop, sessions])
  const row = model.ledger.find(item => item.tradeId === selected)
  const exportCsv = () => {
    const blob = new Blob([tradesCsv(filterAnalyticsRows(model.ledger, extra), 'USD', { source: 'UI demo' })], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob), anchor = document.createElement('a')
    anchor.href = url; anchor.download = 'demo-trades.csv'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const Inspector = ledgerOnly ? TradeInspector : 'section'
  const renderFilters = columnControl => <FxAnalyticsFilters persistInUrl={false} sourceType={prop ? 'Prop firm' : 'Backtesting'} columnControl={columnControl} ledgerOnly={ledgerOnly} filters={filters} onChange={patch => { setFilters(value => ({ ...value, ...patch })); setSelected('') }} extra={extra} onExtra={patch => setExtra(value => ({ ...value, ...patch }))} rows={model.ledger} onExport={exportCsv} sessionControl={<SessionFilter items={sessions} multiple={ledgerOnly} value={ids} onChange={value => { setIds(value); setSelected('') }} />} onClearSessions={() => setIds(ledgerOnly ? null : sessions[0].record_id)} />
  return <section className="wm-page as-page" aria-label={ledgerOnly ? t("Trades") : t("Analytics")}>
    <h1 className="sr-only">{ledgerOnly ? t("Trades") : t("Analytics")}</h1>
    {ledgerOnly ? <FxTradeLedger model={model} extra={extra} selected={selected} onSelect={setSelected} renderFilters={renderFilters} /> : renderFilters()}
    {prop && <Objectives model={model} />}
    {!ledgerOnly && <FxAnalyticsReport model={model} extra={extra} experimentStatus="unavailable" config={config} onConfig={setConfig} selected={selected} onSelect={setSelected} />}
    {row && <Inspector onClose={() => setSelected('')} className="fxa-trade-inspector" aria-label={t("Chi tiết giao dịch")}><div className="fxa-section-heading"><h2>{row.session_name} · {row.symbol}</h2><button className="fxa-button" type="button" onClick={() => setSelected('')}>{t("Đóng chi tiết")}</button></div><div className="fxa-metrics"><Metric label={t("Net P/L")} value={fmt(row.net_pnl, t(" USD"))} /><Metric label={t("Return (R)")} value={fmt(row.realized_r, t(" R"))} /><Metric label={t("Entry")} value={fmt(row.price_open, '', 6)} /><Metric label={t("Exit")} value={fmt(row.price_close, '', 6)} /></div></Inspector>}
  </section>
}

function DemoSessions({ workspace, query }) {


  const { t, fmt } = useTestingLocale()

  const [items, setItems] = useState(() => demoSessionItems(query))
  const [id, setId] = useState(() => demoSessionItems(query).find(item => item.record_id === query.get('demo_session'))?.record_id || DEMO_SESSIONS[0].record_id)
  useEffect(() => { setId(items.find(item => item.record_id === query.get('demo_session'))?.record_id || items[0]?.record_id || '') }, [query, items])
  const [editing, setEditing] = useState(false), [actionDialog, setActionDialog] = useState(null)
  const item = items.find(item => item.record_id === id)
  const payload = useMemo(() => item ? demoDashboardAnalytics(item, workspace) : null, [item, workspace])
  const model = useMemo(() => item ? buildAnalyticsModel(demoResult(payload.ledger, item)) : null, [payload, item])
  const dataset = DEMO_DATASETS.find(entry => entry.dataset_id === item?.dataset_id), replayRecord = item ? demoReplayContext(item) : null
  const href = (view, overrides = {}) => buildWorkspaceHref(view, workspace, query, { demo_session: id, select: '1', analytics_source: 'sessions', ...overrides })
  const save = draft => { setItems(current => current.map(entry => entry.record_id === id ? { ...entry, ...draft, revision: entry.revision + 1 } : entry)); setEditing(false); return true }
  const select = value => { setId(value); const url = new URL(window.location.href); if (value) url.searchParams.set('demo_session', value); else url.searchParams.delete('demo_session'); navigate(url, { replace: true }) }
  const mutate = action => {
    if (action !== 'delete') return
    const next = items.filter(entry => entry.record_id !== id)
    setItems(next); setActionDialog(null)
    select(next[0]?.record_id || '')
  }
  return <section className="wm-page fx-session-picker fxr-integrated-sessions fxs-page" aria-label={t("Sessions")}>
    <h1 className="sr-only">{t("Sessions")}</h1>
    <div className="fxr-session-toolbar">
      <SessionSelect selected={id} catalog={{ status: 'ready', items }} onSelect={select} balance={fmt(model?.endingBalance, t(" USD"))} />
      <div className="fxr-session-actions">
        <button className="fxr-button fxr-button-primary fxs-new-session" disabled type="button"><TestingIcon kind="plus" size={16} />{t("＋ Phiên mới")}</button>
        {item && <><FxSelect className="fxs-analytics-button" label={t("Mở Analytics")} value="session" triggerContent={t("Analytics")} options={[{ value: 'session', label: 'Analytics phiên' }, { value: 'prop', label: 'Prop Firm' }]} onChange={value => navigate(href('analytics', { analytics_source: value === 'prop' ? 'prop' : 'sessions' }))} />
        <button className="fxr-button fxr-button-secondary fxs-settings" type="button" onClick={() => setEditing(true)}>{t("Cài đặt phiên")}</button>
        <SessionActions text item={item} onAction={action => setActionDialog(action)} /></>}
      </div>
    </div>
    {item ? <><div className="fxr-session-cards">
      <SessionSummaryCard item={item} dataset={dataset} payload={payload} model={model} replayRecord={replayRecord} preview />
      <SessionDescriptionCard item={item} onSave={description => save({ description })} />
    </div>
    <div className="fxr-session-report"><SessionPerformance model={model} item={item} payload={payload} href={href} /></div>
    </> : <div className="fxr-empty-state"><h2>{t("Chưa có phiên trong bản xem thử")}</h2><p>{t("Tải lại trang để xem lại các phiên demo.")}</p></div>}
    {actionDialog && item && <SessionActionDialog key={actionDialog + id} mode={actionDialog} item={item} preview onClose={() => setActionDialog(null)} onSubmit={mutate} />}
    {editing && item && <SessionSettingsDrawer item={item} dataset={dataset} payload={payload} model={model} replayRecord={replayRecord} workspace={workspace} preview onClose={() => setEditing(false)} onSubmit={save} />}
  </section>
}

function DemoDashboard({ workspace, query, state }) {
  const { t } = useTestingLocale()

  const preview = useMemo(() => ({ items: state === 'partial' ? DEMO_SESSIONS.slice(0, 2) : state === 'many' ? DEMO_MANY_SESSIONS : DEMO_SESSIONS, datasets: DEMO_DATASETS, analytics: demoDashboardAnalytics, replayContext: demoReplayContext,
    overview: (filters, items) => {
      const result = demoOverview(demoFilterRows(filters.session ? [items.find(item => item.record_id === filters.session)?.source_record_id || filters.session] : [...new Set(items.map(item => item.source_record_id || item.record_id))], filters))
      result.performance.scope = { session_count: state === 'many' ? DEMO_MANY_SESSIONS.length : DEMO_SESSIONS.length, readable_session_count: items.length }
      if (state === 'unknown') {
        result.performance.time_invested_seconds = null
        result.performance.historical_time_replayed_seconds = null
      }
      return result
    },
    propReport: <DemoReports prop /> }), [state])
  return <section className="fx-dashboard" aria-label={t("Dashboard")}><div className="fx-dashboard-inner"><DashboardSessions workspace={workspace} query={query} preview={preview} /></div></section>
}
const demoPlaybooks = DEMO_SESSIONS.map(item => ({ ...item, payload: { name: item.name, status: 'draft', execution_capability: 'replay_only', rules: { entry: 'breakout', exit: '2R', risk: '1%' } } }))
const demoNotes = DEMO_LEDGER.slice(0, 6).map(row => ({ record_id: row.trade_id, revision: 1, updated_at_utc: row.close_time_utc, payload: { entry_type: 'decision', note: `${row.session_name} · ${row.symbol}: chờ đóng nến xác nhận`, observation: 'Giá quay về vùng breakout', decision: 'Giữ rủi ro 1% theo kế hoạch', plan: 'SL ngoài vùng, mục tiêu 2R', actual_result: `${row.net_pnl} USD`, next_action: 'Đối chiếu entry với checklist', tags: row.tags, source: { type: 'replay_session', id: row.session_id } } }))

function DemoStrategies() {
  const { t } = useTestingLocale()

  const [id, setId] = useState(demoPlaybooks[0].record_id)
  return <section className="pb-page wm-page" aria-label={t("Strategies")}><h1>{t("My strategies")}</h1><div className="pb-workspace-grid"><PlaybookList items={demoPlaybooks} selectedId={id} onSelect={setId} /><PlaybookSummary record={demoPlaybooks.find(item => item.record_id === id)} preview /></div></section>
}
function DemoJournal() {
  const { t } = useTestingLocale()

  const [record, setRecord] = useState(demoNotes[0])
  return <section className="ja-page journal-page ja-story-page wm-page" aria-label={t("Journal")}><h1>{t("Journal")}</h1><div className="ja-workspace-grid"><div className="ja-list">{demoNotes.map(item => <JournalRow key={item.record_id} record={item} selected={record.record_id === item.record_id} onSelect={setRecord} />)}</div><StoryRail record={record} context={{}} /></div></section>
}
export default function DemoPreview({ view, workspace, query, state = 'demo' }) {
  const { t } = useTestingLocale()

  if (view === 'overview') return <DemoDashboard workspace={workspace} query={query} state={state} />
  if (view === 'replay') return <DemoSessions workspace={workspace} query={query} />
  if (view === 'trade') return <DemoReports ledgerOnly />
  if (view === 'analytics' || view === 'testing' || view === 'prop') return <DemoReports query={query} prop={view !== 'analytics' || query.get('analytics_source') === 'prop'} />
  if (view === 'market-data') return <DataDeskWorkspace workspace={workspace} query={query} preview={DEMO_DATA_LIBRARY} />
  if (view === 'live') return <LiveWorkspace workspace={workspace} query={query} preview={DEMO_LIVE} />
  if (view === 'playbook') return <DemoStrategies />
  return <DemoJournal />
}
