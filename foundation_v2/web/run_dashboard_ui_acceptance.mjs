import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const origin = process.env.TW_DASHBOARD_UI_ORIGIN || 'http://127.0.0.1:5180'
const evidenceDir = process.env.TW_UI_EVIDENCE_DIR || path.resolve('artifacts/dashboard-integration')
const executablePath = process.env.TW_UI_QA_CHROMIUM || undefined
const sessions = [{ session_id: 'alpha', name: 'EURUSD phiên A', instrument_id: 'EURUSD' }, { session_id: 'beta', name: 'GBPUSD phiên B', instrument_id: 'GBPUSD' }]
const counts = { datasets: 2, research_jobs: { completed: 1 }, records: { replay: 2 } }

function fixture(params, mode = 'ready') {
  const session = params.get('session_id')
  const filtered = params.has('from_close_utc') || params.has('to_close_utc')
  const count = mode === 'empty' ? 0 : session || filtered ? 1 : 3
  const wins = count === 3 ? 2 : count
  const performance = {
    schema_version: 'dashboard-replay-performance-v1', status: mode === 'partial' || mode === 'unknown' ? 'partial' : 'ready', as_of_utc: '2026-10-01T07:00:00Z',
    scope: { session_id: session, session_count: session ? 1 : 2, readable_session_count: mode === 'unknown' ? 0 : mode === 'partial' || session ? 1 : 2, duplicate_trade_count: 0, timezone: 'UTC' },
    metrics: { closed_trade_count: count, wins, losses: count - wins, breakeven: 0, win_rate_pct: count ? wins / count * 100 : null },
    months: count ? [{ month: '2023-11', closed_trade_count: count, wins, win_rate_pct: wins / count * 100 }] : [],
    symbols: count ? [{ symbol: 'EURUSD', closed_trade_count: count, wins, win_rate_pct: wins / count * 100 }] : [],
    sessions,
    sources: (session ? sessions.filter((item) => item.session_id === session) : sessions).map((item) => ({ session_id: item.session_id, revision: 3, dataset_id: 'dataset-test', closed_trade_count: 1 })),
    excluded: mode === 'partial' || mode === 'unknown' ? [{ session_id: 'beta', reason: 'replay_execution_not_initialized' }] : [],
  }
  if (mode === 'unknown') {
    performance.metrics = { closed_trade_count: null, wins: null, losses: null, breakeven: null, win_rate_pct: null }
    performance.months = []; performance.symbols = []; performance.sources = []
  }
  return { counts, performance }
}

await mkdir(evidenceDir, { recursive: true })
const browser = await chromium.launch({ headless: true, executablePath })
const results = []
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.addInitScript(() => { localStorage.setItem('tw-theme', 'dark'); localStorage.setItem('tw-language', 'vi') })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  let mode = 'ready'
  let releaseSlow
  const requests = []
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    assert.equal(request.method(), 'GET', 'Dashboard must remain read only')
    if (url.pathname !== '/api/v2/overview') return route.fulfill({ status: 404, json: { detail: 'unexpected_api_request' } })
    assert.equal(request.headers()['x-workspace-id'], 'dashboard-fixture')
    requests.push(url.search)
    if (mode === 'error') return route.fulfill({ status: 503, json: { detail: 'fixture_unavailable' } })
    if (mode === 'slow' && url.searchParams.get('session_id') === 'alpha') await new Promise((resolve) => { releaseSlow = resolve })
    await route.fulfill({ status: 200, json: fixture(url.searchParams, mode) }).catch(() => {})
  })
  const go = async () => {
    await page.goto(`${origin}/?workspace=dashboard-fixture&view=overview`)
    await page.waitForFunction(() => document.querySelector('[data-testid="dashboard-data-state"]')?.textContent.includes('Đã tổng hợp'))
  }
  await go()
  assert.match(await page.getByTestId('dashboard-performance').innerText(), /66,7%/)
  for (const theme of ['dark', 'light']) {
    if (theme === 'light') await page.getByTestId('theme-toggle').click()
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
      await page.screenshot({ path: path.join(evidenceDir, `dashboard-${theme}-${width}.png`), fullPage: true })
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
      assert.ok(overflow <= 1, `overflow ${theme} ${width}: ${overflow}`)
      const geometry = await page.locator('.fx-content').evaluate((element) => ({ width: element.clientWidth, overflow: element.scrollWidth - element.clientWidth }))
      assert.ok(geometry.overflow <= 1, `content overflow ${theme} ${width}: ${geometry.overflow}`)
      if (width <= 600) assert.ok(geometry.width >= width - 80, `sidebar must leave readable mobile content after resize: ${geometry.width}`)
      await page.locator('.fx-content').evaluate((element) => { element.scrollTop = element.scrollHeight })
      await page.screenshot({ path: path.join(evidenceDir, `dashboard-${theme}-${width}-bottom.png`), fullPage: true })
      await page.locator('.fx-content').evaluate((element) => { element.scrollTop = 0 })
      results.push({ check: 'responsive', theme, width, overflow, content: geometry })
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByLabel('Phiên replay', { exact: true }).selectOption('beta')
  await page.waitForFunction(() => document.querySelector('[data-testid="dashboard-performance"]')?.textContent.includes('100%'))
  await page.getByLabel('Từ ngày đóng (UTC)', { exact: true }).fill('2023-11-14')
  await Promise.all([
    page.waitForResponse((response) => response.url().includes('to_close_utc=2023-11-15') && response.status() === 200),
    page.getByLabel('Đến ngày đóng (UTC)', { exact: true }).fill('2023-11-15'),
  ])
  await page.getByText('Nguồn dữ liệu và phạm vi tổng hợp', { exact: true }).click()
  const analytics = await page.getByRole('link', { name: /Xem Analytics/ }).first().getAttribute('href')
  assert.match(analytics, /session=beta/)
  assert.match(analytics, /from=2023-11-14/)
  assert.match(analytics, /to=2023-11-15/)
  assert.match(page.url(), /dashboard_session=beta/)
  mode = 'error'
  await page.getByRole('button', { name: 'Làm mới', exact: true }).click()
  await page.getByRole('button', { name: 'Thử lại', exact: true }).waitFor()
  assert.match(await page.getByTestId('dashboard-data-state').innerText(), /số liệu cũ/)
  assert.match(await page.getByTestId('dashboard-performance').innerText(), /100%/)
  mode = 'ready'
  await page.getByRole('button', { name: 'Thử lại', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('[data-testid="dashboard-data-state"]')?.textContent.includes('Đã tổng hợp'))
  const beforeInvalid = requests.length
  await page.getByLabel('Từ ngày đóng (UTC)', { exact: true }).fill('2024-01-01')
  await page.getByText('Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.', { exact: true }).waitFor()
  assert.equal(requests.length, beforeInvalid)
  assert.doesNotMatch(await page.getByTestId('dashboard-performance').innerText(), /100%/)
  await page.getByRole('button', { name: 'Xóa lọc', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('[data-testid="dashboard-performance"]')?.textContent.includes('66,7%'))
  mode = 'slow'
  await page.getByLabel('Phiên replay', { exact: true }).selectOption('alpha')
  await page.waitForFunction(() => document.querySelector('[data-testid="dashboard-data-state"]')?.textContent.includes('Đang tải'))
  for (let attempt = 0; !releaseSlow && attempt < 150; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 20))
  assert.ok(releaseSlow, 'delayed request should start within 3 seconds')
  await page.getByLabel('Phiên replay', { exact: true }).selectOption('beta')
  await page.waitForFunction(() => document.querySelector('[data-testid="dashboard-performance"]')?.textContent.includes('100%'))
  releaseSlow()
  assert.equal(await page.getByLabel('Phiên replay', { exact: true }).inputValue(), 'beta')
  for (const state of ['partial', 'empty', 'unknown']) {
    mode = state
    await Promise.all([
      page.waitForResponse((response) => response.url().includes('/api/v2/overview') && response.status() === 200),
      page.getByRole('button', { name: 'Làm mới', exact: true }).click(),
    ])
    await page.waitForFunction((state) => {
      const status = document.querySelector('[data-testid="dashboard-data-state"]')?.textContent || ''
      if (state === 'unknown') return status.includes('phần dữ liệu đọc được') && document.querySelector('.fx-dashboard-metric strong')?.textContent === '—'
      if (state === 'partial') return status.includes('phần dữ liệu đọc được')
      return status.includes('Chưa có giao dịch đóng trong phạm vi')
    }, state)
    const text = await page.getByTestId('dashboard-performance').innerText()
    if (state === 'partial') assert.match(await page.getByTestId('dashboard-data-state').innerText(), /phần dữ liệu đọc được/)
    if (state === 'empty') { assert.match(text, /Giao dịch đã đóng\n0/); assert.doesNotMatch(text, /0%/) }
    if (state === 'unknown') { assert.match(text, /Giao dịch đã đóng\n—/); assert.doesNotMatch(text, /0%/) }
  }
  assert.deepEqual(errors, [])
  results.push({ check: 'filters_scope_url_drilldown_error_retry_stale_empty_partial_unknown', pass: true })
  await writeFile(path.join(evidenceDir, 'fixture-receipt.json'), JSON.stringify({ status: 'PASS', scope: 'browser API fixture only', productAcceptance: 'NOT_EVALUATED', results }, null, 2))
  if (process.env.TW_DASHBOARD_SESSION) {
    const workspace = process.env.TW_DASHBOARD_WORKSPACE || 'tenant-a'
    const session = process.env.TW_DASHBOARD_SESSION
    const expected = Number(process.env.TW_DASHBOARD_EXPECTED_TRADES)
    assert.ok(Number.isInteger(expected) && expected >= 0, 'set TW_DASHBOARD_EXPECTED_TRADES from the seed oracle')
    const headers = { 'X-Workspace-Id': workspace }
    const overviewResponse = await fetch(`${origin}/api/v2/overview?session_id=${encodeURIComponent(session)}`, { headers })
    assert.equal(overviewResponse.status, 200)
    const overview = await overviewResponse.json()
    const analyticsResponse = await fetch(`${origin}/api/v2/replay/sessions/${encodeURIComponent(session)}/analytics`, { headers })
    assert.equal(analyticsResponse.status, 200)
    const analytics = await analyticsResponse.json()
    assert.equal(overview.performance.metrics.closed_trade_count, expected)
    assert.equal(analytics.scope.selected_trade_count, expected)
    const realPage = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    const realErrors = []
    realPage.on('pageerror', (error) => realErrors.push(error.message))
    await realPage.goto(`${origin}/?view=overview&workspace=${encodeURIComponent(workspace)}&dashboard_session=${encodeURIComponent(session)}`)
    await realPage.waitForFunction(() => document.querySelector('[data-testid="dashboard-data-state"]')?.textContent.includes('Đã tổng hợp'))
    assert.equal(await realPage.locator('.fx-dashboard-metric strong').first().innerText(), String(expected))
    await realPage.getByText('Nguồn dữ liệu và phạm vi tổng hợp', { exact: true }).click()
    await realPage.getByRole('link', { name: /Xem Analytics/ }).click()
    await realPage.waitForURL((url) => url.searchParams.get('view') === 'analytics' && url.searchParams.get('session') === session)
    await realPage.getByTestId('analytics-workspace').waitFor()
    await realPage.screenshot({ path: path.join(evidenceDir, 'dashboard-to-analytics-real-api.png'), fullPage: true })
    assert.deepEqual(realErrors, [])
    await writeFile(path.join(evidenceDir, 'integrated-receipt.json'), JSON.stringify({ status: 'PASS', scope: 'synthetic engine data through real API and isolated PostgreSQL', session, workspace, expectedTradeCount: expected, revision: overview.performance.sources[0].revision, productAcceptance: 'SCOPED_ONLY', broker: 'NOT_CONTACTED' }, null, 2))
    await realPage.close()
  }
  console.log(JSON.stringify({ status: 'PASS', scope: 'browser API fixture only', results, evidenceDir }))
} finally {
  await browser.close()
}
