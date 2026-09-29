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
import { useFxReplayContext } from './FxReplayShell.jsx'
import { buildWorkspaceHref } from './workspaceContext.js'
import './styles.css'

function WorkspaceOverview({ workspace, query }) {
  const { updateMarketContext } = useFxReplayContext()
  const [overview, setOverview] = useState({ status: 'loading', payload: null, error: null })

  useEffect(() => {
    let cancelled = false
    fetch('/api/v2/overview', { headers: { 'X-Workspace-Id': workspace } })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(String(payload.detail || `HTTP ${response.status}`))
        return payload
      })
      .then((payload) => { if (!cancelled) setOverview({ status: 'ready', payload, error: null }) })
      .catch((error) => { if (!cancelled) setOverview({ status: 'error', payload: null, error: String(error.message || error) }) })
    return () => { cancelled = true }
  }, [workspace])

  useEffect(() => {
    let cancelled = false
    fetch('/api/v2/data/datasets', { headers: { 'X-Workspace-Id': workspace } })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        const dataset = Array.isArray(payload?.items) ? payload.items[0] : null
        if (!cancelled && dataset) {
          updateMarketContext({
            instrument: String(dataset.instrument_id || dataset.dataset_id || ''),
            timeframe: String(dataset.timeframe || 'TF chưa rõ'),
            dataStatus: String(dataset.quality_status || 'unverified'),
          })
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [updateMarketContext, workspace])

  const counts = overview.payload?.counts || {}
  const datasetCount = Number.isFinite(Number(counts.datasets)) ? Number(counts.datasets) : null
  const completedResearch = Number(counts.research_jobs?.completed || 0)
  const replayCount = Number(counts.records?.replay || 0)
  const sessionId = query?.get('session') || ''
  const jobId = query?.get('job') || ''
  const routeHref = (view, overrides = {}) => buildWorkspaceHref(view, workspace, query, overrides)
  const queueItems = [
    replayCount > 0
      ? {
          title: sessionId ? 'Tiếp tục replay session' : 'Mở Practice để xem replay',
          detail: sessionId ? 'Giữ nguyên dataset và decision cutoff hiện tại' : `${replayCount} replay record đã có trong workspace`,
          href: routeHref('replay', sessionId ? {} : { session: null, dataset: null, cursor: null, cutoff: null }),
        }
      : {
          title: 'Mở một replay session',
          detail: 'Chọn dataset local trước khi đưa ra quyết định',
          href: routeHref('replay'),
        },
    completedResearch > 0
      ? {
          title: 'Xem research đã hoàn tất',
          detail: jobId ? 'Mở lại result với provenance của job hiện tại' : `${completedResearch} research job đã hoàn tất`,
          href: routeHref('research', jobId ? { job: jobId } : {}),
        }
      : {
          title: 'Chuẩn bị research run',
          detail: datasetCount > 0 ? 'Chọn dataset và kiểm tra provenance trước khi chạy' : 'Cần dataset local trước khi chạy',
          href: routeHref(datasetCount > 0 ? 'research' : 'data'),
        },
    datasetCount > 0
      ? {
          title: 'Ôn glossary trước phiên',
          detail: 'Learn đọc course local ở chế độ read-only',
          href: routeHref('learn'),
        }
      : {
          title: 'Nạp dataset local',
          detail: 'Data Desk là điểm bắt đầu của workflow trading',
          href: routeHref('data'),
        },
  ]

  return (
    <section className="fx-overview" aria-labelledby="overview-title">
      <div className="fx-page-heading">
        <div>
          <span className="fx-eyebrow">TRADING WORKSPACE / SESSION CONTROL</span>
          <h1 id="overview-title">Tiếp tục phiên của bạn</h1>
          <p>Chart, replay và quyết định nằm trong cùng một context. Chọn Practice để mở đúng vòng lặp FXReplay.</p>
        </div>
        <a className="fx-primary-button" href={routeHref('replay')}>Mở Practice</a>
      </div>

      <section className="fx-session-banner" aria-label="Phiên hiện tại">
        <div className="fx-session-main">
          <div className="fx-session-kicker"><i className="fx-status-dot is-live" /> REPLAY SESSION · LOCAL</div>
          <strong>{datasetCount === null ? 'EURUSD · default' : `${datasetCount} dataset trong workspace`}</strong>
          <span>{overview.status === 'ready' ? `${completedResearch} research hoàn tất · ${replayCount} replay record` : overview.status === 'error' ? `Không đọc được overview: ${overview.error}` : 'Đang đọc trạng thái workspace…'}</span>
        </div>
        <div className="fx-session-fact"><span>Broker</span><strong>Locked</strong></div>
        <div className="fx-session-fact"><span>Data</span><strong>{datasetCount === null ? 'Chưa xác định' : `${datasetCount} catalog`}</strong></div>
        <div className="fx-session-fact"><span>Risk</span><strong>Chưa cấu hình</strong></div>
      </section>

      <div className="fx-overview-grid">
        <section className="fx-work-queue" aria-labelledby="queue-title">
          <div className="fx-section-heading"><div><span className="fx-eyebrow">NEXT ACTION</span><h2 id="queue-title">Việc cần làm</h2></div><span className="fx-muted-label">{queueItems.length} mục theo workspace</span></div>
          {queueItems.map((item, index) => (
            <a className={`fx-queue-row ${index === 0 ? 'is-primary' : ''}`} href={item.href} key={`${item.title}-${index}`}>
              <span className="fx-queue-index">{String(index + 1).padStart(2, '0')}</span><span><strong>{item.title}</strong><small>{item.detail}</small></span><b>→</b>
            </a>
          ))}
        </section>

        <section className="fx-context-panel" aria-labelledby="context-title">
          <div className="fx-section-heading"><div><span className="fx-eyebrow">SESSION CONTEXT</span><h2 id="context-title">Phạm vi đang dùng</h2></div></div>
          <dl className="fx-context-list">
            <div><dt>Workspace</dt><dd><code>{workspace}</code></dd></div>
            <div><dt>Mode</dt><dd><span className="fx-pill fx-pill-warn">Replay / Simulation</span></dd></div>
            <div><dt>Broker send</dt><dd><span className="fx-pill fx-pill-locked">Locked</span></dd></div>
            <div><dt>Holdout</dt><dd>Chưa mở</dd></div>
            <div><dt>Provenance</dt><dd>{datasetCount === null ? 'Chưa xác định' : 'Catalog local · kiểm tra ở Data Desk'}</dd></div>
            <div><dt>Overview API</dt><dd>{overview.status === 'ready' ? 'Đã đọc' : overview.status === 'loading' ? 'Đang đọc' : 'Unavailable'}</dd></div>
          </dl>
        </section>
      </div>
    </section>
  )
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
    content = <ReplayWorkspace workspace={workspace} query={query} />
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
    content = <AnalyticsWorkspace workspace={workspace} query={query} />
    mode = 'Analytics'
  } else if (activeView === 'trade') {
    content = <TradeWorkspace workspace={workspace} query={query} />
    mode = 'Simulator'
  } else if (activeView === 'risk') {
    content = <RiskWorkspace workspace={workspace} query={query} />
    mode = 'Risk lab'
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
