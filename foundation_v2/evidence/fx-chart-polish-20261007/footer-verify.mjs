import assert from 'node:assert/strict'
import { chromium } from '../../web/node_modules/playwright/index.mjs'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
const session = '476f4b498e1a49ed9d48a75719f4d270', out = new URL('./', import.meta.url)
const url = `http://127.0.0.1:5180/?workspace=tenant-a&view=replay&session=${session}&dataset=dataset-262639d819219431b8bbfd00a665d4fb7fde4c646a4fa0c5020608c1e1c3572d&mode=Practice&surface=workspace&cursor=500`
const report = { scope: 'Actual local GET plus labeled execution fixture; activity intercepted; all execution mutations blocked', cases: [], errors: [], writes: [] }
const browser = await chromium.launch({ headless: true })
try {
  for (const [width, theme, language, fixture] of [[1920, 'dark', 'vi', false], [1611, 'dark', 'en', true], [360, 'light', 'en', false]]) {
    const context = await browser.newContext({ viewport: { width, height: 940 } })
    await context.addInitScript(({ theme, language }) => { localStorage.setItem('tw-theme', theme); localStorage.setItem('tw-language', language) }, { theme, language })
    await context.routeWebSocket('**/*', socket => socket.close())
    await context.route('**/*', async route => {
      const request = route.request(), parsed = new URL(request.url())
      if (request.method() === 'POST' && parsed.pathname.endsWith('/activity')) return route.fulfill({ status: 200, json: { schema_version: 'replay-activity-v1', event_id: request.postDataJSON().event_id, session_id: session, accepted_seconds: 0 } })
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) { report.writes.push(request.url()); return route.abort() }
      if (!['http://127.0.0.1:5180', 'http://127.0.0.1:8010'].includes(parsed.origin)) return route.abort()
      if (fixture && parsed.pathname === `/api/v2/replay/sessions/${session}`) {
        const response = await route.fetch(), value = await response.json()
        value.historical_view = false; value.canonical_cursor_index = 500
        value.payload.cursor_index = 500
        value.payload.execution = { cursor_index: 500, balance: '9500', starting_balance: '10000', equity: '9490', floating_pl: '-10', spread_price: '0.0002', timeframe_seconds: 60, ledger: [], cost_model: { account_ccy: 'USD', commission_per_side_account: 0 }, instrument_spec: { tick_size: '0.00001', pip_size: '0.0001', quantity_min: '0.01', quantity_step: '0.01', quantity_max: '100', asset_class: 'fx', contract_size: 100000 } }
        return route.fulfill({ response, json: value })
      }
      return route.continue()
    })
    const page = await context.newPage(); page.on('pageerror', error => report.errors.push(String(error)))
    await page.goto(url); await page.locator('[data-chart-status=ready]').waitFor({ timeout: 30000 })
    const bar = page.locator('.legacy-trading-bar'), geometry = await bar.evaluate(node => ({ rect: node.getBoundingClientRect().toJSON(), buy: getComputedStyle(node.querySelector('.buy')).color, sell: getComputedStyle(node.querySelector('.sell')).color, quantityBorder: getComputedStyle(node.querySelector('.legacy-quantity-control')).borderTopWidth, inputBorder: getComputedStyle(node.querySelector('.legacy-quantity-control input')).borderTopWidth, overflow: document.documentElement.scrollWidth - innerWidth }))
    assert.equal(geometry.buy, 'rgb(255, 255, 255)'); assert.equal(geometry.sell, 'rgb(255, 255, 255)')
    assert.equal(geometry.quantityBorder, '1px'); assert.equal(geometry.inputBorder, '0px'); assert.equal(geometry.overflow, 0)
    const analytics = new URL(await bar.locator('.legacy-analytics-link').getAttribute('href'), url)
    assert.equal(analytics.searchParams.get('view'), 'analytics'); assert.equal(analytics.searchParams.get('session'), session)
    await bar.locator('.legacy-balance-pill').hover(); await page.locator('.legacy-account-details').waitFor()
    const balance = await page.locator('.legacy-account-details').innerText()
    if (fixture) { assert.match(balance, /9,490/); assert.match(balance, /500/); assert.match(balance, /10/) }
    else assert.equal(await page.locator('.legacy-account-details dd').allTextContents().then(rows => rows.every(value => value === '—')), true)
    await page.locator('.legacy-account-details').press('Escape')
    await bar.locator('.legacy-positions-grip').focus(); await bar.locator('.legacy-positions-grip').press('ArrowUp')
    await page.locator('.legacy-resizable-positions').waitFor()
    const firstHeight = await page.locator('.legacy-resizable-positions').evaluate(e => e.clientHeight)
    await bar.locator('.legacy-positions-grip').press('ArrowUp')
    assert.ok(await page.locator('.legacy-resizable-positions').evaluate(e => e.clientHeight) > firstHeight)
    await bar.locator('.chart-trading-account > button').last().click()
    assert.ok(await page.locator('.legacy-trading-workspace.is-maximized').count())
    assert.equal(await page.evaluate(() => Boolean(document.fullscreenElement)), false)
    const max = await page.locator('.legacy-trading-workspace.is-maximized').boundingBox()
    assert.ok(max.y >= 38 && max.y <= 46)
    await page.screenshot({ path: fileURLToPath(new URL(`footer-positions-${width}-${theme}.png`, out)) })
    await bar.locator('.chart-trading-account > button').last().click()
    await bar.locator('.legacy-scalper-button').click(); await page.locator('.legacy-scalper-settings').waitFor()
    assert.equal(await page.locator('.legacy-scalper-settings input[role=switch]:disabled').count(), 1)
    assert.equal(await page.locator('.legacy-scalper-distance input:disabled').count(), 2)
    assert.equal(await page.locator('.legacy-scalper-units').count(), 2)
    if (fixture) {
      await page.locator('.legacy-scalper-settings fieldset input[role=switch]').first().check()
      await page.locator('.legacy-scalper-settings fieldset input[role=switch]').last().check()
      await page.locator('.legacy-scalper-settings input[type=number]').first().fill('30')
      await page.locator('.legacy-scalper-settings button[type=submit]').click()
      assert.ok(await bar.locator('.legacy-scalper-button.is-enabled').count())
      await page.reload(); await page.locator('[data-chart-status=ready]').waitFor()
      assert.ok(await bar.locator('.legacy-scalper-button.is-enabled').count())
      await bar.locator('.legacy-quantity-control button').first().click(); assert.equal(await bar.locator('.legacy-quantity-control input').inputValue(), '0.02')
      await bar.locator('.buy').click(); await page.getByRole('dialog').waitFor()
      const stop = Number(await page.getByRole('dialog').getByRole('spinbutton', { name: 'Stop loss', exact: true }).inputValue())
      const entry = Number(await page.getByRole('dialog').getByRole('textbox').first().inputValue())
      assert.ok(Math.abs(entry - stop - 0.003) < 0.000011)
      await page.getByRole('dialog').locator('header > button').last().click()
    } else {
      await page.screenshot({ path: fileURLToPath(new URL(`footer-scalper-${width}-${theme}.png`, out)) })
      await page.locator('.legacy-scalper-settings footer button').first().click()
    }
    report.cases.push({ width, theme, language, fixture, geometry, balance, pass: true })
    await context.close()
  }
  assert.deepEqual(report.errors, []); assert.deepEqual(report.writes, []); report.pass = true
} catch (failure) { report.pass = false; report.failure = String(failure); throw failure }
finally { await writeFile(new URL('footer-report.json', out), JSON.stringify(report, null, 2)); await browser.close(); console.log(JSON.stringify({ pass: report.pass, cases: report.cases.length, failure: report.failure })) }
