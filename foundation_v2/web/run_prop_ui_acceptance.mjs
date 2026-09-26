import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const here = path.dirname(fileURLToPath(import.meta.url))
const viteBin = path.join(here, 'node_modules', 'vite', 'bin', 'vite.js')
const origin = 'http://127.0.0.1:4175'
const evidenceDir = process.env.TW_UI_EVIDENCE_DIR || path.join(os.tmpdir(), 'tw-ps01-prop-ui-fixture')

const profile = {
  contract_version: 'prop-session-v1',
  profile_id: 'generic-practice-v1',
  terms_version: 'fixture-v1',
  profile_hash: 'sha256:fixture-profile-v1',
  effective_from: '2026-09-01',
  source_kind: 'generic',
  source_url: null,
  supported_rule_flags: ['daily_loss', 'overall_drawdown', 'profit_target'],
  phases: [{
    phase_index: 1,
    initial_capital: '100000',
    currency: 'USD',
    profit_target: { threshold: { amount: '10000', percent: null, percent_base: 'initial_capital' }, basis: 'balance', comparator: 'gte' },
    daily_loss: { threshold: { amount: '5000', percent: null, percent_base: 'initial_capital' }, basis: 'equity', comparator: 'lt' },
    overall_drawdown: {
      threshold: { amount: '10000', percent: null, percent_base: 'initial_capital' },
      basis: 'equity', comparator: 'lt', kind: 'static', trailing_granularity: null, lock_floor_at_initial: false,
    },
    reset_timezone: 'UTC',
    reset_local_time: '00:00:00',
    reset_order: 'fees_then_reset',
    min_qualifying_days: 1,
    max_calendar_days: 30,
    carry_policy: 'reset',
    position_policy: 'must_be_flat',
  }],
}

const persistedSession = {
  contract_version: 'prop-session-v1',
  workspace_id: 'tenant-prop-ui',
  session_id: 'persisted-session-1',
  mode: 'simulation',
  session_type: 'challenge',
  profile,
  status: 'running',
  revision: 2,
}

const persistedAttempt = {
  contract_version: 'prop-session-v1',
  workspace_id: 'tenant-prop-ui',
  session_id: 'persisted-session-1',
  attempt_id: 'attempt-persisted-1',
  mode: 'simulation',
  profile_id: profile.profile_id,
  terms_version: profile.terms_version,
  profile_hash: profile.profile_hash,
  data_version: 'dataset-fixture-v1',
  cost_version: 'cost-v1',
  engine_version: 'replay-v1',
  status: 'failed_breach',
  revision: 3,
  parent_attempt_id: null,
  branch_kind: 'clean',
  virtual_start_utc: '2026-09-01T08:00:00Z',
  virtual_cutoff_utc: '2026-10-01T08:00:00Z',
}

const persistedPhase = {
  workspace_id: 'tenant-prop-ui',
  session_id: 'persisted-session-1',
  attempt_id: 'attempt-persisted-1',
  profile_hash: profile.profile_hash,
  phase_index: 1,
  initial_balance: '100000',
  balance: '94900',
  floating_pl: '-100',
  equity: '94800',
  high_water_mark: '100400',
  daily_anchor: '100100',
  qualifying_days: 1,
  virtual_time_utc: '2026-09-01T10:00:00Z',
  last_event_sequence: 7,
  open_positions: 1,
  pending_orders: 1,
  evaluation_quality: 'full_for_declared_model',
}

const persistedBundle = {
  session: persistedSession,
  attempt: persistedAttempt,
  phase: persistedPhase,
  resume_state: {
    cursor: { bar_index: 412, timestamp_utc: '2026-09-01T10:00:00Z' },
    open_positions: [{ position_id: 'pos-1' }],
    pending_orders: [{ order_id: 'ord-1' }],
  },
}

const sessions = [persistedSession]
const attempts = new Map([[persistedSession.session_id, [persistedAttempt]]])
const bundles = new Map([[`${persistedSession.session_id}/${persistedAttempt.attempt_id}`, persistedBundle]])
const propRequests = []
let mode = 'happy'

function json(route, status, payload) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) })
}

function reportFor(bundle) {
  const breached = bundle.attempt.status === 'failed_breach'
  return {
    schema_version: 'prop-attempt-report-v1',
    mode: 'simulation',
    result_source: 'simulation',
    broker_execution_capability: false,
    session: {
      session_id: bundle.session.session_id,
      session_type: bundle.session.session_type,
      status: bundle.session.status,
      revision: bundle.session.revision,
    },
    profile: {
      profile_id: bundle.session.profile.profile_id,
      terms_version: bundle.session.profile.terms_version,
      profile_hash: bundle.session.profile.profile_hash,
      effective_from: bundle.session.profile.effective_from,
      source_kind: bundle.session.profile.source_kind,
    },
    attempt: {
      attempt_id: bundle.attempt.attempt_id,
      status: bundle.attempt.status,
      revision: bundle.attempt.revision,
      parent_attempt_id: bundle.attempt.parent_attempt_id,
      branch_kind: bundle.attempt.branch_kind,
      data_version: bundle.attempt.data_version,
      cost_version: bundle.attempt.cost_version,
      engine_version: bundle.attempt.engine_version,
      virtual_start_utc: bundle.attempt.virtual_start_utc,
      virtual_cutoff_utc: bundle.attempt.virtual_cutoff_utc,
    },
    phase: {
      phase_index: bundle.phase.phase_index,
      balance: bundle.phase.balance,
      floating_pl: bundle.phase.floating_pl,
      equity: bundle.phase.equity,
      high_water_mark: bundle.phase.high_water_mark,
      daily_anchor: bundle.phase.daily_anchor,
      qualifying_days: bundle.phase.qualifying_days,
      virtual_time_utc: bundle.phase.virtual_time_utc,
      last_event_sequence: bundle.phase.last_event_sequence,
      open_positions: bundle.phase.open_positions,
      pending_orders: bundle.phase.pending_orders,
      evaluation_quality: bundle.phase.evaluation_quality,
    },
    objectives: breached ? {
      technical_status: 'failed',
      terminal_action: 'breach',
      money: {
        daily_loss: { breached: true, current: bundle.phase.equity, floor: '95100', reference: bundle.phase.daily_anchor },
        overall_drawdown: { breached: false, current: bundle.phase.equity, floor: '90000', reference: bundle.phase.high_water_mark },
      },
    } : null,
    outcome: {
      status: bundle.attempt.status,
      terminal: breached,
      technical_status: breached ? 'failed' : null,
      terminal_action: breached ? 'breach' : null,
      reason_codes: breached ? ['daily_loss_breached'] : [],
      breaches: breached ? [{ rule: 'daily_loss', current: bundle.phase.equity, floor: '95100', reference: bundle.phase.daily_anchor }] : [],
    },
    provenance: {
      hindsight_exploratory: bundle.attempt.branch_kind === 'hindsight_exploratory',
      replay_binding: null,
      branch_provenance: null,
    },
    tutorials: {
      learn_view_href: '/?view=learn',
      learn_overview_href: '/api/v2/learn/overview',
      answer_keys_exposed: false,
      auto_completion_enabled: false,
    },
    safety: {
      simulation_only: true,
      broker_results_included: false,
      broker_credentials_included: false,
      holdout_content_included: false,
    },
  }
}

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(origin)
      if (response.ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('Vite server did not start')
}

async function main() {
  await mkdir(evidenceDir, { recursive: true })
  const server = spawn(process.execPath, [viteBin, '--host', '127.0.0.1', '--port', '4175', '--strictPort'], {
    cwd: here,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const serverErrors = []
  server.stderr.on('data', (chunk) => serverErrors.push(String(chunk)))

  let browser
  try {
    await waitForServer()
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    const consoleErrors = []
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    page.on('request', (request) => {
      const url = new URL(request.url())
      if (url.pathname.startsWith('/api/v2/prop/')) {
        propRequests.push({ method: request.method(), path: url.pathname, body: request.postData() })
      }
    })

    await page.route('**/api/v2/prop/**', async (route) => {
      const request = route.request()
      const url = new URL(request.url())
      const workspace = request.headers()['x-workspace-id'] || ''

      if (mode === 'denied') return json(route, 403, { detail: 'workspace_access_denied' })
      if (mode === 'error') return json(route, 503, { detail: 'prop_store_unavailable' })
      if (mode === 'report-error' && /\/report$/.test(url.pathname)) {
        return json(route, 503, { detail: 'prop_report_unavailable' })
      }
      if (mode === 'empty' && request.method() === 'GET' && url.pathname === '/api/v2/prop/sessions') {
        return json(route, 200, { items: [] })
      }
      if (mode === 'conflict' && request.method() === 'POST') {
        return json(route, 409, { detail: 'fixture_revision_conflict' })
      }

      if (url.pathname === '/api/v2/prop/sessions' && request.method() === 'GET') {
        return json(route, 200, { items: sessions.filter((item) => item.workspace_id === workspace) })
      }
      if (url.pathname === '/api/v2/prop/sessions' && request.method() === 'POST') {
        const body = JSON.parse(request.postData() || '{}')
        assert.equal(body.workspace_id, workspace)
        assert.equal(body.mode, 'simulation')
        sessions.push(body)
        return json(route, 201, body)
      }

      if (url.pathname === '/api/v2/prop/session-bundles' && request.method() === 'POST') {
        const body = JSON.parse(request.postData() || '{}')
        assert.equal(body.session.workspace_id, workspace)
        assert.equal(body.attempt.workspace_id, workspace)
        assert.equal(body.phase.workspace_id, workspace)
        assert.equal(body.session.mode, 'simulation')
        assert.equal(body.attempt.mode, 'simulation')
        assert.equal(body.attempt.session_id, body.session.session_id)
        assert.equal(body.phase.session_id, body.session.session_id)
        assert.equal(body.phase.attempt_id, body.attempt.attempt_id)
        assert.ok(body.resume_state?.cursor, 'atomic bundle create must carry a cursor')
        assert.deepEqual(body.resume_state.open_positions, [])
        assert.deepEqual(body.resume_state.pending_orders, [])
        sessions.push(body.session)
        attempts.set(body.session.session_id, [body.attempt])
        const bundle = {
          session: body.session,
          attempt: body.attempt,
          phase: body.phase,
          resume_state: body.resume_state,
          duplicate: false,
        }
        bundles.set(`${body.session.session_id}/${body.attempt.attempt_id}`, bundle)
        return json(route, 201, bundle)
      }

      const attemptsMatch = url.pathname.match(/^\/api\/v2\/prop\/sessions\/([^/]+)\/attempts$/)
      if (attemptsMatch) {
        const sessionId = decodeURIComponent(attemptsMatch[1])
        if (request.method() === 'GET') return json(route, 200, { items: attempts.get(sessionId) || [] })
        if (request.method() === 'POST') {
          const body = JSON.parse(request.postData() || '{}')
          assert.equal(body.attempt.mode, 'simulation')
          assert.equal(body.attempt.workspace_id, workspace)
          assert.equal(body.attempt.session_id, sessionId)
          assert.ok(body.resume_state?.cursor, 'create attempt must carry a cursor')
          assert.deepEqual(body.resume_state.open_positions, [])
          assert.deepEqual(body.resume_state.pending_orders, [])
          attempts.set(sessionId, [body.attempt])
          const session = sessions.find((item) => item.session_id === sessionId)
          const bundle = { session, attempt: body.attempt, phase: body.phase, resume_state: body.resume_state, duplicate: false }
          bundles.set(`${sessionId}/${body.attempt.attempt_id}`, bundle)
          return json(route, 201, bundle)
        }
      }

      if (url.pathname === '/api/v2/prop/reports' && request.method() === 'GET') {
        const status = url.searchParams.get('status')
        const branchKind = url.searchParams.get('branch_kind')
        const items = [...bundles.values()]
          .map(reportFor)
          .filter((report) => !status || report.attempt.status === status)
          .filter((report) => !branchKind || report.attempt.branch_kind === branchKind)
        return json(route, 200, {
          schema_version: 'prop-report-list-v1',
          filters: { status, branch_kind: branchKind },
          items,
          count: items.length,
          broker_execution_capability: false,
        })
      }

      const reportCsvMatch = url.pathname.match(/^\/api\/v2\/prop\/sessions\/([^/]+)\/attempts\/([^/]+)\/report\.csv$/)
      if (reportCsvMatch && request.method() === 'GET') {
        const key = `${decodeURIComponent(reportCsvMatch[1])}/${decodeURIComponent(reportCsvMatch[2])}`
        const bundle = bundles.get(key)
        if (!bundle) return json(route, 404, { detail: 'prop_attempt_not_found' })
        const report = reportFor(bundle)
        const body = `attempt_id,status,reason_codes\n${report.attempt.attempt_id},${report.outcome.status},${report.outcome.reason_codes.join('|')}\n`
        return route.fulfill({
          status: 200,
          contentType: 'text/csv; charset=utf-8',
          headers: { 'Content-Disposition': 'attachment; filename="prop-attempt-report.csv"' },
          body,
        })
      }

      const reportMatch = url.pathname.match(/^\/api\/v2\/prop\/sessions\/([^/]+)\/attempts\/([^/]+)\/report$/)
      if (reportMatch && request.method() === 'GET') {
        const key = `${decodeURIComponent(reportMatch[1])}/${decodeURIComponent(reportMatch[2])}`
        const bundle = bundles.get(key)
        return bundle ? json(route, 200, reportFor(bundle)) : json(route, 404, { detail: 'prop_attempt_not_found' })
      }

      const bundleMatch = url.pathname.match(/^\/api\/v2\/prop\/sessions\/([^/]+)\/attempts\/([^/]+)$/)
      if (bundleMatch && request.method() === 'GET') {
        const key = `${decodeURIComponent(bundleMatch[1])}/${decodeURIComponent(bundleMatch[2])}`
        const bundle = bundles.get(key)
        return bundle ? json(route, 200, bundle) : json(route, 404, { detail: 'prop_attempt_not_found' })
      }

      return json(route, 404, { detail: 'unknown_prop_fixture_route' })
    })

    await page.goto(`${origin}/?view=testing&workspace=tenant-prop-ui`)
    await page.getByTestId('prop-resume-bundle').waitFor()
    assert.match(await page.getByTestId('prop-lock').innerText(), /SIMULATION ONLY/)
    assert.match(await page.getByTestId('prop-lock').innerText(), /Không broker call/)
    assert.match(await page.getByTestId('prop-resume-bundle').innerText(), /attempt-persisted-1/)
    assert.match(await page.getByTestId('prop-resume-bundle').innerText(), /#412/)
    assert.match(await page.getByTestId('prop-resume-note').innerText(), /không tự chạy clock/i)
    assert.match(await page.getByTestId('prop-report').innerText(), /Daily loss đã bị breach/)

    await page.getByLabel('Tên session').fill('Custom UI acceptance')
    await page.getByLabel('Profile').selectOption('custom')
    await page.getByLabel('Dataset version').fill('dataset-created-v2')
    await page.getByRole('button', { name: 'Tạo session mô phỏng' }).click()
    await page.getByTestId('prop-resume-bundle').getByText('dataset-created-v2', { exact: true }).waitFor()
    assert.match(await page.getByTestId('prop-resume-bundle').innerText(), /dataset-created-v2/)
    assert.equal(sessions.length, 2)
    const createdSession = sessions[1]
    assert.equal(createdSession.profile.source_kind, 'custom')
    assert.equal(createdSession.mode, 'simulation')

    await page.reload()
    await page.getByTestId('prop-resume-bundle').waitFor()
    assert.match(await page.getByTestId('prop-resume-bundle').innerText(), /dataset-created-v2/, 'reload did not rediscover latest attempt')
    assert.equal(await page.getByTestId('prop-session-list').getByRole('button').count(), 2)
    assert.ok(
      propRequests.some((request) => request.method === 'GET' && request.path === `/api/v2/prop/sessions/${createdSession.session_id}/attempts`),
      'reload did not discover attempts from backend',
    )

    await page.getByRole('button', { name: 'Reports' }).click()
    await page.getByTestId('prop-reports-view').waitFor()
    await page.getByLabel('Report status').selectOption('failed_breach')
    await page.getByLabel('Report branch').selectOption('clean')
    await page.getByTestId('prop-report-list').getByText('Daily loss đã bị breach.', { exact: false }).waitFor()
    const reportText = await page.getByTestId('prop-report-list').innerText()
    assert.match(reportText, /failed_breach/i)
    assert.match(reportText, /attempt-persisted-1/)
    const downloadPromise = page.waitForEvent('download')
    await page.getByTestId('prop-report-list').getByRole('button', { name: 'CSV' }).click()
    const download = await downloadPromise
    assert.match(download.suggestedFilename(), /\.csv$/)

    await page.getByLabel('Report branch').selectOption('hindsight_exploratory')
    await page.getByTestId('prop-reports-empty').waitFor()
    await page.getByRole('button', { name: 'Sessions' }).click()

    const screenshots = []
    for (const width of [1440, 768, 360]) {
      await page.setViewportSize({ width, height: 1000 })
      const screenshot = path.join(evidenceDir, `prop-ui-fixture-${width}.png`)
      await page.screenshot({ path: screenshot, fullPage: true })
      screenshots.push(screenshot)
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      assert.ok(overflow <= 2, `horizontal overflow at ${width}px: ${overflow}px`)
    }

    mode = 'conflict'
    await page.getByLabel('Tên session').fill('Conflict fixture')
    await page.getByRole('button', { name: 'Tạo session mô phỏng' }).click()
    await page.getByTestId('prop-conflict').waitFor()
    assert.match(await page.getByTestId('prop-conflict').innerText(), /fixture_revision_conflict/)

    mode = 'report-error'
    await page.goto(`${origin}/?view=testing&workspace=tenant-prop-ui`)
    await page.getByTestId('prop-resume-bundle').waitFor()
    await page.getByTestId('prop-report-error').waitFor()
    assert.match(await page.getByTestId('prop-report-error').innerText(), /prop_report_unavailable/)

    mode = 'empty'
    await page.goto(`${origin}/?view=testing&workspace=tenant-empty`)
    await page.getByTestId('prop-empty').waitFor()

    mode = 'denied'
    await page.goto(`${origin}/?view=testing&workspace=tenant-denied`)
    await page.getByTestId('prop-denied').waitFor()

    mode = 'error'
    await page.goto(`${origin}/?view=testing&workspace=tenant-error`)
    await page.getByTestId('prop-error').waitFor()

    const mutations = propRequests.filter((request) => request.method !== 'GET')
    const bundleCreates = mutations.filter(
      (request) => request.method === 'POST' && request.path === '/api/v2/prop/session-bundles',
    )
    assert.ok(bundleCreates.length >= 2, 'expected atomic bundle create plus conflict coverage')
    assert.equal(
      mutations.some(
        (request) => request.method === 'POST' && (
          request.path === '/api/v2/prop/sessions' || /\/attempts$/.test(request.path)
        ),
      ),
      false,
      'legacy two-step Prop create path was used',
    )
    assert.equal(mutations.every((request) => request.path.startsWith('/api/v2/prop/')), true, 'mutation escaped prop API')
    assert.equal(mutations.some((request) => /broker|credential|account_id/i.test(request.body || '')), false, 'broker/credential field leaked into prop mutation')

    const unexpectedConsoleErrors = consoleErrors.filter((message) => !/Failed to load resource: the server responded with a status of (403|409|503)/.test(message))
    assert.deepEqual(unexpectedConsoleErrors, [])

    console.log(JSON.stringify({
      status: 'PASS',
      fixture: 'ui-labeled-ps03-prop-report',
      checks: [
        'simulation_only_lock',
        'backend_session_and_attempt_discovery',
        'create_session_and_attempt',
        'persisted_id_reload_resume',
        'cursor_and_money_resume_state',
        'attempt_report_reason_explanation',
        'report_status_and_branch_filters',
        'report_csv_export',
        'report_failure_does_not_hide_resume_state',
        'mutations_prop_api_only',
        'no_broker_or_credential_payload',
        'conflict',
        'empty',
        'denied',
        'error',
        'responsive_1440_768_360',
      ],
      screenshots,
    }, null, 2))
  } finally {
    if (browser) await browser.close()
    server.kill('SIGTERM')
    if (serverErrors.length) process.stderr.write(serverErrors.join(''))
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
