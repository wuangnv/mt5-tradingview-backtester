import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const origin = process.env.TW_DASHBOARD_UI_ORIGIN || 'http://127.0.0.1:5180'
assert.equal(new URL(origin).hostname, '127.0.0.1')
const out = process.env.TW_UI_EVIDENCE_DIR || path.resolve('../evidence/ui-dashboard-pattern-20261003/sessions')
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ headless: true })
const results = [], errors = [], writes = []
const item = (id, changes = {}) => ({ record_id: id, revision: 1, name: `Fixture ${id}`, description: 'Phiên mô phỏng để kiểm thử, không phải thị trường thật.', instrument_id: 'EURUSD', timeframe: '60s', cursor_index: 3, dataset_id: 'dataset-fixture', dataset_available: true, status: 'paused', archived: false, updated_at_utc: '2026-10-01T09:00:00Z', ...changes })
let catalog = [item('older'), item('latest', { updated_at_utc: '2026-10-02T09:00:00Z' }), item('archived', { archived: true }), item('missing', { dataset_available: false }), item('unknown', { dataset_available: null }), item('gbp', { instrument_id: 'GBPUSD' })]
let catalogState = 'ready', analyticsState = 'ready', release
function analytics(id) {
  const empty = analyticsState === 'empty'
  const currency = id === 'gbp' ? 'EUR' : 'USD'
  const pnl = id === 'gbp' ? -20 : id === 'latest' ? 30 : 10
  const balances = empty ? [1000] : [1000, 1100, 950, 1000 + pnl]
  const ledger = empty ? [] : [100, -150, 50 + pnl].map(net_pnl => ({ net_pnl }))
  return { schema_version: 'analytics-read-model-v1', analytics_available: analyticsState !== 'blocked', blocked_by_data: analyticsState === 'blocked' ? ['fixture_missing_data'] : [], partial: analyticsState === 'partial', stale: analyticsState === 'stale', scope: { selected_trade_count: ledger.length, total_trade_count: ledger.length, active_filters: false }, provenance: { session_id: id, workspace_id: 'dashboard-fixture', account_currency: currency, revision: 1 }, metrics: { closed_trade_count: ledger.length, net_pnl: analyticsState === 'unknown' ? null : empty ? 0 : pnl, win_rate_pct: empty ? null : 2 / 3 * 100, wins: empty ? 0 : 2, losses: empty ? 0 : 1, breakeven: 0, closed_trade_balance_max_drawdown: analyticsState === 'unknown' ? null : 150, starting_balance: 1000, closed_trade_balance_curve: analyticsState === 'unknown' ? [] : balances.map((closed_trade_balance, sequence) => ({ closed_trade_balance, sequence })) }, ledger: analyticsState === 'unknown' ? ledger.map(() => ({ net_pnl: null })) : ledger }
}
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 987 }, reducedMotion: 'reduce' })
  await context.routeWebSocket('**/*', socket => socket.close())
  await context.addInitScript(() => localStorage.setItem('tw:replay:last:dashboard-fixture', 'older'))
  const page = await context.newPage()
  globalThis.qaPage = page; page.setDefaultTimeout(10000)
  page.on('pageerror', e => errors.push(e.message))
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url())
    if (url.origin !== origin) return route.abort()
    if (!url.pathname.startsWith('/api/')) return route.continue()
    if (req.method() !== 'GET') { writes.push(req.method()); return route.fulfill({ status: 403, json: { detail: 'fixture_read_only' } }) }
    assert.equal(req.headers()['x-workspace-id'], 'dashboard-fixture')
    if (url.pathname === '/api/v2/replay/sessions') {
      if (catalogState === 'error') return route.fulfill({ status: 503, json: { detail: 'fixture_catalog_unavailable' } })
      return route.fulfill({ json: { items: catalog } })
    }
    if (url.pathname.endsWith('/analytics')) {
      const id = url.pathname.split('/').at(-2), response = analytics(id)
      assert.equal(url.search, '', 'Dashboard always reads the entire canonical selected session; Analytics owns date/cutoff filters')
      if (analyticsState === 'slow') await new Promise(resolve => { release = resolve })
      if (analyticsState === 'error') return route.fulfill({ status: 503, json: { detail: 'fixture_analytics_unavailable' } })
      if (analyticsState === 'malformed') response.scope.selected_trade_count = 999
      return route.fulfill({ json: response }).catch(() => {})
    }
    return route.fulfill({ status: 404, json: { detail: 'fixture_not_implemented' } })
  })
  const go = extra => page.goto(`${origin}/?workspace=dashboard-fixture&view=overview&session=stale&cursor=999&cutoff=stale&trade=stale${extra || ''}`)
  const resume = page.getByTestId('dashboard-resume'), metrics = page.getByTestId('dashboard-performance'), notice = page.getByTestId('dashboard-data-state')
  const waitMetric = (index, text) => page.waitForFunction(({ index, text }) => document.querySelectorAll('.fx-dashboard-metric strong')[index]?.textContent === text, { index, text })
  await go(); await waitMetric(0, '10 USD')
  assert.equal(await page.getByLabel('Phiên kết quả').inputValue(), 'older')
  assert.equal(await page.locator('.fx-dashboard-session-row').count(), 3)
  assert.equal(await page.locator('.fx-dashboard-cards, .fx-dashboard-catalog-controls').count(), 0)
  const href = new URL(await resume.getByRole('link', { name: 'Tiếp tục replay' }).getAttribute('href'), origin)
  assert.equal(href.searchParams.get('session'), 'older')
  assert.equal(href.searchParams.get('surface'), 'workspace')
  for (const key of ['cursor', 'cutoff', 'trade', 'select']) assert.equal(href.searchParams.has(key), false)
  results.push('remembered session, three recent rows, compact actions and canonical replay context')
  await page.getByLabel('Phiên kết quả').selectOption('gbp'); await waitMetric(0, '-20 EUR')
  assert.equal(new URL(page.url()).searchParams.get('dashboard_session'), 'gbp')
  await page.reload(); await waitMetric(0, '-20 EUR')
  const reportHref = new URL(await page.getByRole('link', { name: 'Phân tích chi tiết' }).getAttribute('href'), origin)
  assert.equal(reportHref.searchParams.get('session'), 'gbp')
  assert.equal(reportHref.searchParams.get('cursor'), null)
  assert.equal(reportHref.searchParams.get('surface'), 'workspace')
  results.push('selection persists through URL/reload; EUR result never summed with USD; deep report uses selected scope')
  analyticsState = 'slow'
  await page.getByLabel('Phiên kết quả').selectOption('older')
  await notice.getByText('Đang tải kết quả phiên…', { exact: true }).waitFor()
  assert.equal(await metrics.locator('strong').first().textContent(), '—')
  analyticsState = 'ready'
  await page.getByLabel('Phiên kết quả').selectOption('latest'); await waitMetric(0, '30 USD')
  release(); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  assert.equal(await page.getByLabel('Phiên kết quả').inputValue(), 'latest')
  assert.equal(await metrics.locator('strong').first().textContent(), '30 USD')
  results.push('changing scope clears old values; an aborted late response cannot replace selected result')
  for (const mode of ['partial', 'stale', 'empty', 'unknown', 'blocked', 'malformed', 'error']) {
    analyticsState = mode; await go('&dashboard_session=older')
    if (mode === 'partial') await notice.getByText(/Dữ liệu chưa đầy đủ/).waitFor()
    if (mode === 'stale') await notice.getByText(/Dữ liệu cũ/).waitFor()
    if (mode === 'empty') { await notice.getByText('Phiên chưa có giao dịch đóng.', { exact: true }).waitFor(); await waitMetric(0, '0 USD'); await waitMetric(1, '0'); assert.equal(await metrics.locator('strong').nth(2).textContent(), '—') }
    if (mode === 'unknown') { await waitMetric(0, '—'); await metrics.locator('strong').nth(1).getByText('3', { exact: true }).waitFor(); assert.equal(await metrics.locator('strong').nth(3).textContent(), '—'); assert.equal(await page.locator('.fx-dashboard-result-chart').count(), 0) }
    if (mode === 'blocked') { await notice.getByText(/Kết quả chưa khả dụng/).waitFor(); assert.deepEqual(await metrics.locator('strong').allTextContents(), ['—', '—', '—', '—']); assert.equal(await page.locator('.fx-dashboard-result-chart').count(), 0) }
    if (['malformed', 'error'].includes(mode)) { await notice.getByRole('button', { name: 'Thử lại kết quả' }).waitFor(); assert.equal(await metrics.locator('strong').first().textContent(), '—') }
  }
  analyticsState = 'ready'; await notice.getByRole('button', { name: 'Thử lại kết quả' }).click(); await waitMetric(0, '10 USD')
  results.push('partial/stale/empty/unknown/blocked retained metrics/malformed/error/retry states')
  await go('&dashboard_session=archived'); await waitMetric(0, '10 USD')
  assert.equal(await resume.getByRole('link', { name: 'Tiếp tục replay' }).count(), 0)
  await go('&dashboard_session=missing'); await waitMetric(0, '10 USD')
  assert.equal(await resume.getByRole('link', { name: 'Tiếp tục replay' }).count(), 0)
  await go('&dashboard_session=foreign'); await resume.getByText('Phiên đã chọn không còn trong danh mục.', { exact: true }).waitFor()
  assert.equal(await metrics.locator('strong').first().textContent(), '—')
  await resume.getByRole('button', { name: 'Chọn phiên gần nhất' }).click(); await waitMetric(0, '10 USD')
  catalog = []; await go(); await resume.getByText('Bắt đầu phiên replay đầu tiên', { exact: true }).waitFor()
  catalogState = 'error'; await go(); await resume.getByText('Chưa đọc được danh mục phiên', { exact: true }).waitFor()
  catalogState = 'ready'; catalog = [item('recovered')]
  await resume.getByRole('button', { name: 'Thử lại danh mục' }).click(); await waitMetric(0, '10 USD')
  results.push('archived/missing sources cannot resume; invalid explicit scope is not silently replaced; catalog empty/error/recovery')
  assert.deepEqual(writes, []); await context.close()

  const real = await browser.newContext({ viewport: { width: 1440, height: 987 }, reducedMotion: 'reduce' })
  const session = '39b1d068edd64e75864f692f27237852'
  await real.addInitScript(session => localStorage.setItem('tw:replay:last:tenant-a', session), session)
  await real.route('**/*', route => { const r = route.request(); if (new URL(r.url()).origin !== origin) return route.abort(); if (!['GET', 'HEAD', 'OPTIONS'].includes(r.method())) { writes.push(r.method()); return route.abort() }; return route.continue() })
  const live = await real.newPage(); globalThis.qaPage = live; live.setDefaultTimeout(20000); live.on('pageerror', e => errors.push(e.message))
  await live.goto(`${origin}/?workspace=tenant-a&view=overview&area=testing&section=dashboard`)
  await live.waitForFunction(() => document.querySelector('.fx-dashboard-metric strong')?.textContent === '75 USD')
  assert.deepEqual(await live.locator('.fx-dashboard-metric strong').allTextContents(), ['75 USD', '60', '100%', '0 USD'])
  await live.locator('.fx-dashboard-result-chart').waitFor()
  assert.match(await live.locator('#dashboard-curve-desc').textContent(), /60 lệnh; từ 0 đến 75 USD/)
  for (const theme of ['dark', 'light']) {
    if (theme === 'light') await live.getByTestId('theme-toggle').click()
    for (const width of [1440, 768, 390, 320]) {
      await live.setViewportSize({ width, height: 987 })
      assert.equal(await live.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0)
      assert.ok(await live.locator('.fx-content').evaluate(e => e.scrollWidth - e.clientWidth) <= 1)
      await live.screenshot({ path: path.join(out, `real-${theme}-${width}.png`) })
      await live.locator('.fx-content').evaluate(e => { e.scrollTop = e.scrollHeight })
      await live.screenshot({ path: path.join(out, `real-${theme}-${width}-bottom.png`) })
      await live.locator('.fx-content').evaluate(e => { e.scrollTop = 0 })
    }
  }
  await live.setViewportSize({ width: 1440, height: 987 })
  await live.getByTestId('dashboard-resume').getByRole('link', { name: 'Tiếp tục replay' }).click()
  await live.waitForFunction(() => document.querySelector('[data-testid="replay-chart"]')?.dataset.visibleRowCount === '61')
  assert.equal(await live.getByText('Cursor #60', { exact: true }).textContent(), 'Cursor #60')
  await live.reload(); await live.waitForFunction(() => document.querySelector('[data-testid="replay-chart"]')?.dataset.visibleRowCount === '61')
  await live.goto(`${origin}/?workspace=tenant-a&view=overview&dashboard_session=${session}`)
  await live.getByRole('link', { name: 'Phân tích chi tiết' }).click()
  await live.locator('.as-page').waitFor(); await live.locator('.as-story-metric').filter({ hasText: 'Trades' }).getByText('60', { exact: true }).waitFor()
  assert.equal(new URL(live.url()).searchParams.get('session'), session)
  await live.getByLabel('Analytics from date').fill('2024-01-02')
  await live.getByTestId('analytics-empty').waitFor()
  results.push('real isolated API: 60 trades/net75USD/DD0, chart61points, 8 responsive/theme snapshots, resume/reload61candles, deep report date filter')
  assert.deepEqual(errors, []); assert.deepEqual(writes, [])
  await real.close()
  await writeFile(path.join(out, 'report.json'), JSON.stringify({ status: 'PASS', results, errors, writes }, null, 2))
  console.log(JSON.stringify({ status: 'PASS', results, out }))
} catch (error) {
  await globalThis.qaPage?.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {})
  await writeFile(path.join(out, 'failure.json'), JSON.stringify({ results, error: error.message, errors, writes }, null, 2))
  throw error
} finally { await browser.close() }
