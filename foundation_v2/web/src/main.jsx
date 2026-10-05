import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import LearnWorkspace from './LearnWorkspace.jsx'
import PropWorkspace from './PropWorkspace.jsx'
import PropAnalytics from './PropAnalytics.jsx'
import ReplayWorkspace from './ReplayWorkspace.jsx'
import FxReplayShell from './FxReplayShell.jsx'
import AnalyticsWorkspace from './AnalyticsWorkspace.jsx'
import JournalWorkspace from './JournalWorkspace.jsx'
import SettingsWorkspace from './SettingsWorkspace.jsx'
import DataDeskWorkspace from './DataDeskWorkspace.jsx'
import MarketAssetCatalog from './MarketAssetCatalog.jsx'
import ResearchWorkspaceV2 from './ResearchWorkspace.jsx'
import TradeWorkspace from './TradeWorkspace.jsx'
import RiskWorkspace from './RiskWorkspace.jsx'
import PlaybookWorkspace from './PlaybookWorkspace.jsx'
import LiveWorkspace from './LiveWorkspace.jsx'
import SessionPicker from './SessionPicker.jsx'
import SessionReports from './SessionReports.jsx'
import DashboardSessions from './DashboardSessions.jsx'
import DemoPreview from './DemoPreview.jsx'
import { canPreviewDemo, demoToggleHref } from './demoMode.js'
import { buildWorkspaceHref } from './workspaceContext.js'
import './styles.css'
import './dashboard.css'
import './workspace-pattern.css'
import './page-layout.css'
import './component-interactions.css'

function WorkspaceOverview({ workspace, query }) {
  return <section className="fx-dashboard" aria-label="Dashboard"><div className="fx-dashboard-inner"><DashboardSessions key={workspace} workspace={workspace} query={query} /></div></section>
}

function UnavailableWorkspace({ title, eyebrow, description, next, href }) {
  return (
    <section className="fx-unavailable wm-page" aria-labelledby="unavailable-title">
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
  const [demo, setDemo] = useState(query.get('demo') === '1')
  const workspace = query.get('workspace') || 'tenant-a'
  const requestedView = query.get('view')
  // Preserve deep links emitted by the research/learn flows while keeping a bare root on the overview.
  const activeView = requestedView || (query.has('job') ? 'research' : query.has('session') || query.has('dataset') ? 'replay' : 'overview')
  // Trading tabs open persisted reports. Order entry is an explicit chart action.
  const showSessionPicker = query.get('surface') !== 'workspace' && (query.get('select') === '1' || query.get('mode') === 'Practice')
  const showTradeLedger = query.get('intent') !== 'order'
  const showSessionAnalytics = query.get('surface') !== 'workspace' && !query.get('job') && !query.get('job_id')
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
  } else if (activeView === 'market-data') {
    content = <main className="wm-page market-data-workspace" aria-label="Market Data"><h1 className="sr-only">Market Data</h1><MarketAssetCatalog workspace={workspace} query={query} showHeading={false} /></main>
    mode = 'Data'
  } else if (activeView === 'overview') {
    content = <WorkspaceOverview workspace={workspace} query={query} />
  } else if (activeView === 'journal') {
    content = <JournalWorkspace workspace={workspace} query={query} />
    mode = 'Journal'
  } else if (activeView === 'analytics') {
    content = query.get('analytics_source') === 'prop' ? <PropAnalytics workspace={workspace} query={query} /> : showSessionAnalytics ? <SessionReports workspace={workspace} query={query} /> : <AnalyticsWorkspace workspace={workspace} query={query} />
    mode = 'Analytics'
  } else if (activeView === 'trade') {
    content = showTradeLedger ? <SessionReports ledgerOnly workspace={workspace} query={query} /> : <TradeWorkspace workspace={workspace} query={query} />
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

  const demoAvailable = canPreviewDemo(activeView, query)
  const toggleDemo = () => {
    window.history.replaceState({}, '', demoToggleHref(window.location.href, !demo))
    setDemo(!demo)
  }
  // Unmount real data readers during preview; fixtures never reach mutation handlers.
  if (demo && demoAvailable) content = <DemoPreview key={`${activeView}:${query.get('analytics_source')}:${query.get('section')}`} view={activeView} workspace={workspace} query={query} />
  const subnavAction = demoAvailable && <div className="wm-demo-action">{demo && <span className="wm-demo-label" role="status">Demo · Dữ liệu mẫu</span>}<button type="button" className="fxa-button" aria-pressed={demo} onClick={toggleDemo}>{demo ? 'Show real data' : 'Show demo data'}</button></div>
  return <FxReplayShell workspace={workspace} query={query} activeView={activeView} mode={mode} subnavAction={subnavAction}>{content}</FxReplayShell>
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
