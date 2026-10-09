import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const origin = process.env.TW_UI_ORIGIN
const output = process.env.TW_ACCEPTANCE_OUTPUT
assert.equal(new URL(origin).hostname, '127.0.0.1')
assert.ok(output)
const browser = await chromium.launch({ headless: true })
const report = { scope: 'Real React, Axum and workers; isolated synthetic data; API requests are not mocked', errors: [], calls: [] }
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  let documents = 0
  page.on('pageerror', error => report.errors.push(error.message))
  page.on('request', request => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents++
    if (new URL(request.url()).pathname.startsWith('/api/')) report.calls.push({ method: request.method(), path: new URL(request.url()).pathname })
  })
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
  await page.goto(`${origin}/?workspace=tenant-a&view=overview&area=testing&section=dashboard`)
  await page.locator('.fx-rail').waitFor()
  await page.evaluate(() => { window.__shellOracle = { shell: document.querySelector('[data-testid="fxreplay-shell"]'), rail: document.querySelector('.fx-rail'), header: document.querySelector('.fx-topbar') } })
  await page.locator('.fx-dashboard-quick-action.is-primary').click()
  const dialog = page.locator('.quick-session-dialog')
  await dialog.waitFor()
  await dialog.locator('input[maxlength="160"]').first().fill('Browser multiasset acceptance')
  await dialog.locator('.dataset-asset-select .fx-select-trigger').click()
  await page.getByRole('option').filter({ hasText: 'EURUSD' }).first().click()
  await page.getByRole('option').filter({ hasText: 'XAUUSD' }).first().click()
  await page.keyboard.press('Escape')
  await dialog.getByRole('textbox', { name: 'Ngày bắt đầu phiên (UTC)' }).fill('01/01/2026 00:10')
  const firstChartWindow = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/chart-window') && response.status() === 200, { timeout: 20000 })
  await dialog.locator('.quick-session-submit').click()
  await page.waitForURL(url => url.searchParams.get('session') && url.searchParams.get('view') === 'replay')
  report.createdSession = new URL(page.url()).searchParams.get('session')
  const destination = new URL(page.url()).searchParams
  assert.equal(destination.get('surface'), 'workspace', 'successful create opens the chart surface')
  assert.equal(destination.has('select'), false, 'successful create skips the session picker')
  assert.equal(await dialog.count(), 0, 'create dialog unmounts after navigation')
  const server = await page.evaluate(async id => {
    const response = await fetch(`/api/v2/replay/sessions/${id}`, { headers: { 'X-Workspace-Id': 'tenant-a' } })
    return { status: response.status, body: await response.json() }
  }, report.createdSession)
  assert.equal(server.status, 200)
  assert.equal(server.body.payload.dataset_ids.length, 2)
  assert.equal(server.body.session_period.requested_start_timestamp, 1767226200)
  assert.equal(server.body.session_period.requested_end_timestamp, null)
  assert.equal(server.body.view_cursor_index, 10)
  assert.equal(destination.get('dataset'), server.body.payload.dataset_id, 'chart uses the created session primary asset')
  await page.locator('[data-testid="replay-chart"][data-chart-engine="advanced"][data-chart-status="ready"]').waitFor({ timeout: 20000 })
  const history = await (await firstChartWindow).json()
  assert.equal(history.session_id, report.createdSession)
  assert.ok(history.bars.length > 0 && history.bars.length <= 2000)
  assert.ok(history.bars.every(bar => bar.time <= server.body.cutoff_timestamp * 1000))
  report.nativeChart = { ready: true, boundedBars: history.bars.length, cutoff: history.cutoff_timestamp }
  const stepResponse = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/step')
    && response.request().method() === 'POST' && response.status() === 200)
  await page.getByTestId('step-1').click()
  const advanced = await (await stepResponse).json()
  assert.equal(advanced.record_id, report.createdSession)
  assert.equal(advanced.revision, server.body.revision + 1)
  assert.ok(advanced.payload.replay_clock_utc > server.body.payload.replay_clock_utc)
  await page.waitForURL(url => Number(url.searchParams.get('cursor')) === advanced.view_cursor_index)
  report.replayStep = { cursor: advanced.view_cursor_index, revision: advanced.revision }
  const navigate = async view => {
    await page.evaluate(view => { const link = document.createElement('a'); link.href = `/?workspace=tenant-a&view=${view}&area=testing&section=${view === 'overview' ? 'dashboard' : view}`; document.body.append(link); link.click(); link.remove() }, view)
    await page.waitForURL(url => url.searchParams.get('view') === view)
    await page.locator('.fx-rail').waitFor()
  }
  await navigate('overview')
  assert.equal(await page.evaluate(() => window.__shellOracle.shell === document.querySelector('[data-testid="fxreplay-shell"]')), true)
  await page.locator('.fx-dashboard-quick-action.is-primary').click()
  await dialog.locator('input[maxlength="160"]').first().fill('Browser bounded period acceptance')
  await dialog.locator('.dataset-asset-select .fx-select-trigger').click()
  await page.getByRole('option').filter({ hasText: 'EURUSD' }).first().click()
  await page.getByRole('option').filter({ hasText: 'XAUUSD' }).first().click()
  await page.keyboard.press('Escape')
  await dialog.getByRole('textbox', { name: 'Ngày bắt đầu phiên (UTC)' }).fill('01/01/2026 00:10')
  await dialog.getByRole('button', { name: 'Tùy chọn', exact: true }).click()
  await dialog.getByRole('textbox', { name: 'Ngày kết thúc phiên (UTC)' }).fill('01/01/2026 00:12')
  const boundedCreate = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/replay/sessions')
    && response.request().method() === 'POST' && response.status() === 201)
  await dialog.locator('.quick-session-submit').click()
  const bounded = await (await boundedCreate).json()
  assert.equal(bounded.session_period.requested_end_timestamp, 1767226320)
  await page.waitForURL(url => url.searchParams.get('session') === bounded.record_id && url.searchParams.get('view') === 'replay')
  await page.locator('[data-testid="replay-chart"][data-chart-status="ready"]').waitFor()
  let completed
  for (let cursor = 11; cursor <= 12; cursor++) {
    const response = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/step')
      && response.request().method() === 'POST' && response.status() === 200)
    await page.getByTestId('step-1').click()
    completed = await (await response).json()
    assert.equal(completed.view_cursor_index, cursor)
    await page.waitForURL(url => Number(url.searchParams.get('cursor')) === cursor)
  }
  assert.equal(completed.payload.status, 'completed')
  assert.equal(completed.has_future_rows, false)
  await page.getByTestId('step-1').waitFor()
  assert.equal(await page.getByTestId('step-1').isDisabled(), true)
  const reloaded = await page.evaluate(async id => {
    const response = await fetch(`/api/v2/replay/sessions/${id}`, { headers: { 'X-Workspace-Id': 'tenant-a' } })
    return response.json()
  }, bounded.record_id)
  assert.equal(reloaded.session_period.end_cursor_index, 12)
  assert.equal(reloaded.canonical_cursor_index, 12)
  assert.ok(reloaded.visible_rows.every(bar => bar.timestamp <= 1767226320))
  report.customPeriod = { session: bounded.record_id, startCursor: bounded.view_cursor_index,
    endCursor: reloaded.canonical_cursor_index, completed: true, disabledStep: true }
  await navigate('overview')
  // The full-bleed chart intentionally removes navigation chrome. Compare its
  // restored header/rail only across ordinary workspace pages.
  await page.evaluate(() => { window.__shellOracle.rail = document.querySelector('.fx-rail'); window.__shellOracle.header = document.querySelector('.fx-topbar') })
  await navigate('market-data')
  await page.locator('.data-library-toolbar').waitFor()
  const eventSnapshot = await page.evaluate(async () => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8000)
    try {
      const response = await fetch('/api/v2/events', { headers: { 'X-Workspace-Id': 'tenant-a' }, signal: controller.signal })
      const reader = response.body.getReader(), decoder = new TextDecoder()
      let result = ''
      while (!result.includes('data:')) { const { value, done } = await reader.read(); if (done) break; result += decoder.decode(value) }
      await reader.cancel(); return { status: response.status, text: result }
    } finally { controller.abort(); clearTimeout(timer) }
  })
  assert.equal(eventSnapshot.status, 200)
  assert.match(eventSnapshot.text, /tenant-a/)
  assert.equal(await page.evaluate(() => window.__shellOracle.shell === document.querySelector('[data-testid="fxreplay-shell"]')
    && window.__shellOracle.header === document.querySelector('.fx-topbar') && window.__shellOracle.rail === document.querySelector('.fx-rail')), true)
  await page.goBack(); await page.waitForURL(url => url.searchParams.get('view') === 'overview')
  assert.equal(documents, 1)
  assert.deepEqual(report.errors, [])
  report.documentNavigations = documents
  report.result = 'PASS'
  await page.screenshot({ path: path.join(output, 'browser-dashboard.png') })
} finally {
  await writeFile(path.join(output, 'browser.json'), JSON.stringify(report, null, 2))
  await browser.close()
}
console.log(JSON.stringify(report))
