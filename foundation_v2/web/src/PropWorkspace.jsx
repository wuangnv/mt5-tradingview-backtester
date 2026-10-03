import React, { useCallback, useEffect, useMemo, useState } from 'react'
import NotionConnector from './NotionConnector.jsx'
import './PropWorkspace.css'

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

function reportReasonLabel(code) {
  const labels = {
    daily_loss_breached: 'Daily loss đã bị breach.',
    overall_drawdown_breached: 'Overall drawdown đã bị breach.',
    data_quality_incomplete: 'Thiếu dữ liệu để kết luận đầy đủ.',
    virtual_cutoff_expired: 'Attempt hết thời gian mô phỏng.',
    attempt_abandoned: 'Attempt đã bị bỏ.',
    declared_objectives_satisfied: 'Các objective đã khai báo được thỏa mãn.',
  }
  return labels[code] || code
}

function reportReplayHref(report, workspace) {
  const binding = report?.provenance?.replay_binding
  const cursor = report?.provenance?.replay_cursor
  const cursorIndex = Number(cursor?.bar_index)
  if (!binding?.replay_session_id || !Number.isInteger(cursorIndex) || cursorIndex < 0) return null
  const params = new URLSearchParams({
    view: 'replay',
    workspace,
    session: binding.replay_session_id,
    cursor: String(cursorIndex),
    from: 'prop-report',
  })
  return { href: `/?${params.toString()}`, cursorIndex }
}

function objectiveStateLabel(value) {
  if (value === true) return 'Đạt'
  if (value === false) return 'Chưa đạt'
  return 'Chưa rõ'
}

function objectiveNumber(value, currency = 'USD') {
  return value === null || value === undefined ? 'N/A' : formatMoney(value, currency)
}

function objectiveSummary(objectives, phase, currency) {
  if (!objectives || typeof objectives !== 'object') return null
  const money = objectives.money && typeof objectives.money === 'object' ? objectives.money : null
  const calendar = objectives.calendar && typeof objectives.calendar === 'object' ? objectives.calendar : null
  return {
    technicalStatus: objectives.technical_status || 'unknown',
    passReady: objectives.pass_ready === true,
    positionsReady: objectives.positions_ready === true,
    profitTarget: money?.profit_target ? {
      status: objectiveStateLabel(money.profit_target.hit),
      current: objectiveNumber(money.profit_target.current, currency),
      target: objectiveNumber(money.profit_target.target, currency),
    } : null,
    dailyLoss: money?.daily_loss ? {
      status: money.daily_loss.breached ? 'Breached' : 'Trong giới hạn',
      current: objectiveNumber(money.daily_loss.current, currency),
      floor: objectiveNumber(money.daily_loss.floor, currency),
    } : null,
    overallDrawdown: money?.overall_drawdown ? {
      status: money.overall_drawdown.breached ? 'Breached' : 'Trong giới hạn',
      current: objectiveNumber(money.overall_drawdown.current, currency),
      floor: objectiveNumber(money.overall_drawdown.floor, currency),
      kind: money.overall_drawdown.kind || 'static',
    } : null,
    calendar: calendar ? {
      qualifyingDays: calendar.qualifying_days,
      minDaysSatisfied: calendar.min_qualifying_days_satisfied === true,
      elapsedDays: calendar.elapsed_calendar_days,
      expired: calendar.expired === true,
      deadline: calendar.deadline_utc,
    } : null,
    phaseIndex: objectives.phase_index || phase?.phase_index || null,
  }
}

export default function PropWorkspace({ workspace }) {
  const [draft, setDraft] = useState(initialDraft)
  const [sessions, setSessions] = useState({ status: 'loading', items: [], error: null })
  const [selected, setSelected] = useState({ status: 'idle', session: null, attempts: [], bundle: null, report: null, reportError: null, error: null })
  const [activeTab, setActiveTab] = useState('sessions')
  const [reports, setReports] = useState({ status: 'idle', items: [], error: null })
  const [reportFilters, setReportFilters] = useState({ status: '', branchKind: '' })
  const [pendingAction, setPendingAction] = useState('')
  const [conflict, setConflict] = useState(null)

  const loadBundle = useCallback(async (session, attempts) => {
    const latest = attempts.length ? attempts[attempts.length - 1] : null
    if (!latest) {
      setSelected({ status: 'ready', session, attempts, bundle: null, report: null, reportError: null, error: null })
      return
    }
    setSelected((current) => ({ ...current, status: 'loading', session, attempts, error: null }))
    try {
      const attemptBase = `/api/v2/prop/sessions/${encodeURIComponent(session.session_id)}/attempts/${encodeURIComponent(latest.attempt_id)}`
      const bundle = await propJson(attemptBase, workspace)
      let report = null
      let reportError = null
      try {
        report = await propJson(`${attemptBase}/report`, workspace)
      } catch (error) {
        reportError = error.message
      }
      setSelected({ status: 'ready', session, attempts, bundle, report, reportError, error: null })
    } catch (error) {
      setSelected({ status: error.kind || 'error', session, attempts, bundle: null, report: null, reportError: null, error: error.message })
    }
  }, [workspace])

  const openSession = useCallback(async (session) => {
    setConflict(null)
    setSelected({ status: 'loading', session, attempts: [], bundle: null, report: null, reportError: null, error: null })
    try {
      const payload = await propJson(
        `/api/v2/prop/sessions/${encodeURIComponent(session.session_id)}/attempts`,
        workspace,
      )
      await loadBundle(session, payload.items || [])
    } catch (error) {
      setSelected({ status: error.kind || 'error', session, attempts: [], bundle: null, report: null, reportError: null, error: error.message })
    }
  }, [loadBundle, workspace])

  const loadSessions = useCallback(async ({ preserveSelection = false } = {}) => {
    setSessions((current) => ({ status: 'loading', items: preserveSelection ? current.items : [], error: null }))
    try {
      const payload = await propJson('/api/v2/prop/sessions', workspace)
      const items = payload.items || []
      setSessions({ status: 'ready', items, error: null })

      if (!items.length) {
        setSelected({ status: 'idle', session: null, attempts: [], bundle: null, report: null, reportError: null, error: null })
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

  const loadReports = useCallback(async () => {
    setReports((current) => ({ status: 'loading', items: current.items, error: null }))
    const params = new URLSearchParams()
    if (reportFilters.status) params.set('status', reportFilters.status)
    if (reportFilters.branchKind) params.set('branch_kind', reportFilters.branchKind)
    try {
      const payload = await propJson(`/api/v2/prop/reports${params.size ? `?${params}` : ''}`, workspace)
      setReports({ status: 'ready', items: payload.items || [], error: null })
    } catch (error) {
      setReports({ status: error.kind || 'error', items: [], error: error.message })
    }
  }, [reportFilters, workspace])

  useEffect(() => {
    if (activeTab === 'reports' || activeTab === 'notion') loadReports()
  }, [activeTab, loadReports])

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

      const bundle = await propJson('/api/v2/prop/session-bundles', workspace, {
        method: 'POST',
        body: JSON.stringify({ session, attempt, phase, resume_state: resumeState }),
      })
      const created = bundle.session
      setSessions((current) => ({ status: 'ready', items: [...current.items, created], error: null }))
      await loadBundle(created, [bundle.attempt])
    } catch (error) {
      if (error.kind === 'conflict') setConflict(error.message)
      else if (error.kind === 'denied') setSessions({ status: 'denied', items: [], error: error.message })
      else setConflict(`Không tạo được session: ${error.message}`)
      if (error.kind !== 'conflict') await loadSessions({ preserveSelection: true }).catch(() => {})
    } finally {
      setPendingAction('')
    }
  }, [draft, loadBundle, loadSessions, workspace])

  const transitionAttempt = useCallback(async (action) => {
    const session = selected.session
    const attempt = selected.bundle?.attempt
    const phase = selected.bundle?.phase
    if (!session || !attempt || !phase) return
    const pendingKey = `transition:${action}`
    setPendingAction(pendingKey)
    setConflict(null)
    try {
      const payload = await propJson(
        `/api/v2/prop/sessions/${encodeURIComponent(session.session_id)}/attempts/${encodeURIComponent(attempt.attempt_id)}/transitions`,
        workspace,
        {
          method: 'POST',
          body: JSON.stringify({
            workspace_id: workspace,
            session_id: session.session_id,
            attempt_id: attempt.attempt_id,
            profile_hash: attempt.profile_hash,
            // Revision-scoped IDs make a retried click idempotent after a lost response.
            intent_id: `ui-${action}-${attempt.attempt_id}-${attempt.revision}`,
            expected_revision: attempt.revision,
            event_sequence: phase.last_event_sequence,
            action,
          }),
        },
      )
      const updatedSession = payload.session || session
      setSessions((current) => ({
        ...current,
        items: current.items.map((item) => item.session_id === updatedSession.session_id ? updatedSession : item),
      }))
      await loadBundle(updatedSession, [payload.attempt])
    } catch (error) {
      if (error.kind === 'conflict') setConflict(`Lifecycle chưa đổi được: ${error.message}`)
      else if (error.kind === 'denied') setSelected((current) => ({ ...current, status: 'denied', error: error.message }))
      else setConflict(`Lifecycle chưa đổi được: ${error.message}`)
    } finally {
      setPendingAction('')
    }
  }, [loadBundle, selected.bundle, selected.session, workspace])

  const exportReport = useCallback(async (report) => {
    const sessionId = report?.session?.session_id
    const attemptId = report?.attempt?.attempt_id
    if (!sessionId || !attemptId) return
    const actionKey = `export:${attemptId}`
    setPendingAction(actionKey)
    setConflict(null)
    try {
      const response = await fetch(
        `/api/v2/prop/sessions/${encodeURIComponent(sessionId)}/attempts/${encodeURIComponent(attemptId)}/report.csv`,
        { headers: { 'X-Workspace-Id': workspace } },
      )
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw apiError(response, payload)
      }
      const blob = await response.blob()
      const href = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = href
      link.download = `prop-${sessionId}-${attemptId}.csv`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(href)
    } catch (error) {
      setConflict(`Không export được report: ${error.message}`)
    } finally {
      setPendingAction('')
    }
  }, [workspace])

  const bundle = selected.bundle
  const phase = bundle?.phase
  const attempt = bundle?.attempt
  const report = selected.report
  const currency = selected.session?.profile?.phases?.[0]?.currency || draft.currency
  const lifecycleObjectives = bundle?.resume_state?.prop_lifecycle?.last_objectives || report?.objectives || null
  const objectives = objectiveSummary(lifecycleObjectives, phase, currency)
  const selectedReplayTarget = reportReplayHref(report, workspace)
  const cursor = bundle?.resume_state?.cursor
  const selectedTerminal = TERMINAL_STATUSES.has(attempt?.status)
  const canOpenNextPhase = attempt?.status === 'phase_passed' && Boolean(phase) && (selected.session?.profile?.phases?.length || 0) > phase.phase_index
  const sessionCountLabel = useMemo(() => `${sessions.items.length} session`, [sessions.items.length])

  return (
    <main className="prop-shell wm-page">
      <header className="prop-topbar wm-page-header">
        <div>
          <h1>Luyện challenge</h1>
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
        <button
          type="button"
          className={activeTab === 'sessions' ? 'is-active' : ''}
          aria-current={activeTab === 'sessions' ? 'page' : undefined}
          onClick={() => setActiveTab('sessions')}
        >Sessions</button>
        <button
          type="button"
          className={activeTab === 'reports' ? 'is-active' : ''}
          aria-current={activeTab === 'reports' ? 'page' : undefined}
          onClick={() => setActiveTab('reports')}
        >Reports</button>
        <button
          type="button"
          className={activeTab === 'notion' ? 'is-active' : ''}
          aria-current={activeTab === 'notion' ? 'page' : undefined}
          data-testid="prop-notion-tab"
          onClick={() => setActiveTab('notion')}
        >Notion</button>
      </nav>

      {activeTab === 'sessions' && <section className="prop-layout">
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

        <section className={`prop-main${selected.session ? ' has-selection' : ''}`}>
          {conflict && (
            <StateMessage kind="conflict" testId="prop-conflict">
              <strong>Xung đột / dữ liệu chưa hợp lệ.</strong> {conflict}
            </StateMessage>
          )}

          <section className="prop-wizard" aria-label="Tạo Prop session">
            <div className="prop-section-head">
              <div><strong>Tạo phiên luyện</strong><span>Generic / custom practice profile</span></div>
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
              <div><strong>Phiên đang chọn</strong><span>Trạng thái đã lưu</span></div>
              {selected.session && <button type="button" className="prop-refresh" onClick={() => openSession(selected.session)}>Tải lại</button>}
            </div>

            {selected.status === 'loading' && <StateMessage kind="loading" testId="prop-selection-loading">Đang đọc attempts và resume state…</StateMessage>}
            {selected.status === 'denied' && <StateMessage kind="denied" testId="prop-selection-denied">Không có quyền đọc session này.</StateMessage>}
            {selected.status === 'error' && <StateMessage kind="error" testId="prop-selection-error">Không đọc được session: {selected.error}</StateMessage>}
            {selected.status === 'idle' && <StateMessage kind="empty">Chọn hoặc tạo session để xem state.</StateMessage>}
            {selected.status === 'ready' && selected.session && !attempt && <StateMessage kind="empty">Session chưa có attempt để resume.</StateMessage>}

            {selected.status === 'ready' && attempt && phase && (
              <div data-testid="prop-resume-bundle">
                <ol className="prop-phase-list" aria-label="Các phase của challenge">
                  {(selected.session.profile?.phases || []).map((item) => (
                    <li key={item.phase_index} aria-current={item.phase_index === phase.phase_index ? 'step' : undefined}>
                      <strong>Phase {item.phase_index}</strong>
                      <span>{item.phase_index === phase.phase_index ? attempt.status : item.phase_index < phase.phase_index ? 'Phase trước' : 'Chưa mở'}</span>
                    </li>
                  ))}
                </ol>
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
                  Resume chỉ khôi phục state đã persist. Các nút lifecycle gửi lệnh rõ ràng tới backend; UI không tự chạy clock hoặc fill lệnh.
                </div>

                <section className="prop-objectives" data-testid="prop-objectives" aria-label="Challenge objectives">
                  <div className="prop-section-head">
                    <div><span>Challenge objectives</span><strong>{objectives ? `Phase ${objectives.phaseIndex} · ${objectives.technicalStatus}` : 'Chưa có snapshot evaluator'}</strong></div>
                    <small>{objectives ? (objectives.passReady ? 'Pass ready' : 'Đang theo dõi') : 'Chờ event mô phỏng'}</small>
                  </div>
                  {!objectives && <p className="prop-objectives-empty">Chưa có lifecycle event đủ dữ liệu để tính objective. Resume state và provenance vẫn được giữ nguyên.</p>}
                  {objectives && (
                    <div className="prop-objective-grid">
                      {objectives.profitTarget && <article><span>Profit target</span><strong>{objectives.profitTarget.status}</strong><small>{objectives.profitTarget.current} / {objectives.profitTarget.target}</small></article>}
                      {objectives.dailyLoss && <article><span>Daily loss</span><strong className={objectives.dailyLoss.status === 'Breached' ? 'is-breach' : ''}>{objectives.dailyLoss.status}</strong><small>{objectives.dailyLoss.current} · floor {objectives.dailyLoss.floor}</small></article>}
                      {objectives.overallDrawdown && <article><span>Overall drawdown · {objectives.overallDrawdown.kind}</span><strong className={objectives.overallDrawdown.status === 'Breached' ? 'is-breach' : ''}>{objectives.overallDrawdown.status}</strong><small>{objectives.overallDrawdown.current} · floor {objectives.overallDrawdown.floor}</small></article>}
                      {objectives.calendar && <article><span>Calendar / quality</span><strong>{objectives.calendar.minDaysSatisfied ? 'Days ready' : `${objectives.calendar.qualifyingDays ?? 0} qualifying day`}</strong><small>{objectives.calendar.elapsedDays ?? 0} elapsed · {objectives.calendar.expired ? 'expired' : 'within cutoff'} · positions {objectives.positionsReady ? 'flat' : 'not ready'}</small></article>}
                    </div>
                  )}
                </section>

                <div className="prop-lifecycle-actions" data-testid="prop-lifecycle-actions">
                  {attempt.status === 'ready' && <button type="button" className="ui-button ui-button--neutral prop-refresh" data-testid="prop-transition-start" disabled={pendingAction === 'transition:start'} onClick={() => transitionAttempt('start')}>{pendingAction === 'transition:start' ? 'Đang bắt đầu…' : 'Bắt đầu mô phỏng'}</button>}
                  {attempt.status === 'running' && <button type="button" className="ui-button ui-button--neutral prop-refresh" data-testid="prop-transition-pause" disabled={pendingAction === 'transition:pause'} onClick={() => transitionAttempt('pause')}>{pendingAction === 'transition:pause' ? 'Đang tạm dừng…' : 'Tạm dừng'}</button>}
                  {attempt.status === 'paused' && <button type="button" className="ui-button ui-button--neutral prop-refresh" data-testid="prop-transition-resume" disabled={pendingAction === 'transition:resume'} onClick={() => transitionAttempt('resume')}>{pendingAction === 'transition:resume' ? 'Đang tiếp tục…' : 'Tiếp tục mô phỏng'}</button>}
                  {canOpenNextPhase && <button type="button" className="ui-button ui-button--neutral prop-refresh" data-testid="prop-transition-next-phase" disabled={pendingAction === 'transition:next_phase'} onClick={() => transitionAttempt('next_phase')}>{pendingAction === 'transition:next_phase' ? 'Đang mở phase…' : 'Mở phase tiếp theo'}</button>}
                  {['ready', 'running', 'paused', 'phase_passed', 'next_phase_ready'].includes(attempt.status) && <button type="button" className="prop-refresh" data-testid="prop-transition-abandon" disabled={pendingAction === 'transition:abandon'} onClick={() => transitionAttempt('abandon')}>{pendingAction === 'transition:abandon' ? 'Đang bỏ…' : 'Bỏ attempt'}</button>}
                </div>

                {selected.reportError && (
                  <StateMessage kind="error" testId="prop-report-error">
                    Resume state vẫn dùng được, nhưng report chưa tải được: {selected.reportError}
                  </StateMessage>
                )}

                {report && (
                  <section className="prop-report" data-testid="prop-report">
                    <div className="prop-section-head">
                      <div><span>Attempt report</span><strong>{report.outcome.status}</strong></div>
                      <small>{report.result_source}</small>
                    </div>
                    <div className="prop-report-summary">
                      <div><span>Technical</span><strong>{report.outcome.technical_status || 'N/A'}</strong></div>
                      <div><span>Terminal</span><strong>{report.outcome.terminal ? 'Có' : 'Chưa'}</strong></div>
                      <div><span>Branch</span><strong>{report.attempt.branch_kind}</strong></div>
                      <div><span>Quality</span><strong>{report.phase.evaluation_quality}</strong></div>
                    </div>
                    <div className="prop-report-copy">
                      <strong>Giải thích kết quả</strong>
                      {report.outcome.reason_codes.length ? (
                        <ul>{report.outcome.reason_codes.map((code) => <li key={code}>{reportReasonLabel(code)}</li>)}</ul>
                      ) : (
                        <p>Attempt chưa có terminal reason. Report chỉ phản ánh state mô phỏng đã persist.</p>
                      )}
                      {report.provenance.hindsight_exploratory && (
                        <p className="prop-report-warning">Đây là hindsight branch để khám phá sau checkpoint; không gộp với clean attempt.</p>
                      )}
                    </div>
                    <div className="prop-report-actions">
                      {selectedReplayTarget && (
                        <a className="context-link" data-testid="prop-report-replay" href={selectedReplayTarget.href}>
                          Mở replay #{selectedReplayTarget.cursorIndex}
                        </a>
                      )}
                      <a className="context-link" href={`/?view=learn&workspace=${encodeURIComponent(workspace)}&from=prop&session=${encodeURIComponent(report.session.session_id)}&attempt=${encodeURIComponent(report.attempt.attempt_id)}`}>Mở Learn</a>
                      <button
                        type="button"
                        className="prop-refresh"
                        data-testid="prop-report-export"
                        disabled={pendingAction === `export:${report.attempt.attempt_id}`}
                        onClick={() => exportReport(report)}
                      >
                        {pendingAction === `export:${report.attempt.attempt_id}` ? 'Đang export…' : 'Export CSV'}
                      </button>
                    </div>
                  </section>
                )}
              </div>
            )}
          </section>
        </section>
      </section>}

      {activeTab === 'reports' && (
        <section className="prop-reports" data-testid="prop-reports-view">
          <div className="prop-section-head">
            <div><span>Reports</span><strong>Read-only từ persisted Prop state</strong></div>
            <small>{reports.items.length} report</small>
          </div>
          <div className="prop-report-filters">
            <label className="prop-field">
              <span>Status</span>
              <select aria-label="Report status" value={reportFilters.status} onChange={(event) => setReportFilters((current) => ({ ...current, status: event.target.value }))}>
                <option value="">Tất cả</option>
                <option value="ready">ready</option>
                <option value="running">running</option>
                <option value="paused">paused</option>
                <option value="phase_passed">phase_passed</option>
                <option value="next_phase_ready">next_phase_ready</option>
                <option value="completed_pass">completed_pass</option>
                <option value="failed_breach">failed_breach</option>
                <option value="expired">expired</option>
                <option value="abandoned">abandoned</option>
              </select>
            </label>
            <label className="prop-field">
              <span>Branch</span>
              <select aria-label="Report branch" value={reportFilters.branchKind} onChange={(event) => setReportFilters((current) => ({ ...current, branchKind: event.target.value }))}>
                <option value="">Tất cả</option>
                <option value="clean">clean</option>
                <option value="hindsight_exploratory">hindsight_exploratory</option>
              </select>
            </label>
            <button type="button" className="ui-button ui-button--neutral prop-refresh" onClick={loadReports}>Tải lại</button>
          </div>

          {reports.status === 'loading' && <StateMessage kind="loading" testId="prop-reports-loading">Đang đọc reports…</StateMessage>}
          {reports.status === 'denied' && <StateMessage kind="denied" testId="prop-reports-denied">Workspace này không có quyền đọc Prop reports.</StateMessage>}
          {reports.status === 'error' && <StateMessage kind="error" testId="prop-reports-error">Không đọc được reports: {reports.error}</StateMessage>}
          {reports.status === 'ready' && !reports.items.length && <StateMessage kind="empty" testId="prop-reports-empty">Không có report khớp bộ lọc.</StateMessage>}

          <div className="prop-report-list" data-testid="prop-report-list">
            {reports.items.map((item) => {
              const replayTarget = reportReplayHref(item, workspace)
              return <article className="prop-report-row" key={`${item.session.session_id}/${item.attempt.attempt_id}`}>
                <div>
                  <span>{item.outcome.status} · {item.attempt.branch_kind}</span>
                  <strong>{item.session.session_id}</strong>
                  <small>{item.attempt.attempt_id}</small>
                </div>
                <div>
                  <span>Balance / equity</span>
                  <strong>{item.phase.balance} / {item.phase.equity}</strong>
                  <small>{item.phase.evaluation_quality}</small>
                </div>
                <div className="prop-report-row-reasons">
                  <span>Reason</span>
                  <strong>{item.outcome.reason_codes.length ? item.outcome.reason_codes.map(reportReasonLabel).join(' ') : 'Chưa có terminal reason.'}</strong>
                  <small>{item.result_source}</small>
                </div>
                <div className="prop-report-row-actions">
                  {replayTarget && <a className="context-link" href={replayTarget.href}>Replay #{replayTarget.cursorIndex}</a>}
                  <a className="context-link" href={`/?view=learn&workspace=${encodeURIComponent(workspace)}&from=prop&session=${encodeURIComponent(item.session.session_id)}&attempt=${encodeURIComponent(item.attempt.attempt_id)}`}>Learn</a>
                  <button
                    type="button"
                    className="ui-button ui-button--neutral prop-refresh"
                    disabled={pendingAction === `export:${item.attempt.attempt_id}`}
                    onClick={() => exportReport(item)}
                  >CSV</button>
                </div>
              </article>
            })}
          </div>
        </section>
      )}

      {activeTab === 'notion' && (
        <NotionConnector workspace={workspace} reports={reports} onRefresh={loadReports} />
      )}
    </main>
  )
}
