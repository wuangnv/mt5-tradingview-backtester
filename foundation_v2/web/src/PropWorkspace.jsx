import React, { useCallback, useEffect, useMemo, useState } from 'react'

const TERMINAL_STATUSES = new Set(['completed_pass', 'failed_breach', 'expired', 'abandoned'])

function utcIsoFromInput(value) {
  const parsed = new Date(`${value}:00Z`)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString()
}

function formatMoney(value, currency = 'USD') {
  const number = Number(value)
  if (!Number.isFinite(number)) return 'N/A'
  try {
    return new Intl.NumberFormat('vi-VN', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(number)
  } catch {
    return `${number.toLocaleString('vi-VN')} ${currency}`
  }
}

function formatUtc(value) {
  if (!value) return 'N/A'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return 'N/A'
  return new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(parsed)
}

function slugify(value) {
  return String(value || '')
    .trim()
    .toLocaleLowerCase('vi')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 54)
}

async function sha256Text(value) {
  const bytes = new TextEncoder().encode(value)
  const digest = await window.crypto.subtle.digest('SHA-256', bytes)
  return `sha256:${Array.from(new Uint8Array(digest), (item) => item.toString(16).padStart(2, '0')).join('')}`
}

function apiError(response, payload) {
  const detail = String(payload?.detail || `HTTP ${response.status}`)
  const error = new Error(detail)
  if (response.status === 403) error.kind = 'denied'
  else if (response.status === 409) error.kind = 'conflict'
  else error.kind = 'error'
  error.status = response.status
  return error
}

async function propJson(url, workspace, options = {}) {
  const method = options.method || 'GET'
  if (method !== 'GET' && !url.startsWith('/api/v2/prop/')) {
    throw new Error('unsafe_prop_mutation_target')
  }
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      'X-Workspace-Id': workspace,
      ...(options.headers || {}),
    },
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw apiError(response, payload)
  return payload
}

function initialDraft() {
  return {
    name: 'Challenge luyện tập',
    profileKind: 'generic',
    initialCapital: '100000',
    currency: 'USD',
    target: '10000',
    dailyLoss: '5000',
    overallLoss: '10000',
    datasetVersion: 'dataset-practice-v1',
    startUtc: '2026-09-01T08:00',
    durationDays: '30',
    costVersion: 'cost-v1',
  }
}

function StateMessage({ kind, children, testId }) {
  const role = kind === 'error' || kind === 'denied' || kind === 'conflict' ? 'alert' : 'status'
  return <div className={`prop-message prop-message-${kind}`} role={role} data-testid={testId}>{children}</div>
}

function sessionLabel(session) {
  const profile = session?.profile
  if (!profile) return session?.session_id || 'Session'
  return profile.source_kind === 'custom' ? 'Custom practice' : 'Generic practice'
}

export default function PropWorkspace({ workspace }) {
  const [draft, setDraft] = useState(initialDraft)
  const [sessions, setSessions] = useState({ status: 'loading', items: [], error: null })
  const [selected, setSelected] = useState({ status: 'idle', session: null, attempts: [], bundle: null, error: null })
  const [pendingAction, setPendingAction] = useState('')
  const [conflict, setConflict] = useState(null)

  const loadBundle = useCallback(async (session, attempts) => {
    const latest = attempts.length ? attempts[attempts.length - 1] : null
    if (!latest) {
      setSelected({ status: 'ready', session, attempts, bundle: null, error: null })
      return
    }
    setSelected((current) => ({ ...current, status: 'loading', session, attempts, error: null }))
    try {
      const bundle = await propJson(
        `/api/v2/prop/sessions/${encodeURIComponent(session.session_id)}/attempts/${encodeURIComponent(latest.attempt_id)}`,
        workspace,
      )
      setSelected({ status: 'ready', session, attempts, bundle, error: null })
    } catch (error) {
      setSelected({ status: error.kind || 'error', session, attempts, bundle: null, error: error.message })
    }
  }, [workspace])

  const openSession = useCallback(async (session) => {
    setConflict(null)
    setSelected({ status: 'loading', session, attempts: [], bundle: null, error: null })
    try {
      const payload = await propJson(
        `/api/v2/prop/sessions/${encodeURIComponent(session.session_id)}/attempts`,
        workspace,
      )
      await loadBundle(session, payload.items || [])
    } catch (error) {
      setSelected({ status: error.kind || 'error', session, attempts: [], bundle: null, error: error.message })
    }
  }, [loadBundle, workspace])

  const loadSessions = useCallback(async ({ preserveSelection = false } = {}) => {
    setSessions((current) => ({ status: 'loading', items: preserveSelection ? current.items : [], error: null }))
    try {
      const payload = await propJson('/api/v2/prop/sessions', workspace)
      const items = payload.items || []
      setSessions({ status: 'ready', items, error: null })

      if (!items.length) {
        setSelected({ status: 'idle', session: null, attempts: [], bundle: null, error: null })
        return
      }

      const currentId = preserveSelection ? selected.session?.session_id : null
      const target = items.find((item) => item.session_id === currentId) || items[items.length - 1]
      await openSession(target)
    } catch (error) {
      setSessions({ status: error.kind || 'error', items: [], error: error.message })
    }
  }, [openSession, selected.session?.session_id, workspace])

  useEffect(() => {
    loadSessions()
  }, [workspace]) // Re-discover sessions and attempts from the backend on every page load/workspace change.

  const updateDraft = (field, value) => setDraft((current) => ({ ...current, [field]: value }))

  const createSession = useCallback(async (event) => {
    event.preventDefault()
    setConflict(null)
    const start = utcIsoFromInput(draft.startUtc)
    const durationDays = Math.max(1, Number(draft.durationDays) || 1)
    const initialCapital = Number(draft.initialCapital)
    const target = Number(draft.target)
    const dailyLoss = Number(draft.dailyLoss)
    const overallLoss = Number(draft.overallLoss)
    const base = slugify(draft.name)

    if (!start || !base || !draft.datasetVersion.trim()) {
      setConflict('Cần tên session, dataset version và thời điểm bắt đầu hợp lệ.')
      return
    }
    if (![initialCapital, target, dailyLoss, overallLoss].every((value) => Number.isFinite(value) && value > 0)) {
      setConflict('Vốn và các ngưỡng phải là số dương.')
      return
    }

    setPendingAction('create')
    try {
      const profileId = `${draft.profileKind}-practice-v1`
      const profileCore = {
        contract_version: 'prop-session-v1',
        profile_id: profileId,
        terms_version: 'ui-practice-v1',
        effective_from: start.slice(0, 10),
        source_kind: draft.profileKind,
        source_url: null,
        supported_rule_flags: ['daily_loss', 'overall_drawdown', 'profit_target'],
        phases: [{
          phase_index: 1,
          initial_capital: String(initialCapital),
          currency: draft.currency.toUpperCase(),
          profit_target: { threshold: { amount: String(target), percent: null, percent_base: 'initial_capital' }, basis: 'balance', comparator: 'gte' },
          daily_loss: { threshold: { amount: String(dailyLoss), percent: null, percent_base: 'initial_capital' }, basis: 'equity', comparator: 'lt' },
          overall_drawdown: {
            threshold: { amount: String(overallLoss), percent: null, percent_base: 'initial_capital' },
            basis: 'equity', comparator: 'lt', kind: 'static', trailing_granularity: null, lock_floor_at_initial: false,
          },
          reset_timezone: 'UTC',
          reset_local_time: '00:00:00',
          reset_order: 'fees_then_reset',
          min_qualifying_days: 1,
          max_calendar_days: durationDays,
          carry_policy: 'reset',
          position_policy: 'must_be_flat',
        }],
      }
      const profileHash = await sha256Text(JSON.stringify(profileCore))
      const profile = { ...profileCore, profile_hash: profileHash }
      const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
      const sessionId = `${base}-${suffix}`.slice(0, 96)
      const attemptId = `attempt-${suffix}`
      const cutoff = new Date(new Date(start).getTime() + durationDays * 86400000).toISOString()
      const session = {
        contract_version: 'prop-session-v1',
        workspace_id: workspace,
        session_id: sessionId,
        mode: 'simulation',
        session_type: 'challenge',
        profile,
        status: 'ready',
        revision: 1,
      }
      const attempt = {
        contract_version: 'prop-session-v1',
        workspace_id: workspace,
        session_id: sessionId,
        attempt_id: attemptId,
        mode: 'simulation',
        profile_id: profile.profile_id,
        terms_version: profile.terms_version,
        profile_hash: profile.profile_hash,
        data_version: draft.datasetVersion.trim(),
        cost_version: draft.costVersion,
        engine_version: 'replay-v1',
        status: 'ready',
        revision: 1,
        parent_attempt_id: null,
        branch_kind: 'clean',
        virtual_start_utc: start,
        virtual_cutoff_utc: cutoff,
      }
      const phase = {
        workspace_id: workspace,
        session_id: sessionId,
        attempt_id: attemptId,
        profile_hash: profile.profile_hash,
        phase_index: 1,
        initial_balance: String(initialCapital),
        balance: String(initialCapital),
        floating_pl: '0',
        equity: String(initialCapital),
        high_water_mark: String(initialCapital),
        daily_anchor: String(initialCapital),
        qualifying_days: 0,
        virtual_time_utc: start,
        last_event_sequence: 0,
        open_positions: 0,
        pending_orders: 0,
        evaluation_quality: 'full_for_declared_model',
      }
      const resumeState = {
        cursor: { bar_index: 0, timestamp_utc: start },
        open_positions: [],
        pending_orders: [],
      }

      const created = await propJson('/api/v2/prop/sessions', workspace, {
        method: 'POST',
        body: JSON.stringify(session),
      })
      const bundle = await propJson(`/api/v2/prop/sessions/${encodeURIComponent(sessionId)}/attempts`, workspace, {
        method: 'POST',
        body: JSON.stringify({ attempt, phase, resume_state: resumeState }),
      })
      setSessions((current) => ({ status: 'ready', items: [...current.items, created], error: null }))
      setSelected({ status: 'ready', session: created, attempts: [bundle.attempt], bundle, error: null })
    } catch (error) {
      if (error.kind === 'conflict') setConflict(error.message)
      else if (error.kind === 'denied') setSessions({ status: 'denied', items: [], error: error.message })
      else setConflict(`Không tạo được session: ${error.message}`)
      if (error.kind !== 'conflict') await loadSessions({ preserveSelection: true }).catch(() => {})
    } finally {
      setPendingAction('')
    }
  }, [draft, loadSessions, workspace])

  const bundle = selected.bundle
  const phase = bundle?.phase
  const attempt = bundle?.attempt
  const currency = selected.session?.profile?.phases?.[0]?.currency || draft.currency
  const cursor = bundle?.resume_state?.cursor
  const selectedTerminal = TERMINAL_STATUSES.has(attempt?.status)
  const sessionCountLabel = useMemo(() => `${sessions.items.length} session`, [sessions.items.length])

  return (
    <main className="prop-shell">
      <header className="prop-topbar">
        <div>
          <div className="eyebrow">TESTING / PROP SESSION</div>
          <h1>Luyện challenge</h1>
          <p>Tạo và mở lại phiên luyện bằng state đã persist trên backend.</p>
        </div>
        <div className="prop-topbar-actions">
          <a className="context-link" href={`/?view=replay&workspace=${encodeURIComponent(workspace)}`}>Replay</a>
          <a className="context-link" href={`/?view=learn&workspace=${encodeURIComponent(workspace)}`}>Học</a>
          <div className="prop-lock" data-testid="prop-lock">
            <strong>SIMULATION ONLY</strong>
            <span>Không broker call · không credential · tiền ảo</span>
          </div>
        </div>
      </header>

      <nav className="prop-tabs" aria-label="Testing views">
        <button type="button" className="is-active" aria-current="page">Sessions</button>
        <button type="button" disabled>Dashboard</button>
        <button type="button" disabled>Trades</button>
        <button type="button" disabled>Analytics</button>
      </nav>

      <section className="prop-layout">
        <aside className="prop-sidebar">
          <div className="prop-section-head">
            <div><span>Workspace</span><strong>{workspace}</strong></div>
            <small>{sessionCountLabel}</small>
          </div>

          {sessions.status === 'loading' && <StateMessage kind="loading" testId="prop-loading">Đang tìm session đã lưu…</StateMessage>}
          {sessions.status === 'denied' && <StateMessage kind="denied" testId="prop-denied">Workspace này không có quyền đọc Prop session.</StateMessage>}
          {sessions.status === 'error' && <StateMessage kind="error" testId="prop-error">Không đọc được danh sách: {sessions.error}</StateMessage>}
          {sessions.status === 'ready' && !sessions.items.length && <StateMessage kind="empty" testId="prop-empty">Chưa có session. Tạo một phiên luyện ở form bên cạnh.</StateMessage>}

          <div className="prop-session-list" data-testid="prop-session-list">
            {sessions.items.map((session) => {
              const active = selected.session?.session_id === session.session_id
              return (
                <button
                  type="button"
                  key={session.session_id}
                  className={active ? 'is-active' : ''}
                  onClick={() => openSession(session)}
                >
                  <span>{sessionLabel(session)}</span>
                  <strong>{session.session_id}</strong>
                  <small>{session.status} · rev {session.revision}</small>
                </button>
              )
            })}
          </div>
        </aside>

        <section className="prop-main">
          {conflict && (
            <StateMessage kind="conflict" testId="prop-conflict">
              <strong>Xung đột / dữ liệu chưa hợp lệ.</strong> {conflict}
            </StateMessage>
          )}

          <section className="prop-wizard" aria-label="Tạo Prop session">
            <div className="prop-section-head">
              <div><span>New session</span><strong>Generic / custom practice profile</strong></div>
              <small>1 phase · UTC · static loss</small>
            </div>
            <form onSubmit={createSession}>
              <label className="prop-field prop-field-wide">
                <span>Tên session</span>
                <input aria-label="Tên session" value={draft.name} onChange={(event) => updateDraft('name', event.target.value)} />
              </label>
              <label className="prop-field">
                <span>Profile</span>
                <select aria-label="Profile" value={draft.profileKind} onChange={(event) => updateDraft('profileKind', event.target.value)}>
                  <option value="generic">Generic practice</option>
                  <option value="custom">Custom practice</option>
                </select>
              </label>
              <label className="prop-field">
                <span>Vốn ảo</span>
                <input aria-label="Vốn ảo" type="number" min="1" value={draft.initialCapital} onChange={(event) => updateDraft('initialCapital', event.target.value)} />
              </label>
              <label className="prop-field">
                <span>Currency</span>
                <select aria-label="Currency" value={draft.currency} onChange={(event) => updateDraft('currency', event.target.value)}>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                </select>
              </label>
              <label className="prop-field">
                <span>Profit target</span>
                <input aria-label="Profit target" type="number" min="1" value={draft.target} onChange={(event) => updateDraft('target', event.target.value)} />
              </label>
              <label className="prop-field">
                <span>Daily loss</span>
                <input aria-label="Daily loss" type="number" min="1" value={draft.dailyLoss} onChange={(event) => updateDraft('dailyLoss', event.target.value)} />
              </label>
              <label className="prop-field">
                <span>Overall loss</span>
                <input aria-label="Overall loss" type="number" min="1" value={draft.overallLoss} onChange={(event) => updateDraft('overallLoss', event.target.value)} />
              </label>
              <label className="prop-field prop-field-wide">
                <span>Dataset version</span>
                <input aria-label="Dataset version" value={draft.datasetVersion} onChange={(event) => updateDraft('datasetVersion', event.target.value)} />
              </label>
              <label className="prop-field">
                <span>Bắt đầu (UTC)</span>
                <input aria-label="Bắt đầu UTC" type="datetime-local" value={draft.startUtc} onChange={(event) => updateDraft('startUtc', event.target.value)} />
              </label>
              <label className="prop-field">
                <span>Max days</span>
                <input aria-label="Max days" type="number" min="1" max="365" value={draft.durationDays} onChange={(event) => updateDraft('durationDays', event.target.value)} />
              </label>
              <label className="prop-field">
                <span>Cost model</span>
                <select aria-label="Cost model" value={draft.costVersion} onChange={(event) => updateDraft('costVersion', event.target.value)}>
                  <option value="cost-v1">cost-v1</option>
                  <option value="cost-zero-fixture">cost-zero-fixture</option>
                </select>
              </label>
              <div className="prop-review prop-field-wide">
                <strong>Review</strong>
                <span>Equity-based daily/overall loss, balance target, reset UTC 00:00. Đây là profile luyện tập, không đại diện điều khoản của hãng prop cụ thể.</span>
              </div>
              <button className="primary-action prop-create" type="submit" disabled={pendingAction === 'create'}>
                {pendingAction === 'create' ? 'Đang tạo…' : 'Tạo session mô phỏng'}
              </button>
            </form>
          </section>

          <section className="prop-resume" aria-label="Resume state">
            <div className="prop-section-head">
              <div><span>Persisted state</span><strong>Resume discovery từ backend</strong></div>
              {selected.session && <button type="button" className="prop-refresh" onClick={() => openSession(selected.session)}>Tải lại</button>}
            </div>

            {selected.status === 'loading' && <StateMessage kind="loading" testId="prop-selection-loading">Đang đọc attempts và resume state…</StateMessage>}
            {selected.status === 'denied' && <StateMessage kind="denied" testId="prop-selection-denied">Không có quyền đọc session này.</StateMessage>}
            {selected.status === 'error' && <StateMessage kind="error" testId="prop-selection-error">Không đọc được session: {selected.error}</StateMessage>}
            {selected.status === 'idle' && <StateMessage kind="empty">Chọn hoặc tạo session để xem state.</StateMessage>}
            {selected.status === 'ready' && selected.session && !attempt && <StateMessage kind="empty">Session chưa có attempt để resume.</StateMessage>}

            {selected.status === 'ready' && attempt && phase && (
              <div data-testid="prop-resume-bundle">
                <div className="prop-resume-strip">
                  <div><span>Attempt</span><strong>{attempt.attempt_id}</strong></div>
                  <div><span>Status</span><strong className={selectedTerminal ? 'is-terminal' : ''}>{attempt.status}</strong></div>
                  <div><span>Revision</span><strong>{attempt.revision}</strong></div>
                  <div><span>Cursor</span><strong>{cursor ? `#${cursor.bar_index}` : 'N/A'}</strong></div>
                </div>
                <div className="prop-metrics">
                  <article><span>Balance</span><strong>{formatMoney(phase.balance, currency)}</strong></article>
                  <article><span>Equity</span><strong>{formatMoney(phase.equity, currency)}</strong></article>
                  <article><span>HWM</span><strong>{formatMoney(phase.high_water_mark, currency)}</strong></article>
                  <article><span>Daily anchor</span><strong>{formatMoney(phase.daily_anchor, currency)}</strong></article>
                </div>
                <dl className="prop-facts">
                  <div><dt>Virtual time</dt><dd>{formatUtc(phase.virtual_time_utc)}</dd></div>
                  <div><dt>Cursor time</dt><dd>{formatUtc(cursor?.timestamp_utc)}</dd></div>
                  <div><dt>Dataset</dt><dd>{attempt.data_version}</dd></div>
                  <div><dt>Cost / engine</dt><dd>{attempt.cost_version} · {attempt.engine_version}</dd></div>
                  <div><dt>Open / pending</dt><dd>{phase.open_positions} / {phase.pending_orders}</dd></div>
                  <div><dt>Evaluation quality</dt><dd>{phase.evaluation_quality}</dd></div>
                </dl>
                <div className="prop-resume-note" data-testid="prop-resume-note">
                  “Mở tiếp tục” ở PS-01 chỉ khôi phục state đã persist. UI không tự chạy clock, fill lệnh hay transition phase.
                </div>
              </div>
            )}
          </section>
        </section>
      </section>
    </main>
  )
}
