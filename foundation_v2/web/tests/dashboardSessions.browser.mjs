import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const origin = process.env.TW_DASHBOARD_UI_ORIGIN || 'http://127.0.0.1:5180'
assert.equal(new URL(origin).hostname, '127.0.0.1')
const out = process.env.TW_UI_EVIDENCE_DIR || path.resolve('../evidence/ui-dashboard-fx-20261003/journeys')
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ headless: true })
const report = { scope: 'Dashboard FX layout: isolated actual GET API journeys + separately labeled browser fixtures; no backend writes', actual: [], fixtures: [], errors: [], writes: [] }
let page
const metrics = () => page.locator('.fx-dashboard-metric strong')
const waitMetric = (index, text) => page.waitForFunction(({ index, text }) => document.querySelectorAll('.fx-dashboard-metric strong')[index]?.textContent === text, { index, text })
const go = extra => page.goto(`${origin}/?workspace=tenant-a&view=overview&area=testing&section=dashboard${extra || ''}`)
function guard(context) {
  return context.route('**/*', route => {
    const request = route.request()
    if (new URL(request.url()).origin !== origin) return route.abort()
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) { report.writes.push(request.method()); return route.abort() }
    return route.continue()
  })
}
const session = '39b1d068edd64e75864f692f27237852'
try {
  const context = await browser.newContext({ viewport: { width: 1598, height: 987 }, reducedMotion: 'reduce' })
  await guard(context)
  page = await context.newPage()
  page.setDefaultTimeout(10000)
  page.on('pageerror', error => report.errors.push(error.message))
  const response = page.waitForResponse(res => new URL(res.url()).pathname === '/api/v2/overview')
  await go()
  const oracle = (await (await response).json()).performance
  await waitMetric(2, String(oracle.metrics.closed_trade_count))
  assert.deepEqual(await metrics().allTextContents(), ['—', '—', '60', '100%'])
  assert.equal(oracle.metrics.closed_trade_count, 60)
  assert.equal(oracle.metrics.win_rate_pct, 100)
  assert.equal(oracle.time_invested_seconds, null)
  assert.equal(await page.getByLabel('Phạm vi Performance').inputValue(), '')
  assert.match(await page.getByTestId('dashboard-data-state').textContent(), /7\/25/)
  assert.match(await page.getByRole('img', { name: /^Giao dịch theo tháng:/ }).getAttribute('aria-label'), /2024-01: 60 giao dịch/)
  assert.match(await page.getByRole('img', { name: /^Giao dịch theo symbol:/ }).getAttribute('aria-label'), /EURUSD: 60/)
  const actions = page.getByRole('navigation', { name: 'Bắt đầu luyện tập' }).getByRole('link')
  assert.equal(await actions.count(), 3)
  const newSession = new URL(await actions.nth(0).getAttribute('href'), origin)
  assert.equal(newSession.searchParams.get('fresh'), '1')
  assert.equal(newSession.searchParams.get('view'), 'replay')
  for (const key of ['session', 'dataset', 'cursor', 'cutoff', 'select']) assert.equal(newSession.searchParams.has(key), false)
  assert.equal(new URL(await actions.nth(1).getAttribute('href'), origin).searchParams.get('view'), 'testing')
  assert.equal(new URL(await actions.nth(2).getAttribute('href'), origin).searchParams.get('view'), 'learn')
  report.actual.push('actual API: 60 unique closed trades/100%/Jan2024/EURUSD; time unknown; partial7of25; three canonical entry actions')

  const subnav = page.locator('.fx-subnav a').nth(1)
  const beforeHover = await subnav.evaluate(e => getComputedStyle(e).backgroundColor)
  await subnav.hover()
  assert.notEqual(await subnav.evaluate(e => getComputedStyle(e).backgroundColor), beforeHover)
  await subnav.focus()
  assert.equal(await subnav.evaluate(e => getComputedStyle(e).outlineStyle), 'solid')
  report.actual.push('subnav hover background and keyboard focus retain active underline')
  await page.getByLabel('Tìm phiên gần đây').fill('NO_MATCH_DASHBOARD')
  assert.ok(await page.getByLabel('Tìm phiên gần đây').evaluate(e => Number.parseFloat(getComputedStyle(e).paddingLeft)) >= 38, 'Search text clears its icon')
  await page.getByText('Không có phiên khớp bộ lọc.', { exact: false }).waitFor()
  assert.equal(await metrics().nth(2).textContent(), '60', 'List search does not narrow Performance')
  await page.reload()
  assert.equal(await page.getByLabel('Tìm phiên gần đây').inputValue(), 'NO_MATCH_DASHBOARD')
  await page.getByRole('button', { name: 'Xóa bộ lọc danh sách' }).click()
  await page.getByLabel('Lọc trạng thái phiên').selectOption('all')
  await page.getByRole('button', { name: 'Trang phiên sau' }).click()
  assert.equal(new URL(page.url()).searchParams.get('dashboard_page'), '2')
  await page.reload()
  await page.locator('.fx-dashboard-pagination').getByText('2 / 5', { exact: true }).waitFor()
  await page.getByLabel('Sắp xếp phiên').selectOption('oldest')
  assert.equal(new URL(page.url()).searchParams.has('dashboard_page'), false)
  report.actual.push('search empty/reset/reload; all-status pagination reload; sorting resets page; list/performance independent')

  await go(`&dashboard_session=${session}&cursor=999&cutoff=stale&dataset=stale&trade=stale`)
  await waitMetric(2, '60')
  await page.getByLabel('Tìm phiên gần đây').fill('QA — 60')
  const selectedRow = page.locator(`.fx-dashboard-session-row[data-session-id="${session}"]`)
  await selectedRow.waitFor()
  assert.equal(await selectedRow.getByRole('button', { name: 'Kết quả' }).getAttribute('aria-pressed'), 'true')
  const menu = selectedRow.locator('details')
  await menu.locator('summary').click()
  for (const [name, intent] of [['Đổi tên', 'rename'], ['Tạo bản sao', 'duplicate'], ['Lưu trữ phiên', 'archive']]) {
    const href = new URL(await menu.getByRole('link', { name, exact: true }).getAttribute('href'), origin)
    assert.equal(href.searchParams.get('session'), session)
    assert.equal(href.searchParams.get('manage'), intent)
    for (const key of ['cursor', 'cutoff', 'trade']) assert.equal(href.searchParams.has(key), false)
  }
  await page.keyboard.press('Escape')
  assert.equal(await menu.evaluate(e => e.open), false)
  await menu.locator('summary').click()
  await page.getByRole('heading', { name: 'Recent Sessions' }).click()
  assert.equal(await menu.evaluate(e => e.open), false)
  await selectedRow.getByRole('link', { name: /^Tiếp tục/ }).click()
  await page.waitForFunction(() => document.querySelector('[data-testid="replay-chart"]')?.dataset.visibleRowCount === '61')
  assert.equal(new URL(page.url()).searchParams.get('session'), session)
  await page.reload()
  await page.waitForFunction(() => document.querySelector('[data-testid="replay-chart"]')?.dataset.visibleRowCount === '61')
  await go(`&dashboard_session=${session}`)
  await waitMetric(2, '60')
  await page.getByRole('link', { name: 'Phân tích phiên' }).click()
  await page.getByTestId('analytics-workspace').waitFor()
  assert.equal(new URL(page.url()).searchParams.get('session'), session)
  report.actual.push('selected row and scoped manage links; Escape/outside dismiss; actual resume/reload61candles and selected Analytics route')

  await go()
  await waitMetric(2, '60')
  const scope = page.getByLabel('Phạm vi Performance')
  await scope.click()
  await page.waitForFunction(() => document.querySelector('select[aria-label="Phạm vi Performance"]').matches(':open'))
  await page.screenshot({ path: path.join(out, 'actual-picker-dark-1598.png') })
  await page.keyboard.press('Escape')
  assert.equal(await scope.inputValue(), '')
  await page.getByLabel('Thời gian Performance').selectOption('custom')
  await page.getByLabel('Từ ngày (UTC)').fill('2024-01-01')
  await page.getByLabel('Đến ngày (UTC)').fill('2024-01-31')
  await waitMetric(2, '60')
  await page.reload()
  assert.equal(await page.getByLabel('Thời gian Performance').inputValue(), 'custom')
  assert.equal(await page.getByLabel('Từ ngày (UTC)').inputValue(), '2024-01-01')
  await page.getByLabel('Từ ngày (UTC)').fill('2024-02-01')
  await page.getByText('Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.').waitFor()
  assert.deepEqual(await metrics().allTextContents(), ['—', '—', '—', '—'])
  await page.getByLabel('Thời gian Performance').selectOption('30d')
  await waitMetric(2, '0')
  assert.equal(await metrics().nth(3).textContent(), '—')
  await page.getByLabel('Thời gian Performance').selectOption('lifetime')
  await waitMetric(2, '60')
  report.actual.push('native picker Escape; real custom UTC range + reload + inverted dates; last30days zero trades/unknown winrate; lifetime restore')

  for (const theme of ['dark', 'light']) {
    if (theme === 'light') await page.getByTestId('theme-toggle').click()
    for (const width of [1598, 1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 987 })
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0)
      assert.ok(await page.locator('.fx-content').evaluate(e => e.scrollWidth - e.clientWidth) <= 1)
      await page.locator('.fx-content').evaluate(e => { e.scrollTop = 0 })
      await page.screenshot({ path: path.join(out, `actual-${theme}-${width}-top.png`) })
      await page.locator('.fx-dashboard-secondary-charts').scrollIntoViewIfNeeded()
      await page.screenshot({ path: path.join(out, `actual-${theme}-${width}-charts.png`) })
      await page.getByTestId('dashboard-recent').scrollIntoViewIfNeeded()
      await page.screenshot({ path: path.join(out, `actual-${theme}-${width}-recent.png`) })
      const recentScope = page.getByLabel('Lọc trạng thái phiên')
      await recentScope.click()
      await page.waitForFunction(() => document.querySelector('select[aria-label="Lọc trạng thái phiên"]').matches(':open'))
      const option = recentScope.locator('option:checked')
      const box = await option.boundingBox()
      assert.ok(box.x >= 0 && box.x + box.width <= width + 1)
      assert.ok(box.height >= 44)
      await page.screenshot({ path: path.join(out, `actual-${theme}-${width}-picker.png`) })
      await page.keyboard.press('Escape')
    }
  }
  report.actual.push('30 top/charts/recent screenshots +10 open native pickers: both themes 1598/1440/768/390/320px; no page overflow')
  await context.close()

  // Browser fixtures below are intentionally separate from the actual service oracle.
  const fixture = await browser.newContext({ viewport: { width: 1440, height: 987 }, reducedMotion: 'reduce' })
  await guard(fixture)
  await fixture.routeWebSocket('**/*', socket => socket.close())
  let mode = 'ready', release, signalSlow
  const slowSeen = new Promise(resolve => { signalSlow = resolve })
  const makeItem = (index, changes = {}) => ({ record_id: `s${index}`, revision: 1, name: `Fixture ${index}`, dataset_id: 'fixture-dataset', dataset_available: true, instrument_id: index % 2 ? 'EURUSD' : 'GBPUSD', timeframe: '60s', cursor_index: 60, status: index === 2 ? 'completed' : 'paused', archived: index === 7, updated_at_utc: `2026-10-${String(index).padStart(2, '0')}T09:00:00Z`, ...changes })
  let catalog = Array.from({ length: 8 }, (_, index) => makeItem(index + 1))
  function performance(selected) {
    const empty = mode === 'empty', blocked = mode === 'blocked', count = blocked ? null : empty ? 0 : selected === 's1' ? 99 : 12
    return { performance: { schema_version: 'dashboard-replay-performance-v1', status: mode === 'partial' || blocked ? 'partial' : 'ready', scope: { session_id: selected || null, session_count: 8, readable_session_count: blocked ? 0 : mode === 'partial' ? 5 : 8, includes_archived: true, duplicate_trade_count: 0 }, metrics: { closed_trade_count: count, win_rate_pct: empty || blocked ? null : 50, wins: blocked ? null : empty ? 0 : 6, losses: blocked ? null : empty ? 0 : 6, breakeven: blocked ? null : 0 }, months: empty || blocked ? [] : [{ month: '2024-01', closed_trade_count: 4, win_rate_pct: 25 }, { month: '2024-02', closed_trade_count: 8, win_rate_pct: 62.5 }], symbols: empty || blocked ? [] : [{ symbol: 'EURUSD', closed_trade_count: 4 }, { symbol: 'GBPUSD', closed_trade_count: 8 }], sessions: [], sources: [], excluded: mode === 'partial' || blocked ? [{ session_id: 's7', reason: 'fixture_execution_unavailable' }] : [], time_invested_seconds: null, historical_time_replayed_seconds: null } }
  }
  await fixture.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url())
    assert.equal(request.method(), 'GET')
    assert.equal(request.headers()['x-workspace-id'], 'tenant-a')
    if (url.pathname === '/api/v2/replay/sessions') return mode === 'catalog-error' ? route.fulfill({ status: 503, json: { detail: 'fixture_catalog_unavailable' } }) : route.fulfill({ json: { items: catalog } })
    if (url.pathname === '/api/v2/overview') {
      const payload = performance(url.searchParams.get('session_id'))
      if (mode === 'slow') await new Promise(resolve => { release = resolve; signalSlow() })
      if (mode === 'error') return route.fulfill({ status: 503, json: { detail: 'fixture_overview_unavailable' } })
      if (mode === 'malformed') payload.performance.months = null
      return route.fulfill({ json: payload }).catch(() => {})
    }
    return route.fulfill({ status: 404, json: { detail: 'fixture_not_implemented' } })
  })
  page = await fixture.newPage()
  page.setDefaultTimeout(10000)
  page.on('pageerror', error => report.errors.push(error.message))
  await go()
  await waitMetric(2, '12')
  assert.equal(await page.locator('.fx-dashboard-session-row').count(), 6)
  assert.match(await page.getByRole('img', { name: /^Giao dịch theo tháng/ }).getAttribute('aria-label'), /2024-02: 8/)
  await page.getByLabel('Lọc trạng thái phiên').selectOption('archived')
  assert.equal(await page.locator('.fx-dashboard-session-row').count(), 1)
  assert.equal(await page.getByRole('link', { name: /^Tiếp tục/ }).count(), 0)
  await page.locator('.fx-dashboard-session-menu summary').click()
  assert.equal(await page.getByRole('link', { name: 'Khôi phục phiên' }).count(), 1)
  await page.getByLabel('Lọc trạng thái phiên').selectOption('completed')
  assert.equal(await page.locator('.fx-dashboard-session-row').getAttribute('data-session-id'), 's2')
  report.fixtures.push('multi-month and multi-symbol charts; archived-only/no resume/restore menu; completed-only; six-row pagination')
  mode = 'slow'
  await page.getByLabel('Phạm vi Performance').selectOption('s1')
  await page.getByText('Đang tải Performance…').waitFor()
  assert.equal(await metrics().nth(2).textContent(), '—')
  await page.waitForFunction(() => document.querySelector('[aria-label="Performance"]').getAttribute('aria-busy') === 'true')
  await slowSeen
  mode = 'ready'
  await page.getByLabel('Phạm vi Performance').selectOption('s2')
  await waitMetric(2, '12')
  release()
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  assert.equal(await metrics().nth(2).textContent(), '12')
  assert.equal(await page.getByLabel('Phạm vi Performance').inputValue(), 's2')
  report.fixtures.push('slow scope clears old data; aborted late s1 response cannot replace s2 metrics')
  for (const next of ['empty', 'blocked', 'partial', 'malformed', 'error']) {
    mode = next
    await go()
    if (next === 'empty') { await waitMetric(2, '0'); assert.equal(await metrics().nth(3).textContent(), '—'); assert.equal(await page.getByRole('img', { name: /^Giao dịch theo tháng/ }).count(), 0) }
    if (next === 'blocked') { await page.getByText('Chưa đủ dữ liệu thực thi để tính Performance.').waitFor(); assert.deepEqual(await metrics().allTextContents(), ['—', '—', '—', '—']) }
    if (next === 'partial') { await page.getByText(/đọc được 5\/8/).waitFor(); await waitMetric(2, '12') }
    if (['malformed', 'error'].includes(next)) { await page.getByRole('button', { name: 'Thử lại kết quả' }).waitFor(); assert.equal(await metrics().nth(2).textContent(), '—') }
  }
  mode = 'ready'
  await page.getByRole('button', { name: 'Thử lại kết quả' }).click()
  await waitMetric(2, '12')
  catalog = [makeItem(1, { name: 'Phiên tên rất dài '.repeat(18), dataset_available: false })]
  await go()
  await page.locator('.fx-dashboard-session-row').waitFor()
  assert.equal(await page.getByRole('link', { name: /^Tiếp tục/ }).count(), 0)
  await page.setViewportSize({ width: 320, height: 987 })
  await page.getByTestId('dashboard-recent').scrollIntoViewIfNeeded()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0)
  await page.screenshot({ path: path.join(out, 'fixture-long-name-320.png') })
  catalog = []
  await go()
  await page.getByText('Chưa có phiên. Tạo backtest đầu tiên ở phía trên.').waitFor()
  mode = 'catalog-error'
  await go()
  await page.getByRole('button', { name: 'Thử lại danh mục' }).waitFor()
  mode = 'ready'; catalog = [makeItem(1)]
  await page.getByRole('button', { name: 'Thử lại danh mục' }).click()
  await page.locator('.fx-dashboard-session-row').waitFor()
  report.fixtures.push('empty/blocked/partial/malformed/error/retry; missing dataset cannot resume; long name320; catalog empty/error/recovery')
  assert.deepEqual(report.errors, [])
  assert.deepEqual(report.writes, [])
  await fixture.close()
  await writeFile(path.join(out, 'report.json'), JSON.stringify({ status: 'PASS', ...report }, null, 2))
  console.log(JSON.stringify({ status: 'PASS', actual: report.actual, fixtures: report.fixtures, out }))
} catch (error) {
  await page?.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {})
  await writeFile(path.join(out, 'failure.json'), JSON.stringify({ ...report, error: error.message }, null, 2))
  throw error
} finally { await browser.close() }
