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
import './styles.css'

function WorkspaceOverview({ workspace }) {
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

  const counts = overview.payload?.counts || {}
  const datasetCount = Number.isFinite(Number(counts.datasets)) ? Number(counts.datasets) : null
  const completedResearch = Number(counts.research_jobs?.completed || 0)
  const replayCount = Number(counts.records?.replay || 0)

  return (
    <section className="fx-overview" aria-labelledby="overview-title">
      <div className="fx-page-heading">
        <div>
          <span className="fx-eyebrow">TRADING WORKSPACE / SESSION CONTROL</span>
          <h1 id="overview-title">Tiếp tục phiên của bạn</h1>
          <p>Chart, replay và quyết định nằm trong cùng một context. Chọn Practice để mở đúng vòng lặp FXReplay.</p>
        </div>
        <a className="fx-primary-button" href={`/?workspace=${encodeURIComponent(workspace)}&view=replay`}>Mở Practice</a>
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
          <div className="fx-section-heading"><div><span className="fx-eyebrow">NEXT ACTION</span><h2 id="queue-title">Việc cần làm</h2></div><span className="fx-muted-label">3 bước</span></div>
          <a className="fx-queue-row is-primary" href={`/?workspace=${encodeURIComponent(workspace)}&view=replay`}>
            <span className="fx-queue-index">01</span><span><strong>Mở một replay session</strong><small>Chọn dataset, symbol và decision cutoff</small></span><b>→</b>
          </a>
          <a className="fx-queue-row" href={`/?workspace=${encodeURIComponent(workspace)}&view=research`}>
            <span className="fx-queue-index">02</span><span><strong>Kiểm tra research run</strong><small>Kết quả chỉ hiển thị khi có job ID hợp lệ</small></span><b>→</b>
          </a>
          <a className="fx-queue-row" href={`/?workspace=${encodeURIComponent(workspace)}&view=learn`}>
            <span className="fx-queue-index">03</span><span><strong>Ôn glossary trước phiên</strong><small>Learn đọc từ course local, không tự ghi tiến độ</small></span><b>→</b>
          </a>
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
  let mode = activeView === 'research' ? 'Research' : activeView === 'learn' ? 'Learn' : 'Replay'

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
    content = <WorkspaceOverview workspace={workspace} />
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
    content = <UnavailableWorkspace eyebrow={copy[0]} title={copy[1]} description={copy[2]} next={copy[3]} href={`/?workspace=${encodeURIComponent(workspace)}&view=replay`} />
  }

  return <FxReplayShell workspace={workspace} activeView={activeView} mode={mode}>{content}</FxReplayShell>
}

createRoot(document.getElementById('root')).render(<App />)
