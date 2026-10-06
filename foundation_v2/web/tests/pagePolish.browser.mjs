import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const out = path.resolve(process.env.TW_UI_EVIDENCE_DIR || '../evidence/fx-page-polish-20261006/primary')
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] })
const page = await browser.newPage({ reducedMotion: 'reduce' })
page.setDefaultTimeout(12000)
const errors = [], writes = [], checks = []
page.on('pageerror', error => errors.push(error.message))
let dashboardMode = ''
await page.route('**/api/**', async route => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) { writes.push(route.request().method()); return route.abort() }
  if (dashboardMode && new URL(route.request().url()).pathname === '/api/v2/overview') {
    if (dashboardMode === 'error') return route.fulfill({ status: 503, json: { detail: 'labeled UI fixture' } })
    const response = await route.fetch(), payload = await response.json()
    const blocked = dashboardMode === 'blocked'
    payload.performance.status = blocked ? 'blocked' : 'partial'
    payload.performance.scope.session_count = 6
    payload.performance.scope.readable_session_count = blocked ? 0 : 4
    if (blocked) payload.performance.metrics = { closed_trade_count: null, win_rate_pct: null }
    return route.fulfill({ response, json: payload })
  }
  return route.continue()
})
const go = async (query, theme) => {
  await page.goto(`http://127.0.0.1:5180/?workspace=tenant-a&area=testing&${query}`)
  if (await page.getByTestId('fxreplay-shell').getAttribute('data-theme') !== theme) await page.getByTestId('theme-toggle').click()
}
const appearance = element => {
  const c = getComputedStyle(element), icon = element.querySelector('svg').getBoundingClientRect()
  return { h: element.getBoundingClientRect().height, radius: c.borderRadius, background: c.backgroundColor, color: c.color, font: c.font, padding: c.padding, iconWidth: icon.width, iconHeight: icon.height }
}
try {
  for (const width of [1710, 768, 360]) for (const theme of ['dark', 'light']) {
    await page.setViewportSize({ width, height: 987 })
    dashboardMode = 'partial'
    await go('view=overview&section=dashboard', theme)
    const results = page.locator('.fx-dashboard-results')
    await page.waitForFunction(() => document.querySelector('.fx-dashboard-results')?.getAttribute('aria-description')?.includes('4/6'))
    assert.equal(await page.getByTestId('dashboard-data-state').innerText(), '')
    assert.equal(await page.locator('.fx-dashboard-scope-info, .fx-dashboard-scope-tooltip').count(), 0)
    await results.screenshot({ path: path.join(out, `dashboard-${theme}-${width}.png`) })
    checks.push(`partial scope remains accessible without info icon: ${theme}/${width}`)

    dashboardMode = ''
    await go('view=replay&section=sessions&select=1&session=476f4b498e1a49ed9d48a75719f4d270', theme)
    const empty = page.getByTestId('session-trades-empty')
    await empty.waitFor()
    const top = page.locator('.fxr-session-summary-card .fxs-go-chart'), lower = empty.locator('.fxs-go-chart')
    assert.equal(await top.innerText(), 'Go to chart')
    assert.equal(await lower.innerText(), 'Go to chart')
    assert.deepEqual(await lower.evaluate(appearance), await top.evaluate(appearance))
    assert.equal(await lower.getAttribute('href'), await top.getAttribute('href'))
    const chart = new URL(await lower.getAttribute('href'), page.url())
    assert.equal(chart.searchParams.get('view'), 'replay'); assert.equal(chart.searchParams.has('select'), false)
    await empty.screenshot({ path: path.join(out, `chart-cta-${theme}-${width}.png`) })
    checks.push(`real empty chart CTA matches summary style/route: ${theme}/${width}`)

    await go('view=analytics&section=analytics&select=1&demo=1', theme)
    const tabs = page.getByRole('tablist', { name: 'Phân tích', exact: true })
    await tabs.waitFor()
    const boxes = await tabs.getByRole('tab').evaluateAll(es => es.map(e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } }))
    assert.equal(boxes.length, 3)
    for (const box of boxes) { assert.ok(Math.abs(box.width - boxes[0].width) < 1); assert.equal(box.y, boxes[0].y); assert.equal(box.height, boxes[0].height); assert.ok(box.x + box.width <= width) }
    const layout = await tabs.evaluate(e => { const c = getComputedStyle(e); return { top: c.paddingTop, bottom: c.paddingBottom, background: c.backgroundColor } })
    assert.equal(layout.top, layout.bottom); assert.equal(layout.background, 'rgba(0, 0, 0, 0)')
    const spacing = await tabs.evaluate(e => {
      const band = e.getBoundingClientRect(), row = e.firstElementChild.getBoundingClientRect(), filters = e.previousElementSibling.getBoundingClientRect()
      return { above: row.top - filters.bottom, below: band.bottom - row.bottom }
    })
    assert.equal(spacing.above, spacing.below)
    await tabs.getByRole('tab', { name: 'Performance', exact: true }).focus()
    await page.keyboard.press('ArrowRight')
    assert.equal(await tabs.getByRole('tab', { name: 'Drawdown', exact: true }).getAttribute('aria-selected'), 'true')
    await page.keyboard.press('End')
    assert.equal(await tabs.getByRole('tab', { name: 'Simulation', exact: true }).getAttribute('aria-selected'), 'true')
    await page.keyboard.press('Home')
    assert.equal(await tabs.getByRole('tab', { name: 'Performance', exact: true }).getAttribute('aria-selected'), 'true')
    await page.locator('.fx-content').screenshot({ path: path.join(out, `analytics-${theme}-${width}.png`) })
    checks.push(`analytics equal tabs, flat band, keyboard: ${theme}/${width}`)
  }
  for (const mode of ['blocked', 'error']) {
    dashboardMode = mode
    await go('view=overview&section=dashboard', 'dark')
    await page.getByText(mode === 'blocked' ? 'Chưa đủ dữ liệu thực thi để tính Performance.' : 'Chưa tải được Performance.', { exact: true }).waitFor()
    assert.equal(await page.locator('.fx-dashboard-scope-info').count(), 0)
    assert.equal(await page.locator('.fx-dashboard-metric strong').nth(2).innerText(), '—')
    checks.push(`labeled ${mode} fixture preserves explicit notice and unknown value`)
  }
  assert.deepEqual(errors, []); assert.deepEqual(writes, [])
  await writeFile(path.join(out, 'report.json'), JSON.stringify({ checks, errors, writes }, null, 2))
  console.log(JSON.stringify({ passed: checks.length, errors, writes }))
} finally { await browser.close() }
