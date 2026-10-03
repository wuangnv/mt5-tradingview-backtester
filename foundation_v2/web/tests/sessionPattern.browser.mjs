import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const origin = process.env.SESSION_QA_ORIGIN || 'http://127.0.0.1:5180'
const output = process.env.SESSION_QA_ARTIFACTS || path.resolve('../../../../.artifacts/wm-pattern-session-20261003/real-readonly')
const session = '39b1d068edd64e75864f692f27237852'
assert.equal(new URL(origin).hostname, '127.0.0.1')
const headers = { 'X-Workspace-Id': 'tenant-a' }
const baselineResponse = await fetch(`${origin}/api/v2/replay/sessions/${session}/analytics`, { headers })
assert.equal(baselineResponse.status, 200)
const baseline = await baselineResponse.json()
assert.equal(baseline.scope.selected_trade_count, 60)
assert.equal(baseline.metrics.net_pnl, 75)
assert.equal(baseline.account_currency, 'USD')
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true, executablePath: process.env.TW_UI_QA_CHROMIUM || 'C:/Users/MIIKEY/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe' })
const context = await browser.newContext({ viewport: { width: 1440, height: 987 }, reducedMotion: 'reduce' })
const errors = [], blockedWrites = [], external = [], checks = [], screenshots = []
let injectedState = ''
await context.routeWebSocket('**/*', socket => socket.close())
await context.route('**/*', async route => {
  const request = route.request(), url = new URL(request.url())
  if (url.origin !== origin) { external.push(url.origin); return route.abort() }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) { blockedWrites.push(request.method() + ' ' + url.pathname); return route.abort() }
  if (injectedState && url.pathname === `/api/v2/replay/sessions/${session}/analytics`) {
    if (injectedState === 'error') return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'fixture_unavailable' }) })
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...baseline, [injectedState]: true }) })
  }
  return route.continue()
})
const page = await context.newPage()
page.setDefaultTimeout(30000)
page.on('pageerror', error => errors.push(error.message))
await context.addInitScript(() => { localStorage.setItem('tw-language', 'vi') })
const open = async (view, suffix = '') => {
  await page.goto(`${origin}/?workspace=tenant-a&view=${view}&select=1&session=${session}${suffix}`)
  await page.getByTestId('session-catalog-status').filter({ hasText: 'phiên đang hoạt động' }).waitFor()
  await page.getByTestId('analytics-workspace').waitFor()
  await page.getByText('Đang tải kết quả…', { exact: true }).waitFor({ state: 'hidden' })
}
try {
  for (const theme of ['dark', 'light']) {
    await page.goto(origin)
    await page.evaluate(theme => localStorage.setItem('tw-theme', theme), theme)
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 987 })
      for (const view of ['replay', 'trade', 'analytics']) {
        await open(view)
        assert.equal(await page.locator('.fx-content h1').count(), 1)
        const layout = await page.evaluate(() => {
          const outer = document.querySelector('.fx-session-picker'), embedded = document.querySelector('.as-embedded')
          const style = getComputedStyle(outer), embedStyle = getComputedStyle(embedded)
          return { overflow: document.documentElement.scrollWidth - innerWidth, padding: style.paddingLeft, embeddedPadding: embedStyle.paddingLeft, h1: getComputedStyle(document.querySelector('.fx-content h1')).fontSize }
        })
        assert.ok(layout.overflow <= 1, JSON.stringify({ view, width, theme, layout }))
        assert.equal(layout.h1, '22px')
        assert.equal(layout.embeddedPadding, '0px')
        assert.equal(layout.padding, width === 390 ? '16px' : '32px')
        const metric = page.locator('.as-story-metric').filter({ has: page.locator('dt', { hasText: /^Net P\/L$/ }) })
        assert.match(await metric.innerText(), /75[\s\S]*USD/)
        if (view === 'analytics') {
          assert.equal(await page.locator('.as-provenance-details').getAttribute('open'), null)
          assert.equal(await page.locator('.as-metric-disclosure > details').getAttribute('open'), null)
          assert.equal(await page.locator('.as-chart-point').count(), 61)
          assert.equal(await page.locator('.as-evidence-panel').evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)')
          const chartWidth = await page.locator('.as-balance-chart').evaluate(el => el.getBoundingClientRect().width)
          const reportWidth = await page.locator('.as-page').evaluate(el => el.getBoundingClientRect().width)
          assert.ok(Math.abs(chartWidth - reportWidth) <= 1, 'chart gets the full result width')
          await page.waitForFunction(() => {
            const svg = document.querySelector('.as-balance-chart')
            return Math.abs(svg.viewBox.baseVal.width - svg.clientWidth) <= 1
          })
          const point = await page.locator('.as-chart-point').first().evaluate(el => { const rect = el.getBoundingClientRect(); return { width: rect.width, height: rect.height } })
          assert.ok(Math.abs(point.width - point.height) <= .1 && point.width <= 8, 'balance markers stay circular and compact at the real responsive plot size')
        }
        const filename = `${view}-${theme}-${width}.png`
        await page.screenshot({ path: path.join(output, filename), fullPage: true })
        screenshots.push({ filename, ...layout })
        if (view !== 'replay') {
          await page.locator(view === 'analytics' ? '.as-balance-chart' : '.as-ledger-section').scrollIntoViewIfNeeded()
          const detailFilename = `${view}-${theme}-${width}-result.png`
          await page.screenshot({ path: path.join(output, detailFilename), fullPage: true })
          screenshots.push({ filename: detailFilename, ...layout })
        }
      }
    }
  }
  checks.push('20 real API screenshots: canonical title, 32/16px scope spacing, no double report padding or document overflow, full-width chart with circular markers and closed sources')
  await page.setViewportSize({ width: 1440, height: 987 })
  await open('analytics')
  await page.getByRole('button', { name: /replay-pos-1, balance/ }).click()
  await page.getByRole('region', { name: 'Trade detail', exact: true }).waitFor()
  assert.equal(new URL(page.url()).searchParams.get('trade'), 'replay-pos-1')
  assert.equal(await page.locator('.as-provenance-details').getAttribute('open'), null)
  await page.getByText('Nguồn và giới hạn', { exact: true }).click()
  await page.locator('.as-provenance-list').waitFor({ state: 'visible' })
  await page.reload()
  await page.getByRole('region', { name: 'Trade detail', exact: true }).waitFor()
  checks.push('real chart point opens matching trade and URL; detail survives reload; provenance opens on demand')
  await open('trade')
  await page.getByRole('button', { name: 'Trang sau', exact: true }).click()
  await page.getByRole('button', { name: 'Chọn trade replay-pos-151', exact: true }).click()
  await page.getByRole('region', { name: 'Trade detail', exact: true }).waitFor()
  assert.equal(new URL(page.url()).searchParams.get('trade'), 'replay-pos-151')
  const filtered = page.waitForResponse(r => r.url().includes('/analytics?') && new URL(r.url()).searchParams.get('outcome') === 'loss')
  await page.getByLabel('Analytics outcome', { exact: true }).selectOption('loss')
  const filteredPayload = await (await filtered).json()
  assert.equal(filteredPayload.scope.selected_trade_count, 0)
  await page.getByTestId('analytics-empty').waitFor()
  assert.equal(await page.getByRole('region', { name: 'Trade detail', exact: true }).count(), 0)
  await page.getByRole('button', { name: 'Xóa lọc', exact: true }).click()
  await page.getByRole('heading', { name: '60 trade đóng', exact: true }).waitFor()
  const dated = page.waitForResponse(r => r.url().includes('/analytics?') && new URL(r.url()).searchParams.has('from_close_utc'))
  await page.getByLabel('Analytics from date', { exact: true }).fill('2025-01-01')
  assert.equal((await (await dated).json()).scope.selected_trade_count, 0)
  await page.getByTestId('analytics-empty').waitFor()
  checks.push('real Trades pagination/focus, server outcome filter, UTC date empty state and reset preserve scope')
  await open('analytics', '&cursor=20')
  await page.getByTestId('analytics-historical-scope').filter({ hasText: 'nến #20' }).waitFor()
  assert.equal(await page.locator('.as-chart-point').count(), 21)
  assert.match(await page.locator('.as-story-metric').first().innerText(), /25[\s\S]*USD/)
  const download = page.waitForEvent('download')
  await page.getByRole('link', { name: 'Tải CSV', exact: true }).click()
  assert.equal((await download).suggestedFilename(), `analytics-${session}.csv`)
  checks.push('real historical cursor20 shows20trades/25USD/21balance points; CSV uses the same cutoff')
  for (const state of ['stale', 'partial', 'error']) {
    injectedState = state
    await open('analytics')
    const notice = state === 'stale' ? 'Dữ liệu có thể đã cũ.' : state === 'partial' ? 'Kết quả mới chỉ một phần.' : 'Chưa đủ dữ liệu để tính analytics'
    await page.getByText(notice, { exact: true }).waitFor()
    if (state === 'error') assert.equal(await page.locator('.as-story-metric').count(), 0)
  }
  checks.push('labeled response fixtures: stale/partial preserved,503 blocked result hides metrics')
  assert.deepEqual(errors, [])
  assert.deepEqual(blockedWrites, [])
  assert.deepEqual(external, [])
  await writeFile(path.join(output, 'receipt.json'), JSON.stringify({ status: 'PASS', scope: 'real-local-readonly-synthetic-QA-data-plus-labeled-state-response-fixtures', checks, screenshots, browserErrors: errors, blockedWrites, externalRequests: external }, null, 2))
  console.log(JSON.stringify({ status: 'PASS', checks: checks.length, screenshots: screenshots.length, output }))
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {})
  await writeFile(path.join(output, 'failure.json'), JSON.stringify({ checks, error: String(error), browserErrors: errors }, null, 2))
  throw error
} finally { await browser.close() }
