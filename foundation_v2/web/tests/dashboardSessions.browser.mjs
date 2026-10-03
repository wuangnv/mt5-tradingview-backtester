import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const origin = process.env.TW_DASHBOARD_UI_ORIGIN || 'http://127.0.0.1:5180'
const out = process.env.TW_UI_EVIDENCE_DIR || path.resolve('../evidence/ui-dashboard-20261003/sessions')
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ headless: true })
const results = [], errors = [], writes = []
const item = (id, changes = {}) => ({ record_id: id, revision: 1, name: `Fixture ${id}`, description: 'Phiên mô phỏng để kiểm thử, không phải thị trường thật.', instrument_id: 'EURUSD', timeframe: '60s', cursor_index: 20, dataset_id: 'dataset-fixture', dataset_available: true, status: 'paused', archived: false, updated_at_utc: '2026-10-01T09:00:00Z', ...changes })
let catalog = [item('older'), item('latest', { updated_at_utc: '2026-10-02T09:00:00Z' }), item('archived', { archived: true }), item('missing', { dataset_available: false }), item('unknown', { dataset_available: null }), item('gbp', { instrument_id: 'GBPUSD' })]
let state = 'ready', release
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
  await context.routeWebSocket('**/*', socket => socket.close())
  await context.addInitScript(() => { localStorage.setItem('tw:replay:last:dashboard-fixture', 'older') })
  const page = await context.newPage()
  globalThis.qaPage = page
  page.setDefaultTimeout(10000)
  page.on('pageerror', e => errors.push(e.message))
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url())
    if (url.origin !== origin) return route.abort()
    if (!url.pathname.startsWith('/api/')) return route.continue()
    if (req.method() !== 'GET') { writes.push(req.method()); return route.fulfill({ status: 403, json: { detail: 'fixture_read_only' } }) }
    assert.equal(req.headers()['x-workspace-id'], 'dashboard-fixture')
    if (url.pathname === '/api/v2/replay/sessions') {
      if (state === 'slow') await new Promise(resolve => { release = resolve })
      if (state === 'error') return route.fulfill({ status: 503, json: { detail: 'fixture_catalog_unavailable' } })
      return route.fulfill({ json: { items: catalog } }).catch(() => {})
    }
    return route.fulfill({ status: 404, json: { detail: 'fixture_not_implemented' } })
  })
  const go = async (extra = '') => page.goto(`${origin}/?workspace=dashboard-fixture&view=overview&session=stale&cursor=999&cutoff=stale&trade=stale${extra}`)
  const resume = page.getByTestId('dashboard-resume')
  await go()
  await resume.getByRole('heading', { name: 'Fixture older' }).waitFor()
  const href = new URL(await resume.getByRole('link', { name: 'Tiếp tục replay' }).getAttribute('href'), origin)
  assert.equal(href.searchParams.get('session'), 'older')
  assert.equal(href.searchParams.get('surface'), 'workspace')
  for (const key of ['cursor', 'cutoff', 'trade', 'select']) assert.equal(href.searchParams.has(key), false)
  assert.equal(await page.locator('.fx-dashboard-detail').getAttribute('open'), null)
  results.push('stored valid session wins; stale chart context reset; detailed statistics collapsed')
  await page.getByLabel('Tìm phiên', { exact: true }).fill('GBPUSD')
  assert.equal(await page.locator('.fx-dashboard-session-row').count(), 1)
  await page.getByLabel('Tìm phiên', { exact: true }).fill('none')
  await page.getByText('Không có phiên phù hợp bộ lọc.', { exact: true }).waitFor()
  await page.getByLabel('Tìm phiên', { exact: true }).fill('')
  await page.getByRole('combobox', { name: 'Sắp xếp', exact: true }).selectOption('oldest')
  assert.equal(await page.locator('.fx-dashboard-session-row').first().getAttribute('data-session-id'), 'gbp')
  await page.getByLabel('Hiện phiên đã lưu trữ', { exact: true }).check()
  await page.getByLabel('Tìm phiên', { exact: true }).fill('archived')
  const archived = page.locator('[data-session-id="archived"]')
  assert.equal(await archived.getByRole('link', { name: 'Tiếp tục', exact: true }).count(), 0)
  await archived.getByLabel('Quản lý Fixture archived', { exact: true }).click()
  const restoreHref = await archived.getByRole('link', { name: 'Khôi phục phiên…' }).getAttribute('href')
  assert.match(restoreHref, /archived=1/)
  await archived.locator('summary').press('Escape')
  assert.equal(await archived.locator('details').getAttribute('open'), null)
  results.push('search, sort, no match, archived-only result and keyboard menu dismissal')
  await page.getByLabel('Tìm phiên', { exact: true }).fill('missing')
  assert.equal(await page.locator('[data-session-id="missing"]').getByRole('link', { name: 'Tiếp tục', exact: true }).count(), 0)
  results.push('missing dataset cannot resume')
  await page.evaluate(() => localStorage.setItem('tw:replay:last:dashboard-fixture', 'foreign-session'))
  // Stop the init script from overriding test selections by using a fresh page in the same context.
  for (const id of ['foreign-session', 'archived', 'missing', 'unknown']) {
    await page.addInitScript(id => localStorage.setItem('tw:replay:last:dashboard-fixture', id), id)
    await go(); await resume.getByRole('heading', { name: 'Fixture latest' }).waitFor()
    await resume.getByText('PHIÊN CẬP NHẬT GẦN NHẤT', { exact: true }).waitFor()
  }
  results.push('invalid, archived, missing and unknown stored selections fall back to newest playable session')
  for (const intent of ['rename', 'duplicate', 'archive']) {
    await page.goto(`${origin}/?workspace=dashboard-fixture&view=replay&select=1&session=older&manage=${intent}`)
    if (intent === 'rename') assert.equal(await page.getByLabel('Tên phiên', { exact: true }).inputValue(), 'Fixture older')
    else {
      const button = page.getByRole('button', { name: intent === 'duplicate' ? 'Tạo bản sao tại cutoff' : 'Lưu trữ phiên', exact: true })
      await button.waitFor(); await page.waitForFunction(name => document.activeElement?.textContent === name, intent === 'duplicate' ? 'Tạo bản sao tại cutoff' : 'Lưu trữ phiên')
    }
  }
  await page.goto(`${origin}${restoreHref}`)
  await page.getByRole('button', { name: 'Khôi phục phiên', exact: true }).waitFor()
  assert.deepEqual(writes, [])
  results.push('all management entrypoints are GET-only, preload rename or focus correct action; archived restore entry')
  catalog = [item('archived', { archived: true })]
  await go(); await resume.getByRole('heading', { name: 'Chưa có phiên có thể tiếp tục' }).waitFor()
  await page.getByLabel('Hiện phiên đã lưu trữ', { exact: true }).check()
  assert.equal(await page.locator('.fx-dashboard-session-row').count(), 1)
  catalog = []
  await go(); await resume.getByRole('heading', { name: 'Bắt đầu phiên replay đầu tiên' }).waitFor()
  state = 'error'
  await go(); await resume.getByRole('heading', { name: 'Chưa đọc được danh mục phiên' }).waitFor()
  state = 'ready'; catalog = [item('recovered')]
  await resume.getByRole('button', { name: 'Thử lại danh mục' }).click()
  await resume.getByRole('heading', { name: 'Fixture recovered' }).waitFor()
  state = 'slow'
  await go(); await resume.getByRole('heading', { name: 'Đang tải phiên của bạn…' }).waitFor()
  assert.equal(await resume.getByRole('link', { name: 'Tiếp tục replay' }).count(), 0)
  state = 'ready'; release(); await resume.getByRole('heading', { name: 'Fixture recovered' }).waitFor()
  results.push('small archived catalog, empty, error, retry and loading states')
  assert.deepEqual(errors, []); assert.deepEqual(writes, [])
  await context.close()

  const real = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
  const session = '39b1d068edd64e75864f692f27237852'
  await real.addInitScript(session => localStorage.setItem('tw:replay:last:tenant-a', session), session)
  await real.route('**/*', route => {
    const r = route.request()
    if (new URL(r.url()).origin !== origin) return route.abort()
    if (!['GET', 'HEAD', 'OPTIONS'].includes(r.method())) { writes.push(r.method()); return route.abort() }
    return route.continue()
  })
  const live = await real.newPage(); live.setDefaultTimeout(15000); live.on('pageerror', e => errors.push(e.message))
  await live.goto(`${origin}/?workspace=tenant-a&view=overview&area=testing&section=dashboard`)
  await live.getByTestId('dashboard-resume').getByRole('heading', { name: 'QA — 60 giao dịch mô phỏng' }).waitFor()
  await live.getByTestId('dashboard-data-state').filter({ hasText: '7/25' }).waitFor()
  for (const theme of ['dark', 'light']) {
    if (theme === 'light') await live.getByTestId('theme-toggle').click()
    for (const width of [1440, 768, 390, 320]) {
      await live.setViewportSize({ width, height: 1000 })
      assert.equal(await live.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0)
      assert.ok(await live.locator('.fx-content').evaluate(e => e.scrollWidth - e.clientWidth) <= 1)
      await live.screenshot({ path: path.join(out, `real-${theme}-${width}.png`), fullPage: true })
      await live.locator('.fx-content').evaluate(e => { e.scrollTop = e.scrollHeight })
      await live.screenshot({ path: path.join(out, `real-${theme}-${width}-bottom.png`) })
      await live.locator('.fx-content').evaluate(e => { e.scrollTop = 0 })
    }
  }
  await live.getByText('Bộ lọc và thống kê chi tiết', { exact: true }).click()
  await live.locator('.fx-dashboard-distributions').scrollIntoViewIfNeeded()
  await live.screenshot({ path: path.join(out, 'real-light-320-detail.png') })
  await live.setViewportSize({ width: 1440, height: 1000 })
  await live.getByTestId('dashboard-resume').getByRole('link', { name: 'Tiếp tục replay' }).click()
  await live.waitForURL(url => url.searchParams.get('session') === session && url.searchParams.get('surface') === 'workspace')
  await live.waitForFunction(() => document.querySelector('[data-testid="replay-chart"]')?.dataset.visibleRowCount === '61')
  assert.equal(await live.getByText('Cursor #60', { exact: true }).textContent(), 'Cursor #60')
  await live.reload()
  await live.waitForFunction(() => document.querySelector('[data-testid="replay-chart"]')?.dataset.visibleRowCount === '61')
  await live.screenshot({ path: path.join(out, 'real-resumed-chart.png') })
  results.push('real readonly API: saved QA session, partial 7/25 truthful overview, 8 responsive/theme screenshots, chart resume journey')
  await live.goto(`${origin}/?workspace=tenant-a&view=overview`)
  await live.getByTestId('dashboard-resume').getByRole('heading', { name: 'QA — 60 giao dịch mô phỏng' }).waitFor()
  await live.getByTestId('dashboard-resume').getByRole('link', { name: 'Xem kết quả phiên' }).click()
  await live.getByTestId('analytics-workspace').waitFor()
  assert.equal(await live.getByTestId('analytics-session-picker').count(), 0)
  await live.getByRole('heading', { name: '60 trade đóng', exact: true }).waitFor()
  results.push('canonical cursor #60 / 61 allowed candles survives reload; session results opens 60-trade Analytics')
  assert.deepEqual(errors, []); assert.deepEqual(writes, [])
  await writeFile(path.join(out, 'receipt.json'), JSON.stringify({ status: 'PASS', scope: 'Dashboard fixtures + local readonly synthetic database, no broker/product acceptance', results, errors, writes }, null, 2))
  console.log(JSON.stringify({ status: 'PASS', results, out }))
} catch (error) { await globalThis.qaPage?.screenshot({path: path.join(out, 'failure.png')}).catch(() => {}); console.log(await globalThis.qaPage?.locator('.fx-dashboard-catalog-controls').ariaSnapshot().catch(() => 'no controls')); throw error } finally { await browser.close() }
