import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import LearnWorkspace from './LearnWorkspace.jsx'
import PropWorkspace from './PropWorkspace.jsx'
import ReplayWorkspace from './ReplayWorkspace.jsx'
import FxReplayShell from './FxReplayShell.jsx'
import AnalyticsWorkspace from './AnalyticsWorkspace.jsx'
import JournalWorkspace from './JournalWorkspace.jsx'
import SettingsWorkspace from './SettingsWorkspace.jsx'
import DataDeskWorkspace from './DataDeskWorkspace.jsx'
import ResearchWorkspaceV2 from './ResearchWorkspace.jsx'
import TradeWorkspace from './TradeWorkspace.jsx'
import RiskWorkspace from './RiskWorkspace.jsx'
import PlaybookWorkspace from './PlaybookWorkspace.jsx'
import LiveWorkspace from './LiveWorkspace.jsx'
import SessionPicker from './SessionPicker.jsx'
import { buildWorkspaceHref } from './workspaceContext.js'
import { dashboardFilters, dashboardFilterError, dashboardNumber, readDashboardOverview } from './dashboardModel.js'
import './styles.css'
import './dashboard.css'

function safeCount(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null
  const numeric = Number(value)
  return Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : null
}

function sumCounts(value) {
  if (!value || typeof value !== 'object') return null
  const values = Object.values(value).map(safeCount)
  if (values.some((item) => item === null)) return null
  return values.reduce((total, item) => total + item, 0)
}

function formatCount(value) {
  const count = safeCount(value)
  return count === null ? '—' : new Intl.NumberFormat('vi-VN').format(count)
}

function WorkspaceOverview({ workspace, query }) {
  const [filters, setFilters] = useState(() => dashboardFilters(query))
  const [reloadToken, setReloadToken] = useState(0)
  const [overview, setOverview] = useState({ status: 'loading', payload: null, error: null, key: '' })
  const [sessions, setSessions] = useState([])
  const filterError = dashboardFilterError(filters)
  const requestKey = `${workspace}:${JSON.stringify(filters)}`

  useEffect(() => {
    if (filterError) return
    const controller = new AbortController()
    let current = true
    setOverview((previous) => ({ status: 'loading', payload: previous.key === requestKey ? previous.payload : null, error: null, key: requestKey }))
    readDashboardOverview(workspace, filters, controller.signal)
      .then((payload) => {
        if (!current) return
        setOverview({ status: 'ready', payload, error: null, key: requestKey })
        setSessions(payload.performance.sessions || [])
      })
      .catch((error) => {
        if (current && error.name !== 'AbortError') setOverview((previous) => ({ ...previous, status: 'error', error: String(error.message || error) }))
      })
    return () => { current = false; controller.abort() }
  }, [reloadToken, workspace, filters, filterError, requestKey])

  const changeFilters = (patch) => {
    const next = { ...filters, ...patch }
    setFilters(next)
    const url = new URL(window.location.href)
    for (const [key, value] of Object.entries(next)) {
      const name = `dashboard_${key}`
      if (value) url.searchParams.set(name, value)
      else url.searchParams.delete(name)
    }
    window.history.replaceState(null, '', url)
  }
  const payload = !filterError && overview.key === requestKey ? overview.payload : null
  const performance = payload?.performance
  const metrics = performance?.metrics
  const partial = performance?.status === 'partial'
  const pending = overview.status === 'loading'
  const scope = performance?.scope
  const months = (performance?.months || []).slice(-12)
  const symbols = performance?.symbols || []
  const largestSymbol = Math.max(1, ...symbols.map((item) => item.closed_trade_count))

  const routeHref = (view, overrides = {}) => buildWorkspaceHref(view, workspace, query, overrides)
  const backtestingHref = routeHref('replay', { select: '1', session: null, cursor: null, cutoff: null })
  const cards = [
    { id: 'backtesting', title: 'Backtesting session', subtitle: 'Mở hoặc tạo phiên replay', icon: 'plus', href: backtestingHref, primary: true },
    { id: 'prop', title: 'Prop firm session', subtitle: 'Luyện tập challenge', icon: 'trophy', href: routeHref('testing'), primary: true },
    { id: 'tutorials', title: 'Tutorials', subtitle: 'Mở bài học', icon: 'education', href: routeHref('learn'), primary: false },
  ]

  return (
    <section className="fx-dashboard" aria-label="Dashboard">
      <div className="fx-dashboard-inner">
        <div className="fx-dashboard-cards">
          {cards.map((card) => (
            <a className={`fx-dashboard-card ${card.primary ? 'is-primary' : ''}`} href={card.href} key={card.id}>
              <span className="fx-dashboard-card-icon" aria-hidden="true">
                <DashboardIcon type={card.icon} />
              </span>
              <span className="fx-dashboard-card-copy">
                <strong>{card.title}</strong>
                <small>{card.subtitle}</small>
              </span>
            </a>
          ))}
        </div>
        <div className="fx-dashboard-performance-head">
          <div><h2>Hiệu suất replay</h2><p>Giao dịch đã đóng trong các phiên đã lưu · thời gian UTC</p></div>
          <button type="button" className="fx-dashboard-filter" disabled={pending || Boolean(filterError)} onClick={() => setReloadToken((value) => value + 1)}>{pending ? 'Đang tải…' : 'Làm mới'}</button>
        </div>
        <div className="fx-dashboard-filters" role="group" aria-label="Bộ lọc hiệu suất">
          <label><span>Phiên replay</span><select aria-label="Phiên replay" value={filters.session} onChange={(event) => changeFilters({ session: event.target.value })}>
            <option value="">Tất cả phiên, gồm đã lưu trữ</option>
            {filters.session && !sessions.some((item) => item.session_id === filters.session) && <option value={filters.session}>{filters.session}</option>}
            {sessions.map((item) => <option value={item.session_id} key={item.session_id}>{item.name}{item.instrument_id ? ` · ${item.instrument_id}` : ''}{item.archived ? ' · đã lưu trữ' : ''}</option>)}
          </select></label>
          <label><span>Từ ngày đóng (UTC)</span><input type="date" value={filters.from} onChange={(event) => changeFilters({ from: event.target.value })} /></label>
          <label><span>Đến ngày đóng (UTC)</span><input type="date" value={filters.to} onChange={(event) => changeFilters({ to: event.target.value })} /></label>
          <button type="button" className="fx-dashboard-filter" onClick={() => changeFilters({ session: '', from: '', to: '' })}>Xóa lọc</button>
        </div>
        <div className={`fx-dashboard-data-state ${partial || overview.status === 'error' ? 'is-warning' : ''}`} data-testid="dashboard-data-state" role={overview.status === 'error' || filterError ? 'alert' : 'status'} aria-live="polite">
          {filterError ? <span>{filterError}</span> : pending ? <span>{payload ? 'Đang cập nhật; số liệu bên dưới là lần đọc trước.' : 'Đang tải đúng phạm vi đã chọn…'}</span> : overview.status === 'error' ? <>
            <span>{payload ? 'Chưa cập nhật được. Đang hiển thị số liệu cũ; hãy thử lại.' : 'Không tải được hiệu suất. Hãy thử lại.'} <small>({overview.error})</small></span>
            <button type="button" onClick={() => setReloadToken((value) => value + 1)}>Thử lại</button>
          </> : performance && <span>{scope.session_count === 0 ? 'Chưa có phiên replay. Tạo phiên từ dataset để bắt đầu.' : partial ? `Đọc được ${scope.readable_session_count}/${scope.session_count} phiên; các chỉ số chỉ phản ánh phần dữ liệu đọc được.` : metrics.closed_trade_count === 0 ? 'Chưa có giao dịch đóng trong phạm vi này. Mở phiên để tiếp tục hoặc đổi khoảng ngày.' : `Đã tổng hợp ${scope.readable_session_count} phiên từ ledger đã lưu.`}</span>}
        </div>
        <div className="fx-dashboard-performance" data-testid="dashboard-performance" aria-busy={pending}>
          <DashboardMetric title="Giao dịch đã đóng" value={dashboardNumber(metrics?.closed_trade_count)} detail={scope?.duplicate_trade_count ? `Đã bỏ ${scope.duplicate_trade_count} bản sao lịch sử branch` : 'Mỗi lần đóng lệnh được tính một lần'} />
          <DashboardMetric title="Tỷ lệ thắng" value={dashboardNumber(metrics?.win_rate_pct, '%')} detail={metrics?.closed_trade_count > 0 ? `${metrics.wins} thắng · ${metrics.losses} thua · ${metrics.breakeven} hòa` : 'Chưa có trade đóng để tính tỷ lệ'} />
          <DashboardMetric title="Phiên trong phạm vi" value={dashboardNumber(scope?.session_count)} detail={scope ? `${scope.readable_session_count} phiên có execution ledger hợp lệ` : 'Chờ dữ liệu từ workspace'} />
        </div>
        <div className="fx-dashboard-distributions">
          <section className="fx-dashboard-distribution" aria-label="Tỷ lệ thắng theo tháng"><h3>Tỷ lệ thắng theo tháng</h3><p>Tháng đóng lệnh theo UTC · tối đa 12 tháng có giao dịch gần nhất</p>
            {months.length ? <ul tabIndex={0} aria-label="Danh sách tỷ lệ thắng theo tháng">{months.map((item) => <li key={item.month}><span>{item.month}</span><div className="fx-dashboard-bar-track" aria-hidden="true"><i style={{ width: `${item.win_rate_pct}%` }} /></div><strong>{dashboardNumber(item.win_rate_pct, '%')}<small>{item.wins}/{item.closed_trade_count} thắng</small></strong></li>)}</ul> : <div className="fx-dashboard-empty-chart">Chưa có giao dịch đóng để phân nhóm theo tháng.</div>}
          </section>
          <section className="fx-dashboard-distribution" aria-label="Giao dịch theo symbol"><h3>Giao dịch theo symbol</h3><p>Số lệnh đã đóng · không cộng P/L khác đơn vị tiền</p>
            {symbols.length ? <ul tabIndex={0} aria-label="Danh sách giao dịch theo symbol">{symbols.map((item) => <li key={item.symbol}><span>{item.symbol}</span><div className="fx-dashboard-bar-track" aria-hidden="true"><i style={{ width: `${item.closed_trade_count / largestSymbol * 100}%` }} /></div><strong>{dashboardNumber(item.closed_trade_count)}<small>{dashboardNumber(item.win_rate_pct, '%')} thắng</small></strong></li>)}</ul> : <div className="fx-dashboard-empty-chart">Chưa có giao dịch đóng để phân nhóm theo symbol.</div>}
          </section>
        </div>
        <div className="fx-dashboard-time-note"><strong>Thời gian sử dụng và thời lượng replay: chưa ghi nhận.</strong><span>Không suy ra từ ngày tạo phiên hoặc vị trí cursor. Xem P/L, balance và từng trade trong Analytics của phiên.</span></div>
        {performance && <details className="fx-dashboard-provenance"><summary>Nguồn dữ liệu và phạm vi tổng hợp</summary><p>Replay mô phỏng, gồm các phiên đã lưu trữ; không gồm research jobs hoặc giao dịch broker. Các lần đóng lệnh giống nhau được loại trùng trong cùng cây branch. Tỷ lệ thắng = số lệnh net P/L dương / tổng số lệnh đóng, gồm lệnh hòa vốn.</p><p>Lần đọc: {new Date(performance.as_of_utc).toLocaleString('vi-VN', { timeZone: 'UTC' })} UTC. Mỗi phiên giữ revision riêng; bấm Làm mới sau khi tiếp tục replay.</p>
          {performance.excluded.length > 0 && <p data-testid="dashboard-excluded">{performance.excluded.length} phiên chưa được tính: {performance.excluded.map((item) => `${item.session_id} (${item.reason})`).join('; ')}.</p>}
          <ul>{performance.sources.map((item) => <li key={item.session_id}><a href={routeHref('analytics', { session: item.session_id, dataset: item.dataset_id, cursor: null, cutoff: null, mode: null, surface: 'workspace', from: filters.from, to: filters.to })}>Xem Analytics · {sessions.find((session) => session.session_id === item.session_id)?.name || item.session_id}</a><span>revision {item.revision} · {item.closed_trade_count} trade trong khoảng ngày</span></li>)}</ul>
        </details>}
        {payload && <div className="fx-dashboard-inventory" data-testid="dashboard-inventory" role="group" aria-label="Dữ liệu trong workspace">
          <span>{formatCount(payload.counts?.datasets)} dataset</span>
          <span>{formatCount(sumCounts(payload.counts?.research_jobs))} research job</span>
          <span>{formatCount(sumCounts(payload.counts?.records))} bản ghi đã lưu</span>
        </div>}
      </div>
    </section>
  )
}

function DashboardMetric({ title, value, detail }) {
  return (
    <article className="fx-dashboard-metric">
      <span className="fx-dashboard-metric-title">
        <span className="fx-dashboard-metric-label">{title}</span>
      </span>
      <strong>{value}</strong>
      {detail && <span className="fx-dashboard-metric-detail">{detail}</span>}
    </article>
  )
}

function DashboardIcon({ type }) {
  const common = { className: 'fx-dashboard-icon-svg', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: '1.7', strokeLinecap: 'round', strokeLinejoin: 'round', focusable: 'false' }
  if (type === 'trophy') return <svg {...common}><path d="M8 4h8v4a4 4 0 0 1-8 0V4Z" /><path d="M8 6H5v1a3 3 0 0 0 3 3M16 6h3v1a3 3 0 0 1-3 3M12 12v4M8 20h8M9 16h6" /></svg>
  if (type === 'education') return <svg {...common}><path d="m3 9 9-4 9 4-9 4-9-4Z" /><path d="M7 11v4c2 2 8 2 10 0v-4M21 9v6" /></svg>
  return <svg {...common}><path d="M12 5v14M5 12h14" /></svg>
}

function UnavailableWorkspace({ title, eyebrow, description, next, href }) {
  return (
    <section className="fx-unavailable" aria-labelledby="unavailable-title">
      <span className="fx-eyebrow">{eyebrow}</span>
      <h1 id="unavailable-title">{title}</h1>
      <p>{description}</p>
      <div className="fx-unavailable-state"><span className="fx-state-mark">—</span><span><strong>Chưa có dữ liệu để hiển thị</strong><small>{next}</small></span></div>
      {href && <a className="fx-secondary-button" href={href}>Mở Practice để tiếp tục</a>}
    </section>
  )
}


function App() {
  const query = new URLSearchParams(window.location.search)
  const workspace = query.get('workspace') || 'tenant-a'
  const requestedView = query.get('view')
  // Preserve deep links emitted by the research/learn flows while keeping a bare root on the overview.
  const activeView = requestedView || (query.has('job') ? 'research' : query.has('session') || query.has('dataset') ? 'replay' : 'overview')
  // Trading tabs open persisted reports. Order entry is an explicit chart action.
  const showSessionPicker = query.get('surface') !== 'workspace' && (query.get('select') === '1' || query.get('mode') === 'Practice')
  const showTradeLedger = query.get('intent') !== 'order'
  const showSessionAnalytics = !query.get('job') && !query.get('job_id')
  const isLearn = activeView === 'learn'
  const isProp = requestedView === 'testing' || requestedView === 'prop'
  let content
  let mode = query.get('mode') || (activeView === 'research' ? 'Research' : activeView === 'learn' ? 'Learn' : 'Replay')

  if (isLearn) {
    content = <LearnWorkspace workspace={workspace} query={query} />
    mode = 'Read only'
  } else if (isProp) {
    content = <PropWorkspace workspace={workspace} query={query} />
    mode = 'Practice'
  } else if (activeView === 'replay') {
    content = showSessionPicker ? <SessionPicker kind="replay" workspace={workspace} query={query} /> : <ReplayWorkspace workspace={workspace} query={query} />
  } else if (activeView === 'research') {
    content = <ResearchWorkspaceV2 workspace={workspace} query={query} />
  } else if (activeView === 'data') {
    content = <DataDeskWorkspace workspace={workspace} query={query} />
    mode = 'Data'
  } else if (activeView === 'overview') {
    content = <WorkspaceOverview workspace={workspace} query={query} />
  } else if (activeView === 'journal') {
    content = <JournalWorkspace workspace={workspace} query={query} />
    mode = 'Journal'
  } else if (activeView === 'analytics') {
    content = showSessionAnalytics ? <SessionPicker kind="analytics" workspace={workspace} query={query} /> : <AnalyticsWorkspace workspace={workspace} query={query} />
    mode = 'Analytics'
  } else if (activeView === 'trade') {
    content = showTradeLedger ? <SessionPicker kind="trade" workspace={workspace} query={query} /> : <TradeWorkspace workspace={workspace} query={query} />
    mode = 'Simulator'
  } else if (activeView === 'risk') {
    content = <RiskWorkspace workspace={workspace} query={query} />
    mode = 'Risk lab'
  } else if (activeView === 'playbook') {
    content = <PlaybookWorkspace workspace={workspace} query={query} />
    mode = 'Playbook'
  } else if (activeView === 'live') {
    content = <LiveWorkspace workspace={workspace} query={query} />
    mode = 'Read only'
  } else if (activeView === 'settings') {
    content = <SettingsWorkspace workspace={workspace} query={query} />
    mode = 'Workspace'
  } else {
    const copy = {
      journal: ['JOURNAL / DECISION LOG', 'Journal', 'Ghi chú phải gắn với replay session và trade ID để không tách khỏi context.', 'Mở một replay session trước khi ghi journal.'],
      analytics: ['ANALYTICS / SESSION METRICS', 'Analytics', 'Analytics sẽ đọc từ session, trade ledger và research result có provenance.', 'Chưa có session hoặc result để tính số liệu.'],
      trade: ['TRADE DESK / DEMO ONLY', 'Trade desk', 'Trade draft chỉ có ý nghĩa khi được tạo từ chart tại một decision cutoff cụ thể.', 'Broker send đang khóa; hãy bắt đầu từ Practice.'],
    }[activeView] || ['WORKSPACE', 'Khu vực chưa chọn', 'Chọn một khu vực trong rail để tiếp tục.', 'Mở Practice để bắt đầu.']
    content = <UnavailableWorkspace eyebrow={copy[0]} title={copy[1]} description={copy[2]} next={copy[3]} href={buildWorkspaceHref('replay', workspace, query)} />
  }

  return <FxReplayShell workspace={workspace} query={query} activeView={activeView} mode={mode}>{content}</FxReplayShell>
}

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Trading Workspace root element is missing')

// Vite can re-evaluate this entry module during HMR. Reuse the existing root
// so a hot update never calls createRoot twice on the same DOM container.
const rootStateKey = '__tradingWorkspaceReactRoot'
const appRoot = rootElement[rootStateKey] || createRoot(rootElement)
rootElement[rootStateKey] = appRoot
appRoot.render(<App />)

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    appRoot.unmount()
    delete rootElement[rootStateKey]
  })
}
