import React, { useEffect, useRef, useState } from 'react'
import { buildWorkspaceHref } from './workspaceContext.js'
import { useFxReplayContext } from './FxReplayShell.jsx'
import './settings.css'

const NOTION_STATUS_URL = '/api/v2/connectors/notion/oauth/status'

function apiError(response, payload) {
  const error = new Error(String(payload?.detail || `HTTP ${response.status}`))
  error.kind = response.status === 403 ? 'denied' : response.status === 404 || response.status === 503 ? 'unavailable' : 'error'
  error.status = response.status
  return error
}

async function readJson(url, workspace, signal) {
  const response = await fetch(url, { method: 'GET', headers: { 'X-Workspace-Id': workspace }, signal })
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

export default function SettingsWorkspace({ workspace = 'tenant-a', query }) {
  const { appearance, applyAppearance } = useFxReplayContext()
  const [appearanceDraft, setAppearanceDraft] = useState(() => appearance || { theme: 'dark', language: 'vi' })
  const [appearanceStatus, setAppearanceStatus] = useState('')
  useEffect(() => {
    if (appearance) setAppearanceDraft(appearance)
  }, [appearance?.theme, appearance?.language])
  const appearanceDirty = appearanceDraft.theme !== appearance?.theme || appearanceDraft.language !== appearance?.language
  function changeAppearance(key, value) {
    setAppearanceDraft((current) => ({ ...current, [key]: value }))
    setAppearanceStatus('')
  }
  function saveAppearance(event) {
    event.preventDefault()
    setAppearanceStatus(applyAppearance(appearanceDraft) ? 'saved' : 'volatile')
  }
  const [session, setSession] = useState({ status: 'loading', payload: null, error: null })
  const [notion, setNotion] = useState({ status: 'loading', payload: null, error: null })
  const [execution, setExecution] = useState({ status: 'loading', payload: null, error: null })
  const [reloadToken, setReloadToken] = useState(0)
  const requestSeq = useRef(0)

  useEffect(() => {
    const requestId = ++requestSeq.current
    const controller = new AbortController()
    setSession({ status: 'loading', payload: null, error: null })
    setNotion({ status: 'loading', payload: null, error: null })
    setExecution({ status: 'loading', payload: null, error: null })

    for (const [url, update] of [
      ['/api/v2/session/status', setSession],
      [NOTION_STATUS_URL, setNotion],
      ['/api/v2/execution/capabilities', setExecution],
    ]) {
      readJson(url, workspace, controller.signal)
        .then((payload) => { if (requestId === requestSeq.current) update({ status: 'ready', payload, error: null }) })
        .catch((error) => {
          if (error.name !== 'AbortError' && requestId === requestSeq.current) update({ status: error.kind || 'error', payload: null, error })
        })
    }
    return () => {
      controller.abort()
      if (requestId === requestSeq.current) requestSeq.current += 1
    }
  }, [reloadToken, workspace])

  const requestedReturn = query?.get('from')
  const returnView = ['replay', 'learn', 'research'].includes(requestedReturn) ? requestedReturn : 'replay'
  const sessionPayload = session.payload || {}
  const sessionSnapshot = sessionPayload.session || {}
  const identity = sessionPayload.identity || {}
  const notionPayload = notion.payload || {}
  const notionStatus = notion.status === 'ready' ? notionPayload.status || 'disconnected' : notion.status
  const canShowFacts = session.status === 'ready'
  const sessionVerified = canShowFacts && sessionSnapshot.status === 'signed_in' && sessionSnapshot.workspace_id === workspace
  const mode = sessionVerified ? display(sessionPayload.auth_mode) : 'Chưa xác minh session'
  const nextLink = buildWorkspaceHref(returnView, workspace, query, {
    from: returnView === 'learn' ? query?.get('return_from') : null,
    job: query?.get('job'), start: query?.get('start'),
  })
  const returnLabel = requestedReturn === returnView ? `Về ${returnView === 'replay' ? 'Replay' : returnView === 'learn' ? 'Learn' : 'Research'}` : 'Mở Practice'
  const learnFrom = returnView === 'learn' ? query?.get('return_from') : returnView
  const learnHref = buildWorkspaceHref('learn', workspace, query, { from: learnFrom, job: learnFrom === 'research' ? query?.get('job') : null, start: query?.get('start') })
  const brokerCapability = execution.status === 'ready' ? execution.payload?.broker_execution_capability : undefined
  const brokerStatus = brokerCapability === false ? 'Đã khóa' : brokerCapability === true ? 'API báo có capability' : 'Chưa xác minh · Đã khóa tại UI'

  const permissions = [
    ['Session workspace', sessionVerified ? 'Đã xác minh local' : 'Chưa xác minh', sessionVerified ? 'is-good' : 'is-warn'],
    ['Gửi lệnh broker', brokerStatus, 'is-warn'],
    ['Holdout data', 'Chưa có quyền từ màn này', 'is-warn'],
    ['Cloud write / export', notion.status === 'ready' ? display(notionPayload.export_mode) : 'Chưa xác minh', 'is-warn'],
  ]

  return (
    <main className="settings-shell wm-page" data-testid="settings-workspace">
      <header className="settings-topbar wm-page-header">
        <h1>Settings</h1>
        <div className="settings-topbar-actions">
          <a className="context-link" href={nextLink}>{returnLabel}</a>
          <a className="context-link" href={learnHref}>Learn</a>
          <button type="button" className="settings-refresh" onClick={() => setReloadToken((token) => token + 1)} disabled={[session, notion, execution].some((state) => state.status === 'loading')}>Làm mới</button>
        </div>
      </header>

      {applyAppearance && <section className="settings-appearance" aria-labelledby="settings-appearance-title">
        <div className="settings-heading"><div><h2 id="settings-appearance-title">Giao diện</h2><p className="settings-note">Lưu trên trình duyệt này. Ngôn ngữ áp dụng cho thanh điều hướng; nội dung nghiệp vụ giữ ngôn ngữ hiện có.</p></div></div>
        <form className="settings-appearance-form" onSubmit={saveAppearance}>
          <label><span>Chế độ màu</span><select value={appearanceDraft.theme} onChange={(event) => changeAppearance('theme', event.target.value)}><option value="dark">Tối</option><option value="light">Sáng</option></select></label>
          <label><span>Ngôn ngữ điều hướng</span><select value={appearanceDraft.language} onChange={(event) => changeAppearance('language', event.target.value)}><option value="vi">Tiếng Việt</option><option value="en">English</option></select></label>
          <div className="settings-appearance-actions">
            <button type="submit" disabled={!appearanceDirty && appearanceStatus !== 'volatile'}>Lưu giao diện</button>
          <button type="button" disabled={!appearanceDirty} onClick={() => { setAppearanceDraft(appearance); setAppearanceStatus('') }}>Hủy thay đổi</button>
          </div>
        </form>
        <p className="settings-note" role="status" data-testid="settings-appearance-status">{appearanceStatus === 'saved' ? 'Đã lưu giao diện trên trình duyệt này.' : appearanceStatus === 'volatile' ? 'Đã áp dụng trong phiên này. Trình duyệt đang chặn lưu tùy chọn; bạn có thể thử lưu lại.' : appearanceDirty ? 'Có thay đổi chưa lưu.' : ''}</p>
      </section>}

      <section className="settings-context" aria-label="Ngữ cảnh hiện tại">
        <div><span>Workspace</span><strong>{workspace}</strong></div>
        <div><span>Mode</span><strong>{mode}</strong></div>
        <div><span>Dataset được chọn</span><strong>{display(query?.get('dataset'), 'Chưa chọn')}</strong></div>
        <div><span>Broker capability</span><strong className="is-warn">{brokerStatus}</strong></div>
      </section>

      {session.status === 'loading' && <SettingState state="loading" testId="settings-session-loading" />}
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
          <div className="settings-heading"><div><span>Safety boundary</span><h2 id="settings-permissions-title">Trạng thái truy cập</h2></div><StatusBadge status="is-warn">Read only</StatusBadge></div>
          <ul className="settings-permissions" data-testid="settings-permissions">
            {permissions.map(([label, value, tone]) => <li key={label}><span>{label}</span><strong className={tone}>{value}</strong></li>)}
          </ul>
          {execution.status !== 'ready' && <SettingState state={execution.status} testId="settings-execution-state">Chưa đọc được capability execution. Không suy ra quyền từ session hoặc URL.</SettingState>}
          {execution.status === 'ready' && <dl className="settings-facts" data-testid="settings-execution-facts">{[['Đặt lệnh', 'place'], ['Sửa lệnh', 'modify'], ['Hủy lệnh', 'cancel'], ['Đóng lệnh', 'close']].map(([label, key]) => <Fact key={key} label={label} value={execution.payload?.[key] === true ? 'API báo có capability' : execution.payload?.[key] === false ? 'Đã khóa' : 'Chưa xác minh'} tone="is-warn" />)}</dl>}
          <p className="settings-note">Trạng thái được đọc từ session, execution API và connector. Màn này không cấp quyền hay gửi lệnh.</p>
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
        <span>Broker <strong className="is-warn">{brokerStatus}</strong></span>
        <span>Provider export <strong className="is-warn">{notion.status === 'ready' ? display(notionPayload.export_mode) : 'Chưa xác minh'}</strong></span>
      </footer>
    </main>
  )
}
