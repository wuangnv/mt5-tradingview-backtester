import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const origin = process.env.TESTING_UI_ORIGIN || 'http://127.0.0.1:5180'
const out = process.env.TW_UI_EVIDENCE_DIR || '../evidence/dashboard-states-20261009'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ headless: true })
const checks = [], errors = [], writes = []
const home = `${origin}/?workspace=tenant-a&area=testing&view=overview`
const performance = (mode) => {
  const empty = mode === 'empty', blocked = mode === 'blocked', noTrades = mode === 'no-trades'
  const count = blocked ? null : empty || noTrades ? 0 : 2
  return { performance: {
    schema_version: 'dashboard-replay-performance-v1', status: blocked || mode === 'partial' ? 'partial' : 'ready',
    scope: { session_count: empty ? 0 : 2, readable_session_count: empty || blocked ? 0 : mode === 'partial' ? 1 : 2 },
    metrics: { closed_trade_count: count, win_rate_pct: count ? 50 : null },
    months: count ? [{ month: '2026-10', closed_trade_count: 2, win_rate_pct: 50 }] : [],
    symbols: count ? [{ symbol: 'EURUSD', closed_trade_count: 2 }] : [],
    sessions: [], sources: [], excluded: [], time_invested_seconds: empty ? null : 600, historical_time_replayed_seconds: empty ? null : 1200,
  } }
}

async function setup(options) {
  const { theme = 'dark', ...browserOptions } = options
  const context = await browser.newContext(browserOptions)
  await context.addInitScript(theme => { localStorage.setItem('tw-language', 'vi'); localStorage.setItem('tw-theme', theme) }, theme)
  await context.route('**/*', route => {
    const request = route.request()
    if (new URL(request.url()).origin !== new URL(origin).origin) return route.abort()
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) { writes.push(request.url()); return route.abort() }
    return route.continue()
  })
  const page = await context.newPage()
  page.setDefaultTimeout(10000)
  page.on('pageerror', error => errors.push(error.message))
  return { context, page }
}

try {
  for (const theme of ['dark', 'light']) {
    const { context, page } = await setup({ theme, viewport: { width: 1440, height: 987 } })
    for (const width of [1440, 360]) {
      await page.setViewportSize({ width, height: 987 })
      await page.goto(`${home}&ui_reference=1#controls`)
      const choices = page.locator('.wm-reference-choices')
      await choices.waitFor()
      const geometry = await choices.locator('label').evaluateAll(labels => labels.map(label => {
        const input = label.querySelector('input'), glyph = input.getBoundingClientRect()
        const text = [...label.childNodes].find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim())
        const range = document.createRange(); range.selectNodeContents(text)
        const caption = range.getBoundingClientRect()
        return { centerX: glyph.x + glyph.width / 2, centerY: glyph.y + glyph.height / 2, textX: caption.x, textY: caption.y + caption.height / 2 }
      }))
      for (const item of geometry) {
        assert.ok(Math.abs(item.centerX - geometry[0].centerX) < 1, 'all glyph centers share one vertical axis')
        assert.ok(Math.abs(item.textX - geometry[0].textX) < 1, 'all captions start on one vertical axis')
        assert.ok(Math.abs(item.centerY - item.textY) <= 1.5, 'glyph center aligns with caption visually')
      }
      await choices.screenshot({ path: `${out}/choices-${theme}-${width}.png` })
      checks.push({ case: 'choice optical alignment', theme, width, geometry, pass: true })
    }
    await context.close()
  }

  // Labeled response fixtures exercise the real Dashboard, without API writes.
  for (const theme of ['dark', 'light']) {
    const { context, page } = await setup({ theme, viewport: { width: 1440, height: 987 } })
    let mode = 'empty', hold = null
    await context.route('**/api/**', async route => {
      const url = new URL(route.request().url())
      if (route.request().method() !== 'GET') { writes.push(url.href); return route.abort() }
      if (url.pathname === '/api/v2/overview') {
        if (hold) await hold.promise
        if (mode === 'error' || mode === 'denied') return route.fulfill({ status: mode === 'denied' ? 403 : 503, json: { detail: 'labeled_state_fixture' } }).catch(() => {})
        if (mode === 'malformed') return route.fulfill({ json: { performance: null } }).catch(() => {})
        return route.fulfill({ json: performance(mode) }).catch(() => {})
      }
      if (url.pathname === '/api/v2/replay/sessions' || url.pathname === '/api/v2/data/datasets') return route.fulfill({ json: { items: [] } })
      if (url.pathname === '/api/v2/prop/reports') return route.fulfill({ status: 503, json: { detail: 'independent_prop_fixture_failure' } })
      return route.fulfill({ status: 404, json: { detail: 'fixture_not_implemented' } })
    })
    const group = page.getByTestId('dashboard-result-group')
    const results = page.locator('.fx-dashboard-results').first()
    const metrics = results.locator('.fx-dashboard-metric > strong')
    const state = expected => page.waitForFunction(expected => document.querySelector('[data-testid="dashboard-result-group"]')?.dataset.state === expected, expected)
    const go = async (query = '') => { await page.goto(home + query); await group.waitFor() }
    for (const value of ['empty', 'blocked', 'error', 'denied', 'malformed']) {
      mode = value
      await go()
      await state({ empty: 'empty', blocked: 'unavailable', error: 'error', denied: 'denied', malformed: 'unavailable' }[value])
      assert.equal(await group.locator('[role=status],[role=alert]').count(), 1, 'one owning status')
      assert.equal(await metrics.count(), 0, 'no placeholder KPIs after group prerequisite fails')
      assert.equal(await results.locator('.fx-dashboard-chart-panel').count(), 0)
      assert.equal(await group.getByRole('button').count(), ['error', 'malformed'].includes(value) ? 1 : 0)
      checks.push({ case: `Dashboard fixture ${value}`, theme, pass: true })
    }
    mode = 'ready'
    await group.getByRole('button', { name: 'Thử lại' }).click()
    await state('ready')
    assert.equal(await metrics.nth(2).innerText(), '2')
    checks.push({ case: 'retry restores group data', theme, pass: true })
    mode = 'no-trades'
    await go()
    await state('no-trades')
    assert.equal(await metrics.nth(2).innerText(), '0')
    assert.equal(await metrics.nth(3).innerText(), '—')
    assert.match(await metrics.nth(0).innerText(), /10/)
    assert.equal(await group.getByRole('status').count(), 1)
    assert.equal(await results.locator('.fx-dashboard-chart-panel').count(), 0)
    await results.screenshot({ path: `${out}/no-trades-${theme}.png` })
    checks.push({ case: 'no trades preserves measured timing and honest zero/unknown', theme, pass: true })
    await go('&dashboard_from=2026-10-01&dashboard_to=2026-10-09')
    await state('no-trades')
    assert.match(await group.getByRole('status').innerText(), /khoảng ngày/)
    mode = 'partial'; await go(); await state('ready')
    assert.match(await page.getByTestId('dashboard-data-state').innerText(), /1\/2/)
    assert.equal(await metrics.nth(2).innerText(), '2')
    checks.push({ case: 'partial shows visible scope notice', theme, pass: true })
    mode = 'ready'; await go(); await state('ready')
    hold = {}; hold.promise = new Promise(resolve => { hold.release = resolve })
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await page.getByTestId('dashboard-data-state').waitFor()
    assert.equal(await results.getAttribute('aria-busy'), 'true')
    assert.equal(await metrics.nth(2).innerText(), '2')
    mode = 'error'; hold.release(); hold = null
    await page.waitForFunction(() => document.querySelector('[data-testid="dashboard-data-state"]')?.textContent.includes('Dữ liệu chưa cập nhật.'))
    assert.equal(await metrics.nth(2).innerText(), '2')
    mode = 'denied'; await page.getByTestId('dashboard-data-state').getByRole('button').click(); await state('denied')
    assert.equal(await metrics.count(), 0, 'revoked permission clears cached data')
    checks.push({ case: 'same scope refresh retains data, stale retry, revoked permission clears', theme, pass: true })
    mode = 'ready'; await go(); await state('ready')
    hold = {}; hold.promise = new Promise(resolve => { hold.release = resolve })
    await page.getByRole('button', { name: 'Khoảng thời gian hiệu suất', exact: true }).click()
    await page.getByRole('option', { name: 'Tuần trước', exact: true }).click()
    await state('loading')
    assert.equal(await metrics.count(), 0, 'scope change never shows old results')
    assert.equal(await group.getByRole('status').count(), 1, 'single skeleton')
    hold.release(); hold = null; await state('ready')
    checks.push({ case: 'scope change clears data during loading', theme, pass: true })
    await go('&dashboard_from=2026-10-09&dashboard_to=2026-10-01'); await state('invalid')
    assert.equal(await results.getAttribute('aria-busy'), 'false')
    assert.equal(await group.getByRole('alert').count(), 1)
    assert.equal(await metrics.count(), 0)
    checks.push({ case: 'invalid date scope has one alert and is not busy', theme, pass: true })
    mode = 'empty'; await go('&dashboard_source=all'); await state('empty')
    const prop = page.getByTestId('prop-analytics')
    await prop.getByRole('alert').waitFor()
    assert.match(await prop.innerText(), /independent_prop_fixture_failure/)
    assert.equal(await prop.getByRole('button', { name: 'Thử lại' }).count(), 1)
    checks.push({ case: 'Prop source stays independent when backtest has no sessions', theme, pass: true })
    for (const width of [1440, 360]) {
      await page.setViewportSize({ width, height: 987 })
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false)
      await page.screenshot({ path: `${out}/empty-dashboard-${theme}-${width}.png`, fullPage: true })
    }
    await context.close()
  }

  // Actual local service read: do not substitute fixtures for this journey.
  const { context, page } = await setup({ viewport: { width: 1440, height: 987 } })
  await page.goto(home)
  const group = page.getByTestId('dashboard-result-group')
  await group.waitFor()
  await page.waitForFunction(() => {
    const group = document.querySelector('[data-testid="dashboard-result-group"]')
    return group && group.dataset.state !== 'loading'
  })
  const response = await page.request.get(`${origin}/api/v2/overview`, { headers: { 'X-Workspace-Id': 'tenant-a' } })
  assert.equal(response.ok(), true)
  const payload = await response.json()
  if (payload.performance.scope.session_count === 0) {
    assert.equal(await group.getAttribute('data-state'), 'empty')
    assert.equal(await group.getByRole('status').count(), 1)
    assert.equal(await page.locator('.fx-dashboard-results').first().locator('.fx-dashboard-metric').count(), 0)
  }
  await page.screenshot({ path: `${out}/actual-dashboard.png`, fullPage: true })
  checks.push({ case: 'actual service read', scope: payload.performance.scope, state: await group.getAttribute('data-state'), pass: true })
  await context.close()
  assert.deepEqual(errors, [])
  assert.deepEqual(writes, [])
  await writeFile(`${out}/report.json`, JSON.stringify({ pass: true, checks, errors, writes }, null, 2))
  console.log(JSON.stringify({ pass: true, checks: checks.length, out }))
} catch (error) {
  await writeFile(`${out}/failure.json`, JSON.stringify({ error: error.message, checks, errors, writes }, null, 2))
  throw error
} finally { await browser.close() }
