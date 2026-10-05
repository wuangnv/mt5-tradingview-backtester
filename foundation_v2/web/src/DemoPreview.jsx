import React, { useMemo, useState } from 'react'
import { buildAnalyticsModel } from './AnalyticsWorkspace.jsx'
import { FxAnalyticsFilters, FxAnalyticsReport, Metric, fmt } from './FxAnalytics.jsx'
import FxTradeLedger from './FxTradeLedger.jsx'
import FxSelect from './FxSelect.jsx'
import SessionFilter from './SessionFilter.jsx'
import SessionPerformance from './SessionPerformance.jsx'
import DashboardPerformance from './DashboardPerformance.jsx'
import MarketAssetCatalog from './MarketAssetCatalog.jsx'
import LiveBrokerSnapshot from './LiveBrokerSnapshot.jsx'
import { PlaybookList, PlaybookSummary } from './PlaybookWorkspace.jsx'
import { JournalRow, StoryRail } from './JournalWorkspace.jsx'
import { DEFAULT_EXTRA_FILTERS, filterAnalyticsRows, tradesCsv } from './tradingAnalyticsModel.js'
import { buildWorkspaceHref } from './workspaceContext.js'
import { DEMO_SESSIONS, DEMO_LEDGER, DEMO_ASSETS, DEMO_LIVE, demoResult, demoOverview, demoFilterRows } from './demoFixtures.js'

function Objectives({ model }) {
  return <section className="fxa-prop-objectives" aria-label="Challenge objectives"><div className="fxa-section-heading"><h2>Challenge objectives</h2><span>Practice · Phase 1</span></div><div className="fxa-metrics"><Metric label="Balance" value={fmt(model.endingBalance, ' USD')} /><Metric label="Profit target" value="1.000 USD" /><Metric label="Daily loss limit" value="500 USD" /><Metric label="Overall loss limit" value="1.000 USD" /></div><table><thead><tr><th>Objective</th><th>Kết quả / ngưỡng</th><th>Trạng thái</th></tr></thead><tbody><tr><td>Profit target</td><td>{fmt(model.netPnl, ' USD')} / 1.000 USD</td><td>{model.netPnl >= 1000 ? 'Đạt' : 'Đang thực hiện'}</td></tr><tr><td>Overall drawdown</td><td>{fmt(model.maxDrawdown, ' USD')} / 1.000 USD</td><td>{model.maxDrawdown < 1000 ? 'Trong giới hạn' : 'Vi phạm'}</td></tr></tbody></table></section>
}

function DemoReports({ ledgerOnly, prop = false }) {
  const [ids, setIds] = useState(ledgerOnly ? null : DEMO_SESSIONS[0].record_id)
  const [filters, setFilters] = useState({ side: 'all', outcome: 'all', from: '', to: '' })
  const [extra, setExtra] = useState({ ...DEFAULT_EXTRA_FILTERS })
  const [selected, setSelected] = useState(''), [config, setConfig] = useState({ stop_distance_ticks: 10, stop_multiplier: 1, target_r: 2 })
  const model = useMemo(() => {
    const rows = demoFilterRows(ledgerOnly ? ids : [ids], filters)
    return buildAnalyticsModel({ ...demoResult(rows, DEMO_SESSIONS.find(item => item.record_id === ids)), multi_session: ledgerOnly })
  }, [ids, filters, ledgerOnly])
  const row = model.ledger.find(item => item.tradeId === selected)
  const exportCsv = () => {
    const blob = new Blob([tradesCsv(filterAnalyticsRows(model.ledger, extra), 'USD', { source: 'UI demo' })], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob), anchor = document.createElement('a')
    anchor.href = url; anchor.download = 'demo-trades.csv'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <section className="wm-page as-page" aria-label={ledgerOnly ? 'Trades' : 'Analytics'}>
    <h1 className="sr-only">{ledgerOnly ? 'Trades' : 'Analytics'}</h1>
    <FxAnalyticsFilters ledgerOnly={ledgerOnly} filters={filters} onChange={patch => { setFilters(value => ({ ...value, ...patch })); setSelected('') }} extra={extra} onExtra={patch => setExtra(value => ({ ...value, ...patch }))} rows={model.ledger} onExport={exportCsv} sessionControl={<SessionFilter items={DEMO_SESSIONS} multiple={ledgerOnly} value={ids} onChange={value => { setIds(value); setSelected('') }} />} onClearSessions={() => setIds(ledgerOnly ? null : DEMO_SESSIONS[0].record_id)} />
    {prop && <Objectives model={model} />}
    {ledgerOnly ? <FxTradeLedger model={model} extra={extra} selected={selected} onSelect={setSelected} /> : <div className="fxa-report"><FxAnalyticsReport model={model} extra={extra} experimentStatus="unavailable" config={config} onConfig={setConfig} selected={selected} onSelect={setSelected} /></div>}
    {row && <section className="fxa-trade-inspector" aria-label="Chi tiết giao dịch"><div className="fxa-section-heading"><h2>{row.session_name} · {row.symbol}</h2><button className="fxa-button" type="button" onClick={() => setSelected('')}>Đóng chi tiết</button></div><div className="fxa-metrics"><Metric label="Net P/L" value={fmt(row.net_pnl, ' USD')} /><Metric label="Return (R)" value={fmt(row.realized_r, ' R')} /><Metric label="Entry" value={fmt(row.price_open, '', 6)} /><Metric label="Exit" value={fmt(row.price_close, '', 6)} /></div></section>}
  </section>
}

function DemoSessions() {
  const [id, setId] = useState(DEMO_SESSIONS[0].record_id)
  const item = DEMO_SESSIONS.find(item => item.record_id === id)
  const model = useMemo(() => buildAnalyticsModel(demoResult(demoFilterRows([id]), item)), [id])
  return <section className="wm-page fx-session-picker fxr-integrated-sessions fxs-page" aria-label="Sessions"><h1 className="sr-only">Sessions</h1><div className="fxr-session-toolbar"><div className="fxr-session-control"><span className="fxs-select-label">Session</span><FxSelect label="Chọn phiên replay" value={id} onChange={setId} searchable options={DEMO_SESSIONS.map(item => ({ value: item.record_id, label: item.name, detail: item.instrument_id }))} /></div><div className="fxr-session-actions"><button className="fxr-button fxr-button-secondary" disabled type="button">Mở chart</button><button className="fxr-button fxr-button-primary" disabled type="button">Tạo backtest</button></div></div><div className="fxs-demo-summary"><div><h2>{item.name}</h2><span>{item.instrument_id} · {item.timeframe}</span></div><div className="fxs-balance"><span>Balance · USD</span><strong>{fmt(model.endingBalance)}</strong></div></div><SessionPerformance model={model} item={item} payload={{}} /></section>
}

function DemoDashboard({ workspace, query }) {
  const [session, setSession] = useState(''), [period, setPeriod] = useState('lifetime'), [from, setFrom] = useState(''), [to, setTo] = useState('')
  const [search, setSearch] = useState(''), [sort, setSort] = useState('newest')
  const range = period === '30d' ? { from: '2026-09-06', to: '2026-10-05' } : period === '7d' ? { from: '2026-09-29', to: '2026-10-05' } : period === 'custom' ? { from, to } : {}
  const filters = { session, from: range.from || '', to: range.to || '' }
  const payload = useMemo(() => demoOverview(demoFilterRows(session ? [session] : null, filters)), [session, filters.from, filters.to])
  const visible = [...DEMO_SESSIONS].filter(item => `${item.name} ${item.instrument_id}`.toLowerCase().includes(search.toLowerCase())).sort((a, b) => (sort === 'oldest' ? 1 : -1) * a.created_at_utc.localeCompare(b.created_at_utc))
  return <section className="fx-dashboard" aria-label="Dashboard"><div className="fx-dashboard-inner"><h1 className="sr-only">Dashboard</h1><nav className="fx-dashboard-quick-actions" aria-label="Bắt đầu luyện tập">{[['Backtesting session', 'Tạo phiên backtest'], ['Prop firm session', 'Bắt đầu challenge mô phỏng']].map(([title, hint], index) => <button key={title} disabled type="button" className={`fx-dashboard-quick-action${index === 0 ? ' is-primary' : ''}`}><span><strong>{title}</strong><small>{hint}</small></span><span className="fx-dashboard-action-arrow">↗</span></button>)}<a className="fx-dashboard-quick-action" href={buildWorkspaceHref('learn', workspace, query)}><span><strong>Tutorials</strong><small>Học và luyện tập</small></span><span className="fx-dashboard-action-arrow">↗</span></a></nav>
    <DashboardPerformance workspace={workspace} filters={filters} previewPayload={payload} controls={<><FxSelect label="Phạm vi Performance" value={session} onChange={setSession} searchable options={[{ value: '', label: 'Backtesting · All sessions' }, ...DEMO_SESSIONS.map(item => ({ value: item.record_id, label: item.name }))]} /><FxSelect label="Thời gian Performance" value={period} onChange={setPeriod} icon="calendar" options={[['7d', 'Last week'], ['30d', 'Last month'], ['lifetime', 'Lifetime'], ['custom', 'Khoảng tùy chọn']].map(([value, label]) => ({ value, label }))} /></>} dateControls={period === 'custom' && <div className="fx-dashboard-date-controls"><label>Từ ngày (UTC)<input type="date" value={from} onChange={event => setFrom(event.target.value)} /></label><label>Đến ngày (UTC)<input type="date" value={to} onChange={event => setTo(event.target.value)} /></label></div>} />
    <section className="fx-dashboard-recent" aria-label="Recent Sessions"><div className="fx-dashboard-section-head"><h2>Recent Sessions</h2></div><div className="fx-dashboard-recent-toolbar"><label className="fx-dashboard-search"><input type="search" aria-label="Tìm phiên gần đây" placeholder="Tìm tên phiên, symbol…" value={search} onChange={event => setSearch(event.target.value)} /></label><FxSelect label="Sắp xếp phiên" value={sort} onChange={setSort} icon="sort" options={[{ value: 'newest', label: 'Newest to oldest' }, { value: 'oldest', label: 'Oldest to newest' }]} /></div><div className="fx-dashboard-session-list">{visible.map(item => <article className={`fx-dashboard-session-row${session === item.record_id ? ' is-selected' : ''}`} key={item.record_id}><span className="fx-dashboard-session-symbol" aria-hidden="true">▷</span><div className="fx-dashboard-session-info"><h3>{item.name}</h3><p>{item.instrument_id} · {item.timeframe}</p></div><span className="fx-dashboard-session-status">{item.status === 'completed' ? 'Hoàn thành' : 'Tạm dừng'}</span><div className="fx-dashboard-row-actions"><button type="button" className="fx-dashboard-result-button" aria-pressed={session === item.record_id} onClick={() => setSession(item.record_id)}>Kết quả</button></div></article>)}</div>{!visible.length && <p className="fxa-empty">Không có phiên khớp bộ lọc.</p>}</section></div></section>
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
  if (view === 'replay') return <DemoSessions />
  if (view === 'trade') return <DemoReports ledgerOnly />
  if (view === 'analytics' || view === 'testing' || view === 'prop') return <DemoReports prop={view !== 'analytics' || query.get('analytics_source') === 'prop'} />
  if (view === 'market-data') return <main className="wm-page market-data-workspace" aria-label="Market Data"><MarketAssetCatalog workspace={workspace} query={query} showHeading={false} preview={DEMO_ASSETS} /></main>
  if (view === 'live') return <DemoLive query={query} />
  if (view === 'playbook') return <DemoStrategies />
  return <DemoJournal />
}
