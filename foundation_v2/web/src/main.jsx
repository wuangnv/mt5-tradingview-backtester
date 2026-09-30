import { createRoot } from 'react-dom/client'
import LearnWorkspace from './LearnWorkspace.jsx'
import PropWorkspace from './PropWorkspace.jsx'
import ReplayWorkspace from './ReplayWorkspace.jsx'
import FxReplayShell, { SHELL_SKELETON_MODE } from './FxReplayShell.jsx'
import AnalyticsWorkspace from './AnalyticsWorkspace.jsx'
import JournalWorkspace from './JournalWorkspace.jsx'
import SettingsWorkspace from './SettingsWorkspace.jsx'
import DataDeskWorkspace from './DataDeskWorkspace.jsx'
import ResearchWorkspaceV2 from './ResearchWorkspace.jsx'
import TradeWorkspace from './TradeWorkspace.jsx'
import RiskWorkspace from './RiskWorkspace.jsx'
import PlaybookWorkspace from './PlaybookWorkspace.jsx'
import SessionPicker from './SessionPicker.jsx'
import { buildWorkspaceHref } from './workspaceContext.js'
import './styles.css'
import './dashboard.css'

function WorkspaceOverview({ workspace, query }) {
  const routeHref = (view, overrides = {}) => buildWorkspaceHref(view, workspace, query, overrides)
  const backtestingHref = routeHref('replay', { select: '1' })
  const cards = [
    { id: 'backtesting', title: 'Backtesting session', subtitle: 'Start a session', icon: 'plus', href: backtestingHref, primary: true },
    { id: 'prop', title: 'Prop firm session', subtitle: 'Start a challenge', icon: 'trophy', href: routeHref('testing'), primary: true },
    { id: 'tutorials', title: 'Tutorials', subtitle: 'Learn more', icon: 'education', href: routeHref('learn'), primary: false },
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
                <strong>{card.title} <span className="fx-dashboard-card-info" aria-hidden="true">ⓘ</span></strong>
                <small>{card.subtitle}</small>
              </span>
            </a>
          ))}
        </div>
        <div className="fx-dashboard-performance-head">
          <h2>Performance</h2>
          <div className="fx-dashboard-filters" aria-label="Performance filters">
            <button type="button" className="fx-dashboard-filter">▥&nbsp; Backtesting <span aria-hidden="true">⌄</span></button>
            <button type="button" className="fx-dashboard-filter">▣&nbsp; Lifetime <span aria-hidden="true">⌄</span></button>
          </div>
        </div>
        <div className="fx-dashboard-performance" data-testid="dashboard-performance">
          <DashboardMetric title="Time Invested" value="6" unit="hr" extra="4 min" icon="bars" />
          <DashboardMetric title="Historical time replayed" value="1" unit="mo" extra="7 d 22 hr" icon="clock" />
          <DashboardChart />
          <DashboardMetric title="Trades taken" value="17" detail="58.82% buys · 41.18% sells" tone="trades" />
          <DashboardMetric title="Overall win rate" value="41.18%" icon="ring" />
          <DashboardChart title="Win Rate" className="is-wide is-wide-left" empty />
          <DashboardChart title="Trades by symbol" className="is-wide is-wide-right" empty />
        </div>
      </div>
    </section>
  )
}

function DashboardMetric({ title, value, unit, extra, detail, icon, tone = '' }) {
  return (
    <article className={`fx-dashboard-metric ${tone ? `is-${tone}` : ''}`}>
      <span className="fx-dashboard-metric-title">
        {icon && <MetricIcon type={icon} />}
        <span className="fx-dashboard-metric-label">{title}</span>
        <span className="fx-dashboard-info" aria-label={`About ${title}`}>i</span>
      </span>
      <strong>{value}{unit && <small>{unit}</small>}{extra && <small className="fx-dashboard-metric-extra">{extra}</small>}</strong>
      {detail && <span className="fx-dashboard-metric-detail">{detail}</span>}
    </article>
  )
}

function MetricIcon({ type }) {
  if (type === 'bars') return <span className="fx-dashboard-metric-icon fx-dashboard-bars" aria-hidden="true"><i /><i /><i /></span>
  if (type === 'clock') return <span className="fx-dashboard-metric-icon fx-dashboard-clock" aria-hidden="true">◷</span>
  return <span className="fx-dashboard-metric-icon fx-dashboard-ring" aria-hidden="true">◉</span>
}

function DashboardChart({ title = 'Time Invested', className = '', empty = false }) {
  if (empty) {
    return <article className={`fx-dashboard-chart fx-dashboard-chart-empty ${className}`}>
      <h3>{title}<span className="fx-dashboard-info" aria-label={`About ${title}`}>i</span></h3>
      <div className="fx-dashboard-empty-chart" aria-hidden="true"><span /><span /><span /><span /><span /></div>
      <p>No {title.toLowerCase()} yet.</p>
    </article>
  }
  return <article className={`fx-dashboard-chart ${className}`}>
    <h3>{title}<span className="fx-dashboard-info" aria-label="About Time Invested">i</span></h3>
    <div className="fx-dashboard-chart-grid" aria-label="Six hours invested over one period">
      {[0, 2, 4, 6, 8].map((tick) => <span className="fx-dashboard-chart-tick" key={tick} style={{ bottom: `${tick * 12.5}%` }}>{tick} hrs</span>)}
      <div className="fx-dashboard-chart-bars"><span style={{ height: '72%' }} /></div>
      <span className="fx-dashboard-chart-label">Sep 2026</span>
    </div>
  </article>
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
  // The first visual pass opens the FXReplay-style selector from the Practice
  // context. The existing workspaces remain available through the explicit
  // `surface=workspace` deep link so their data/state contracts stay intact.
  const showSessionPicker = query.get('surface') !== 'workspace' && (query.get('select') === '1' || query.get('mode') === 'Practice')
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
    content = showSessionPicker ? <SessionPicker kind="analytics" workspace={workspace} query={query} /> : <AnalyticsWorkspace workspace={workspace} query={query} />
    mode = 'Analytics'
  } else if (activeView === 'trade') {
    content = showSessionPicker ? <SessionPicker kind="trade" workspace={workspace} query={query} /> : <TradeWorkspace workspace={workspace} query={query} />
    mode = 'Simulator'
  } else if (activeView === 'risk') {
    content = <RiskWorkspace workspace={workspace} query={query} />
    mode = 'Risk lab'
  } else if (activeView === 'playbook') {
    content = <PlaybookWorkspace workspace={workspace} query={query} />
    mode = 'Playbook'
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

  const chartWorkspace = activeView === 'replay' && query.get('surface') === 'workspace' && Boolean(query.get('session'))
  const renderedContent = SHELL_SKELETON_MODE && !chartWorkspace ? null : content
  return <FxReplayShell workspace={workspace} query={query} activeView={activeView} mode={mode}>{renderedContent}</FxReplayShell>
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
