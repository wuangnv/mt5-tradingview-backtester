import { useEffect, useMemo, useState } from 'react'
import { buildWorkspaceHref } from './workspaceContext.js'
import './live-workspace.css'
import LiveBrokerSnapshot from './LiveBrokerSnapshot.jsx'

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
  if (state.status === 'ready') return state.payload?.stale ? { tone: 'unavailable', title: 'Snapshot cũ — chưa xác nhận trạng thái hiện tại', detail: state.payload.error || 'Chưa nhận được lần đồng bộ mới.' } : { tone: 'ready', title: 'Read-only feed đã sẵn sàng', detail: 'Dữ liệu tài khoản và giao dịch từ broker; không cấp quyền gửi lệnh.' }
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

function PermissionBoundary({ payload }) {
  const items = [
    ['Market feed', payload?.account ? 'Snapshot read-only' : 'Chưa cấp'],
    ['Account identity', payload?.account ? 'Exness demo được cấp' : 'Chưa cấp'],
    ['Broker send', 'Đã khóa'],
    ['Holdout / external write', 'PREP_ONLY'],
  ]
  return (
    <section className="live-permission" aria-labelledby="live-permission-title" data-testid="live-permission">
      <div className="live-section-heading"><div><h2 id="live-permission-title">Phạm vi truy cập</h2></div><span className="live-badge">FAIL-CLOSED</span></div>
      <p>Màn này chỉ đọc trạng thái. Các quyền chưa được cấp vẫn giữ khóa.</p>
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
      <div className="live-surface-heading"><h2 id="live-surface-title">Dữ liệu read-only</h2></div>
      <div className="live-empty" data-testid="live-empty"><span className="live-empty-mark" aria-hidden="true">—</span><div><strong>{LIVE_SECTIONS[section].emptyTitle}</strong><p>{LIVE_SECTIONS[section].emptyCopy}</p></div></div>
      <a className="live-secondary-button" href={href}>{action} <span aria-hidden="true">→</span></a>
    </section>
  )
}

export default function LiveWorkspace({ workspace = 'tenant-a', query = new URLSearchParams(window.location.search) }) {
  const requestedSection = query.get('section')
  const section = LIVE_SECTIONS[requestedSection] ? requestedSection : 'calendar'
  const [reloadToken, setReloadToken] = useState(0)
  const [snapshot, setState] = useState({ workspace, status: 'loading', payload: null, error: null })
  const state = snapshot.workspace === workspace ? snapshot : { status: 'loading', payload: null, error: null }

  useEffect(() => {
    const controller = new AbortController()
    setState({ workspace, status: 'loading', payload: null, error: null })
    let refreshing = false
    const refresh = async () => {
      if (refreshing) return
      refreshing = true
      try {
        const payload = await readLiveStatus(workspace, controller.signal)
        if (!controller.signal.aborted) setState({ workspace, status: payload.status, payload, error: null })
      } catch (error) {
        if (!controller.signal.aborted) setState(previous => ({ workspace, status: error.kind || 'error',
          payload: error.kind === 'denied' || previous.workspace !== workspace ? null : previous.payload ? { ...previous.payload, stale: true } : null, error }))
      } finally { refreshing = false }
    }
    refresh()
    const timer = setInterval(refresh, 5000)
    return () => { controller.abort(); clearInterval(timer) }
  }, [reloadToken, workspace])

  const surface = useMemo(() => <EmptySurface section={section} workspace={workspace} query={query} />, [query, section, workspace])
  return (
    <main className="live-workspace wm-page" data-testid="live-workspace">
      <header className="live-topbar wm-page-header"><h1>{LIVE_SECTIONS[section].title}</h1><span className="live-topbar-lock">Broker đã khóa</span></header>
      <section className="live-context" aria-label="Live context"><span>Workspace <strong>{workspace}</strong></span><span>Surface <strong>{LIVE_SECTIONS[section].label}</strong></span><span>Mode <strong>Read only</strong></span><span>External write <strong>PREP_ONLY</strong></span></section>
      <LiveState state={state} onRetry={() => setReloadToken((value) => value + 1)} />
      {state.payload?.account && ['trades', 'trading-accounts'].includes(section) ? <LiveBrokerSnapshot payload={state.payload} section={section} /> : surface}
      <PermissionBoundary payload={state.payload} />
      <footer className="live-footnote">Testing và Live có dữ liệu riêng. App chỉ đọc broker; không có thao tác gửi lệnh trên màn này.</footer>
    </main>
  )
}

export { LIVE_SECTIONS, readLiveStatus, statusCopy }
