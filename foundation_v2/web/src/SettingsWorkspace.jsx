import React, { useCallback, useEffect, useMemo, useState } from 'react'
import './settings.css'

const NOTION_STATUS_URL = '/api/v2/connectors/notion/oauth/status'

function apiError(response, payload) {
  const error = new Error(String(payload?.detail || `HTTP ${response.status}`))
  error.kind = response.status === 403 ? 'denied' : response.status === 404 || response.status === 503 ? 'unavailable' : 'error'
  error.status = response.status
  return error
}

async function readJson(url, workspace) {
  const response = await fetch(url, { method: 'GET', headers: { 'X-Workspace-Id': workspace } })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw apiError(response, payload)
  return payload
}

function display(value, fallback = 'Chưa rõ') {
  if (value === null || value === undefined || value === '') return fallback
  return String(value)
}

function statusLabel(status) {
  return {
    connected: 'Đã kết nối',
    disconnected: 'Chưa kết nối',
    reconnect_required: 'Cần kết nối lại',
    expired: 'Đã hết hạn',
    revoked: 'Đã thu hồi',
    unavailable: 'Chưa cấu hình',
    loading: 'Đang đọc…',
    error: 'Không đọc được',
  }[status] || display(status)
}

function statusTone(status) {
  if (status === 'connected') return 'is-good'
  if (status === 'disconnected' || status === 'unavailable') return 'is-muted'
  if (status === 'loading') return 'is-loading'
  return 'is-warn'
}

function SettingState({ state, testId, children }) {
  if (state === 'loading') return <p className="settings-message is-loading" role="status" data-testid={testId}>Đang đọc trạng thái workspace…</p>
  if (state === 'denied') return <p className="settings-message is-error" role="alert" data-testid={testId}>Workspace này không có quyền đọc Settings.</p>
  if (state === 'unavailable') return <p className="settings-message is-warn" role="status" data-testid={testId}>{children || 'Thông tin chưa được cấu hình.'}</p>
  if (state === 'error') return <p className="settings-message is-error" role="alert" data-testid={testId}>{children || 'Không đọc được trạng thái.'}</p>
  return null
}

function Fact({ label, value, tone = '' }) {
  return (
    <div className="settings-fact">
      <dt>{label}</dt>
      <dd className={tone}>{value}</dd>
    </div>
  )
}

function StatusBadge({ status, children }) {
  return <span className={`settings-status ${statusTone(status)}`}><i aria-hidden="true" />{children || statusLabel(status)}</span>
}

function hrefFor(view, workspace) {
  const params = new URLSearchParams({ workspace })
  if (view) params.set('view', view)
  return `/?${params.toString()}`
}

export default function SettingsWorkspace({ workspace = 'tenant-a', query }) {
  const [session, setSession] = useState({ status: 'loading', payload: null, error: null })
  const [notion, setNotion] = useState({ status: 'loading', payload: null, error: null })

  const load = useCallback(() => {
    let cancelled = false
    setSession({ status: 'loading', payload: null, error: null })
    setNotion({ status: 'loading', payload: null, error: null })

    readJson('/api/v2/session/status', workspace)
      .then((payload) => { if (!cancelled) setSession({ status: 'ready', payload, error: null }) })
      .catch((error) => { if (!cancelled) setSession({ status: error.kind || 'error', payload: null, error }) })

    readJson(NOTION_STATUS_URL, workspace)
      .then((payload) => { if (!cancelled) setNotion({ status: 'ready', payload, error: null }) })
      .catch((error) => { if (!cancelled) setNotion({ status: error.kind || 'error', payload: null, error }) })

    return () => { cancelled = true }
  }, [workspace])

  useEffect(() => load(), [load])

  const returnView = query?.get('from') === 'replay' ? 'replay' : ''
  const sessionPayload = session.payload || {}
  const sessionSnapshot = sessionPayload.session || {}
  const identity = sessionPayload.identity || {}
  const notionPayload = notion.payload || {}
  const notionStatus = notion.status === 'ready' ? notionPayload.status || 'disconnected' : notion.status
  const canShowFacts = session.status === 'ready'
  const mode = query?.get('mode') || 'Replay / Simulation'
  const dataStatus = query?.get('data') || 'Local cache'
  const nextLink = returnView ? hrefFor(returnView, workspace) : hrefFor('replay', workspace)

  const permissions = useMemo(() => [
    ['Replay & practice', 'Cho phép', 'is-good'],
    ['Research local', 'Cho phép', 'is-good'],
    ['Demo simulator', 'Cho phép', 'is-good'],
    ['Gửi lệnh broker', 'Đã khóa', 'is-warn'],
    ['Live execution', 'Đã khóa', 'is-warn'],
    ['Holdout data', 'Đã khóa', 'is-warn'],
    ['Cloud write / export', 'PREP_ONLY', 'is-warn'],
  ], [])

  return (
    <main className="settings-shell" data-testid="settings-workspace">
      <header className="settings-topbar">
        <div>
          <div className="eyebrow">WORKSPACE / SETTINGS</div>
          <h1>Settings</h1>
          <p>Kiểm tra ngữ cảnh, dữ liệu và quyền trước khi quay lại phiên replay.</p>
        </div>
        <div className="settings-topbar-actions">
          <a className="context-link" href={nextLink}>{returnView ? 'Về Replay' : 'Mở Practice'}</a>
          <a className="context-link" href={hrefFor('learn', workspace)}>Learn</a>
          <button type="button" className="settings-refresh" onClick={load} disabled={session.status === 'loading' || notion.status === 'loading'}>Làm mới</button>
        </div>
      </header>

      <section className="settings-context" aria-label="Ngữ cảnh hiện tại">
        <div><span>Workspace</span><strong>{workspace}</strong></div>
        <div><span>Mode</span><strong>{mode}</strong></div>
        <div><span>Data</span><strong>{dataStatus}</strong></div>
        <div><span>Broker</span><strong className="is-warn">Locked</strong></div>
      </section>

      <SettingState state={session.status} testId="settings-session-loading" />
      {session.status === 'error' && <SettingState state="error" testId="settings-session-error">Không đọc được project session: {session.error?.message}</SettingState>}
      {session.status === 'denied' && <SettingState state="denied" testId="settings-session-denied" />}
      {session.status === 'unavailable' && <SettingState state="unavailable" testId="settings-session-unavailable">Project session chưa được cấu hình cho workspace này.</SettingState>}

      <section className="settings-grid" aria-label="Thiết lập và quyền workspace">
        <article className="settings-section settings-session" aria-labelledby="settings-session-title">
          <div className="settings-heading">
            <div><span>Project session</span><h2 id="settings-session-title">Phiên local hiện tại</h2></div>
            {canShowFacts && <StatusBadge status={sessionSnapshot.status}>{statusLabel(sessionSnapshot.status)}</StatusBadge>}
          </div>
          {session.status === 'loading' && <SettingState state="loading" testId="settings-session-facts-loading" />}
          {session.status === 'ready' && (
            <dl className="settings-facts" data-testid="settings-session-facts">
              <Fact label="Auth mode" value={display(sessionPayload.auth_mode)} />
              <Fact label="Production auth" value={sessionPayload.production_auth === true ? 'Bật' : 'Tắt'} tone="is-warn" />
              <Fact label="Identity" value={display(identity.marker)} />
              <Fact label="Identity source" value={display(identity.source)} />
              <Fact label="Session id" value={display(sessionSnapshot.session_id)} />
              <Fact label="Credentials" value={sessionPayload.credentials_present === true ? 'Có' : 'Không'} />
            </dl>
          )}
          <p className="settings-note">Đây là session local/demo để dùng Workspace. Nó không phải đăng nhập production và không cấp quyền broker.</p>
        </article>

        <article className="settings-section" aria-labelledby="settings-permissions-title">
          <div className="settings-heading"><div><span>Safety boundary</span><h2 id="settings-permissions-title">Quyền đang áp dụng</h2></div><StatusBadge status="is-warn">Fail-closed</StatusBadge></div>
          <ul className="settings-permissions" data-testid="settings-permissions">
            {permissions.map(([label, value, tone]) => <li key={label}><span>{label}</span><strong className={tone}>{value}</strong></li>)}
          </ul>
          <p className="settings-note">Replay, research và demo simulator có thể dùng local. Live, holdout và cloud write vẫn bị khóa ở lớp sản phẩm.</p>
        </article>

        <article className="settings-section settings-connector" aria-labelledby="settings-connector-title">
          <div className="settings-heading">
            <div><span>Provider boundary</span><h2 id="settings-connector-title">Notion</h2></div>
            <StatusBadge status={notionStatus}>{statusLabel(notionStatus)}</StatusBadge>
          </div>
          {notion.status === 'loading' && <SettingState state="loading" testId="settings-notion-loading" />}
          {notion.status === 'denied' && <SettingState state="denied" testId="settings-notion-denied" />}
          {notion.status === 'unavailable' && <SettingState state="unavailable" testId="settings-notion-unavailable">Notion OAuth chưa cấu hình. Bạn vẫn dùng được phần local.</SettingState>}
          {notion.status === 'error' && <SettingState state="error" testId="settings-notion-error">Không đọc được Notion status: {notion.error?.message}</SettingState>}
          {notion.status === 'ready' && (
            <dl className="settings-facts" data-testid="settings-notion-facts">
              <Fact label="OAuth" value={notionPayload.oauth_available ? 'Đã cấu hình' : 'Chưa cấu hình'} />
              <Fact label="Export mode" value={display(notionPayload.export_mode, 'PREP_ONLY')} tone="is-warn" />
              <Fact label="Cloud write" value={notionPayload.cloud_write === true ? 'Bật' : 'Tắt'} tone="is-warn" />
              <Fact label="Identity / permission" value={notionPayload.provider_identity_verified && notionPayload.provider_permission_verified ? 'Đã xác minh' : 'Chưa xác minh'} tone="is-warn" />
              <Fact label="Token persistence" value={display(notionPayload.token_persistence, 'Không có')} />
            </dl>
          )}
          <p className="settings-note">Notion chỉ là connector chuẩn bị. Settings không tự đăng nhập, không ghi page và không upload report.</p>
        </article>

        <article className="settings-section settings-local" aria-labelledby="settings-local-title">
          <div className="settings-heading"><div><span>Local product</span><h2 id="settings-local-title">Nguồn dữ liệu</h2></div><StatusBadge status="connected">Local</StatusBadge></div>
          <dl className="settings-facts">
            <Fact label="Chart / replay" value="Local dataset" />
            <Fact label="Verified range" value="Chưa bật" tone="is-warn" />
            <Fact label="Learn" value="Course local · read-only" />
            <Fact label="Simulator" value="Demo local" />
          </dl>
          <p className="settings-note">Không có provider ngoài nào được ngầm coi là connected. Khi data chưa verified, UI phải giữ nhãn local và không suy ra live readiness.</p>
        </article>
      </section>

      <footer className="settings-footnote">
        <span>Workspace <strong>{workspace}</strong></span>
        <span>Mode <strong>{mode}</strong></span>
        <span>Live <strong className="is-warn">Locked</strong></span>
        <span>Provider write <strong className="is-warn">PREP_ONLY</strong></span>
      </footer>
    </main>
  )
}
