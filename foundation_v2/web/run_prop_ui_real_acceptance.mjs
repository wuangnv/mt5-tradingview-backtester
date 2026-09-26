import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const origin = process.argv[2]
const workspace = process.argv[3]
const evidenceDir = process.argv[4]

if (!origin || !workspace || !evidenceDir) {
  throw new Error('usage: node run_prop_ui_real_acceptance.mjs <origin> <workspace> <evidence-dir>')
}

await mkdir(evidenceDir, { recursive: true })

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const requests = []
const consoleErrors = []

page.on('request', (request) => {
  const url = new URL(request.url())
  if (url.pathname.startsWith('/api/')) {
    requests.push({ method: request.method(), path: url.pathname, body: request.postData() || '' })
  }
})
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text())
})

try {
  await page.goto(`${origin}/?view=testing&workspace=${encodeURIComponent(workspace)}`)
  await page.getByTestId('prop-empty').waitFor()
  assert.match(await page.getByTestId('prop-lock').innerText(), /SIMULATION ONLY/)
  assert.match(await page.getByTestId('prop-lock').innerText(), /Không broker call/)

  await page.getByLabel('Tên session').fill('PS03 real service')
  await page.getByLabel('Profile').selectOption('custom')
  await page.getByLabel('Dataset version').fill('dataset-real-service-v1')
  await page.getByRole('button', { name: 'Tạo session mô phỏng' }).click()
  await page.getByTestId('prop-resume-bundle').waitFor()
  assert.match(await page.getByTestId('prop-resume-bundle').innerText(), /dataset-real-service-v1/)

  const firstState = await page.evaluate(async ({ workspace }) => {
    const headers = { 'X-Workspace-Id': workspace }
    const sessionsResponse = await fetch('/api/v2/prop/sessions', { headers })
    if (!sessionsResponse.ok) throw new Error(`list sessions failed: HTTP ${sessionsResponse.status}`)
    const sessionsPayload = await sessionsResponse.json()
    const session = sessionsPayload.items.at(-1)
    if (!session) throw new Error('real service did not persist a Prop session')
    const attemptsResponse = await fetch(`/api/v2/prop/sessions/${encodeURIComponent(session.session_id)}/attempts`, { headers })
    if (!attemptsResponse.ok) throw new Error(`list attempts failed: HTTP ${attemptsResponse.status}`)
    const attemptsPayload = await attemptsResponse.json()
    const attempt = attemptsPayload.items.at(-1)
    if (!attempt) throw new Error('real service did not persist a Prop attempt')
    const bundleResponse = await fetch(
      `/api/v2/prop/sessions/${encodeURIComponent(session.session_id)}/attempts/${encodeURIComponent(attempt.attempt_id)}`,
      { headers },
    )
    if (!bundleResponse.ok) throw new Error(`get resume bundle failed: HTTP ${bundleResponse.status}`)
    const bundle = await bundleResponse.json()
    return {
      sessionId: session.session_id,
      attemptId: attempt.attempt_id,
      revision: bundle.attempt.revision,
      cursor: bundle.resume_state.cursor,
      mode: session.mode,
      dataset: attempt.data_version,
    }
  }, { workspace })

  assert.equal(firstState.mode, 'simulation')
  assert.equal(firstState.dataset, 'dataset-real-service-v1')
  assert.equal(firstState.cursor.bar_index, 0)

  const updatedState = await page.evaluate(async ({ workspace, sessionId, attemptId }) => {
    const headers = { 'Content-Type': 'application/json', 'X-Workspace-Id': workspace }
    const currentResponse = await fetch(
      `/api/v2/prop/sessions/${encodeURIComponent(sessionId)}/attempts/${encodeURIComponent(attemptId)}`,
      { headers },
    )
    if (!currentResponse.ok) throw new Error(`load resume update fixture failed: HTTP ${currentResponse.status}`)
    const current = await currentResponse.json()
    const startResponse = await fetch(
      `/api/v2/prop/sessions/${encodeURIComponent(sessionId)}/attempts/${encodeURIComponent(attemptId)}/transitions`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          workspace_id: workspace,
          session_id: sessionId,
          attempt_id: attemptId,
          profile_hash: current.attempt.profile_hash,
          intent_id: `ps02-real-start-${attemptId}`,
          expected_revision: current.attempt.revision,
          event_sequence: current.phase.last_event_sequence,
          action: 'start',
        }),
      },
    )
    if (!startResponse.ok) throw new Error(`start transition failed: HTTP ${startResponse.status}`)
    const started = await startResponse.json()
    const timestamp = new Date(new Date(started.phase.virtual_time_utc).getTime() + 60_000).toISOString()
    const body = {
      attempt: { ...started.attempt, revision: started.attempt.revision + 1 },
      phase: {
        ...started.phase,
        virtual_time_utc: timestamp,
        last_event_sequence: started.phase.last_event_sequence + 1,
      },
      expected_revision: started.attempt.revision,
      operation_id: `ps01-real-resume-${attemptId}`,
      resume_state: {
        ...started.resume_state,
        cursor: { bar_index: started.resume_state.cursor.bar_index + 1, timestamp_utc: timestamp },
      },
    }
    const response = await fetch(
      `/api/v2/prop/sessions/${encodeURIComponent(sessionId)}/attempts/${encodeURIComponent(attemptId)}/resume`,
      { method: 'PUT', headers, body: JSON.stringify(body) },
    )
    if (!response.ok) throw new Error(`resume update failed: HTTP ${response.status}`)
    const checkpointed = await response.json()
    const transitionResponse = await fetch(
      `/api/v2/prop/sessions/${encodeURIComponent(sessionId)}/attempts/${encodeURIComponent(attemptId)}/transitions`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          workspace_id: workspace,
          session_id: sessionId,
          attempt_id: attemptId,
          profile_hash: checkpointed.attempt.profile_hash,
          intent_id: `ps02-real-pause-${attemptId}`,
          expected_revision: checkpointed.attempt.revision,
          event_sequence: checkpointed.phase.last_event_sequence,
          action: 'pause',
        }),
      },
    )
    if (!transitionResponse.ok) throw new Error(`pause transition failed: HTTP ${transitionResponse.status}`)
    const updated = await transitionResponse.json()
    return {
      revision: updated.attempt.revision,
      status: updated.attempt.status,
      cursor: updated.resume_state.cursor,
      lastEventSequence: updated.phase.last_event_sequence,
    }
  }, { workspace, sessionId: firstState.sessionId, attemptId: firstState.attemptId })

  assert.equal(updatedState.revision, 4)
  assert.equal(updatedState.status, 'paused')
  assert.equal(updatedState.cursor.bar_index, 1)
  assert.equal(updatedState.lastEventSequence, 1)

  await page.reload()
  await page.getByTestId('prop-resume-bundle').waitFor()
  assert.match(await page.getByTestId('prop-resume-bundle').innerText(), new RegExp(firstState.attemptId))
  assert.match(await page.getByTestId('prop-resume-bundle').innerText(), /dataset-real-service-v1/)
  assert.match(await page.getByTestId('prop-resume-bundle').innerText(), /paused/)
  assert.match(await page.getByTestId('prop-resume-bundle').innerText(), /#1/)
  assert.match(await page.getByTestId('prop-report').innerText(), /paused/i)
  assert.match(await page.getByTestId('prop-report').innerText(), /Chưa có terminal reason/i)

  const afterReload = await page.evaluate(async ({ workspace, sessionId, attemptId }) => {
    const response = await fetch(
      `/api/v2/prop/sessions/${encodeURIComponent(sessionId)}/attempts/${encodeURIComponent(attemptId)}`,
      { headers: { 'X-Workspace-Id': workspace } },
    )
    if (!response.ok) throw new Error(`reload resume bundle failed: HTTP ${response.status}`)
    const bundle = await response.json()
    return {
      revision: bundle.attempt.revision,
      cursor: bundle.resume_state.cursor,
      openPositions: bundle.resume_state.open_positions.length,
      pendingOrders: bundle.resume_state.pending_orders.length,
    }
  }, { workspace, sessionId: firstState.sessionId, attemptId: firstState.attemptId })

  assert.deepEqual(afterReload.cursor, updatedState.cursor)
  assert.equal(afterReload.revision, updatedState.revision)
  assert.equal(afterReload.openPositions, 0)
  assert.equal(afterReload.pendingOrders, 0)

  await page.getByRole('button', { name: 'Reports' }).click()
  await page.getByTestId('prop-reports-view').waitFor()
  await page.getByLabel('Report status').selectOption('paused')
  await page.getByLabel('Report branch').selectOption('clean')
  await page.getByTestId('prop-report-list').getByText(firstState.attemptId, { exact: true }).waitFor()
  const reportListText = await page.getByTestId('prop-report-list').innerText()
  assert.match(reportListText, /paused/i)
  assert.match(reportListText, /Chưa có terminal reason/i)

  const reportDownloadPromise = page.waitForEvent('download')
  await page.getByTestId('prop-report-list').getByRole('button', { name: 'CSV' }).click()
  const reportDownload = await reportDownloadPromise
  assert.match(reportDownload.suggestedFilename(), /\.csv$/)
  const reportCsvPath = await reportDownload.path()
  assert.ok(reportCsvPath, 'CSV export did not produce a local download')

  await page.getByLabel('Report branch').selectOption('hindsight_exploratory')
  await page.getByTestId('prop-reports-empty').waitFor()
  await page.getByLabel('Report branch').selectOption('clean')
  await page.getByTestId('prop-report-list').getByText(firstState.attemptId, { exact: true }).waitFor()
  const reportsScreenshot = path.join(evidenceDir, 'ps03-real-service-reports-1440.png')
  await page.screenshot({ path: reportsScreenshot, fullPage: true })
  await page.getByRole('button', { name: 'Sessions' }).click()
  await page.getByTestId('prop-report').waitFor()

  const deniedStatus = await page.evaluate(async () => {
    const response = await fetch('/api/v2/prop/sessions', { headers: { 'X-Workspace-Id': 'tenant-not-authorized' } })
    return response.status
  })
  assert.equal(deniedStatus, 403)

  const screenshots = []
  for (const width of [1440, 768, 360]) {
    await page.setViewportSize({ width, height: 1000 })
    const screenshot = path.join(evidenceDir, `ps03-real-service-${width}.png`)
    await page.screenshot({ path: screenshot, fullPage: true })
    screenshots.push(screenshot)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    assert.ok(overflow <= 2, `horizontal overflow at ${width}px: ${overflow}px`)
  }

  const mutations = requests.filter((request) => request.method !== 'GET')
  const bundleCreates = mutations.filter(
    (request) => request.method === 'POST' && request.path === '/api/v2/prop/session-bundles',
  )
  assert.equal(bundleCreates.length, 1, 'expected one atomic session+attempt create from the UI')
  assert.equal(
    mutations.some(
      (request) => request.method === 'POST' && (
        request.path === '/api/v2/prop/sessions' || /\/attempts$/.test(request.path)
      ),
    ),
    false,
    'legacy two-step Prop create path was used',
  )
  assert.equal(
    mutations.some((request) => request.method === 'PUT' && /\/resume$/.test(request.path)),
    true,
    'expected a persisted resume update before reload',
  )
  assert.equal(mutations.every((request) => request.path.startsWith('/api/v2/prop/')), true)
  assert.equal(
    mutations.some((request) => /broker|credential|account_id/i.test(request.body)),
    false,
    'broker/account credential field leaked into a Prop mutation',
  )
  assert.equal(requests.some((request) => /execution|broker/i.test(request.path)), false)
  assert.equal(
    requests.some((request) => request.method === 'GET' && request.path.endsWith('/report')),
    true,
    'selected attempt report was not loaded from the real API',
  )
  assert.equal(
    requests.some((request) => request.method === 'GET' && request.path === '/api/v2/prop/reports'),
    true,
    'report list was not loaded from the real API',
  )
  assert.equal(
    requests.some((request) => request.method === 'GET' && request.path.endsWith('/report.csv')),
    true,
    'report CSV export did not use the real API',
  )
  const unexpectedConsoleErrors = consoleErrors.filter(
    (message) => !/Failed to load resource: the server responded with a status of 403 \(Forbidden\)/.test(message),
  )
  assert.deepEqual(unexpectedConsoleErrors, [])

  console.log(JSON.stringify({
    status: 'PASS',
    fixture: 'ps03-real-service-postgres-api-vite',
    workspace,
    sessionId: firstState.sessionId,
    attemptId: firstState.attemptId,
    checks: [
      'initial_empty_state',
      'simulation_only_lock',
      'ui_atomic_create_session_and_attempt_via_real_api',
      'postgres_persisted_ids',
      'resume_update_persisted_before_reload',
      'reload_resume_same_ids_and_updated_cursor',
      'selected_attempt_report_from_real_api',
      'report_status_and_branch_filters_real_api',
      'report_csv_export_real_api',
      'tenant_denial',
      'mutations_prop_api_only',
      'no_broker_execution_request',
      'responsive_1440_768_360',
    ],
    screenshots: [reportsScreenshot, ...screenshots],
  }, null, 2))
} finally {
  await browser.close()
}
