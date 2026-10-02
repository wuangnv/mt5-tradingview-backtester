import { useEffect, useMemo, useState } from 'react'
import { buildWorkspaceHref } from './workspaceContext.js'
import './live-workspace.css'

const LIVE_STATUS_URL = '/api/v2/live/status'

const LIVE_SECTIONS = Object.freeze({
  calendar: {
    label: 'Calendar',
    title: 'Market calendar',
    description: 'Lịch sự kiện chỉ hiển thị khi workspace có một market-data source đã được xác minh.',
    emptyTitle: 'Chưa có market calendar source',
    emptyCopy: 'Không tự tải dữ liệu thị trường ở màn này. Kết nối local hoặc dataset đã xác minh trước khi hiển thị sự kiện.',
  },
  trades: {
    label: 'Trades',
    title: 'Live trades',
    description: 'Đây là vùng read-only để xem snapshot được cấp quyền; màn này không gửi lệnh.',
    emptyTitle: 'Chưa có read-only trade feed',
    emptyCopy: 'Chưa có nguồn trade snapshot nào được gắn với workspace. Broker/live execution vẫn bị khóa.',
  },
  notes: {
    label: 'Notes',
    title: 'Market notes',
    description: 'Ghi chú thị trường phải giữ provenance; dữ liệu trống không được thay bằng ví dụ giả.',
    emptyTitle: 'Chưa có market notes',
    emptyCopy: 'Mở Journal từ một replay session để ghi chú có context. Live notes chưa có nguồn dữ liệu riêng.',
  },
  'tag-analytics': {
    label: 'Tag analytics',
    title: 'Tag analytics',
    description: 'Phân tích tag chỉ chạy trên trade ledger đã được chọn và có provenance.',
    emptyTitle: 'Chưa có ledger để phân tích',
    emptyCopy: 'Không suy ra tỷ lệ, P/L hoặc tín hiệu từ dữ liệu live khi chưa có ledger canonical.',
  },
  'trading-accounts': {
    label: 'Trading accounts',
    title: 'Trading accounts',
    description: 'Account identity và capability phải được cấp rõ ràng trước khi hiển thị trạng thái.',
    emptyTitle: 'Chưa có account capability',
    emptyCopy: 'Không có account identity hoặc credential nào được đọc từ UI này; live và broker access vẫn fail-closed.',
  },
})

function statusError(message, kind = 'error') {
  const error = new Error(message)
  error.kind = kind
  return error
}

async function readLiveStatus(workspace, signal) {
  const response = await fetch(LIVE_STATUS_URL, {
    method: 'GET',
    headers: { 'X-Workspace-Id': workspace },
    signal,
  })
  const payload = await response.json().catch(() => null)
  if (response.status === 404 || response.status === 501) throw statusError('live_status_unavailable', 'unavailable')
  if (!response.ok) throw statusError(String(payload?.detail || `HTTP ${response.status}`), response.status === 403 ? 'denied' : 'error')
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw statusError('invalid_live_status_payload', 'unavailable')
  if (!['ready', 'unavailable', 'locked'].includes(payload.status)) throw statusError('invalid_live_status_state', 'unavailable')
  return payload
}

function statusCopy(state) {
  if (state.status === 'loading') return { tone: 'loading', title: 'Đang đọc live status', detail: 'Chỉ đọc metadata local; chưa có quyền market hoặc broker.' }
  if (state.status === 'ready') return { tone: 'ready', title: 'Read-only status đã sẵn sàng', detail: 'Status này không cấp quyền gửi lệnh hoặc truy cập account.' }
  if (state.status === 'denied') return { tone: 'denied', title: 'Workspace không có quyền đọc live status', detail: 'Permission boundary đang giữ nguyên; không thử đăng nhập hoặc gọi broker.' }
  if (state.status === 'unavailable') return { tone: 'unavailable', title: 'Live adapter chưa được cấu hình', detail: 'Không có market/account snapshot để hiển thị trong workspace này.' }
  if (state.status === 'locked') return { tone: 'unavailable', title: 'Live đang bị khóa theo policy', detail: 'Workspace nhận được status nhưng chưa có capability read-only nào được cấp.' }
  return { tone: 'error', title: 'Không đọc được live status', detail: state.error?.message || 'Thử lại sau khi local service ổn định.' }
}

function LiveState({ state, onRetry }) {
  const copy = statusCopy(state)
  return (
    <section className={`live-status live-status-${copy.tone}`} aria-live="polite" data-testid="live-status" role={copy.tone === 'error' || copy.tone === 'denied' ? 'alert' : 'status'}>
      <span className="live-status-mark" aria-hidden="true">{copy.tone === 'ready' ? '✓' : copy.tone === 'loading' ? '…' : '—'}</span>
      <div className="live-status-copy"><strong>{copy.title}</strong><span>{copy.detail}</span></div>
      {copy.tone === 'error' && <button type="button" className="live-retry" onClick={onRetry}>Thử lại</button>}
    </section>
  )
}

function PermissionBoundary() {
  const items = [
    ['Market feed', 'Chưa cấp'],
    ['Account identity', 'Chưa cấp'],
    ['Broker send', 'Đã khóa'],
    ['Holdout / external write', 'PREP_ONLY'],
  ]
  return (
    <section className="live-permission" aria-labelledby="live-permission-title" data-testid="live-permission">
      <div className="live-section-heading"><div><span className="live-eyebrow">PERMISSION BOUNDARY</span><h2 id="live-permission-title">Live remains read-only</h2></div><span className="live-badge">FAIL-CLOSED</span></div>
      <p>Live có route để làm rõ trạng thái, không phải để mở execution authority. Mọi capability chưa có receipt đều giữ ở trạng thái khóa.</p>
      <dl className="live-permission-grid">{items.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    </section>
  )
}

function EmptySurface({ section, workspace, query }) {
  const journalHref = buildWorkspaceHref('journal', workspace, query, { section: null })
  const dataHref = buildWorkspaceHref('data', workspace, query, { section: null })
  const href = section === 'notes' ? journalHref : dataHref
  const action = section === 'notes' ? 'Mở Journal local' : 'Mở Data Desk'
  return (
    <section className="live-surface" aria-labelledby="live-surface-title" data-testid="live-surface">
      <div className="live-surface-heading"><div><span className="live-eyebrow">LIVE / {LIVE_SECTIONS[section].label.toUpperCase()}</span><h2 id="live-surface-title">{LIVE_SECTIONS[section].title}</h2><p>{LIVE_SECTIONS[section].description}</p></div><span className="live-readonly">READ ONLY</span></div>
      <div className="live-empty" data-testid="live-empty"><span className="live-empty-mark" aria-hidden="true">—</span><div><strong>{LIVE_SECTIONS[section].emptyTitle}</strong><p>{LIVE_SECTIONS[section].emptyCopy}</p></div></div>
      <a className="live-secondary-button" href={href}>{action} <span aria-hidden="true">→</span></a>
    </section>
  )
}

export default function LiveWorkspace({ workspace = 'tenant-a', query = new URLSearchParams(window.location.search) }) {
  const requestedSection = query.get('section')
  const section = LIVE_SECTIONS[requestedSection] ? requestedSection : 'calendar'
  const [reloadToken, setReloadToken] = useState(0)
  const [state, setState] = useState({ status: 'loading', payload: null, error: null })

  useEffect(() => {
    const controller = new AbortController()
    setState({ status: 'loading', payload: null, error: null })
    readLiveStatus(workspace, controller.signal)
      .then((payload) => setState({ status: payload.status, payload, error: null }))
      .catch((error) => {
        if (error.name !== 'AbortError') setState({ status: error.kind || 'error', payload: null, error })
      })
    return () => controller.abort()
  }, [reloadToken, workspace])

  const surface = useMemo(() => <EmptySurface section={section} workspace={workspace} query={query} />, [query, section, workspace])
  return (
    <main className="live-workspace" data-testid="live-workspace">
      <header className="live-topbar"><div><span className="live-eyebrow">WORKSPACE / LIVE</span><h1>Live workspace</h1><p>Kiểm tra capability và snapshot read-only trước khi đưa bất kỳ dữ liệu nào vào workflow.</p></div><span className="live-topbar-lock">BROKER LOCKED</span></header>
      <section className="live-context" aria-label="Live context"><span>Workspace <strong>{workspace}</strong></span><span>Surface <strong>{LIVE_SECTIONS[section].label}</strong></span><span>Mode <strong>Read only</strong></span><span>External write <strong>PREP_ONLY</strong></span></section>
      <LiveState state={state} onRetry={() => setReloadToken((value) => value + 1)} />
      <PermissionBoundary />
      {surface}
      <footer className="live-footnote">Status endpoint: <code>{LIVE_STATUS_URL}</code> · Không có broker request từ màn này.</footer>
    </main>
  )
}

export { LIVE_SECTIONS, readLiveStatus, statusCopy }
