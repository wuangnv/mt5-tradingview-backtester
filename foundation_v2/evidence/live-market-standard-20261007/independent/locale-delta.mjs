import assert from 'node:assert/strict'
import { chromium } from '../../../web/node_modules/playwright/index.mjs'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { ready } from './fixtures.mjs'
const out = 'foundation_v2/evidence/live-market-standard-20261007/independent/'
const pin = async () => createHash('sha256').update(await readFile('foundation_v2/web/src/testing-copy.json')).digest('hex')
const report = { scope: 'r6 locale-only delta after r5 frozen 64-case matrix', cases: [], failures: [], errors: [], blocked: [], before: await pin() }
const browser = await chromium.launch({ headless: true, ignoreDefaultArgs: ['--hide-scrollbars'] })
const oneDeal = { ...ready, deals: [ready.deals[0]], deal_count: 1, cashflows: [] }
const oneAsset = { status: 'ready', source: 'Independent QA fixture', items: [{ symbol: 'QA-EURUSD', enabled: true, status: 'ready', dataset_id: 'qa-only-no-practice', metadata: { group: 'Forex', description: 'QA fixture only' }, first_timestamp: 1790812800, last_timestamp: 1791417600, row_count: 1, quality: 'basic' }] }
try {
  for (const [language, theme, width] of [['en', 'light', 1440], ['vi', 'dark', 360]]) for (const section of ['calendar', 'market-data']) {
    const name = `r6-one-${section}-${language}-${theme}-${width}`, context = await browser.newContext({ viewport: { width, height: 987 } }), page = await context.newPage()
    await page.addInitScript(({ language, theme }) => { localStorage.setItem('tw-language', language); localStorage.setItem('tw-theme', theme) }, { language, theme })
    await context.routeWebSocket('**/*', socket => socket.close())
    await context.route('**/*', route => { const req = route.request(), u = new URL(req.url()); if (!['http://127.0.0.1:5180', 'http://127.0.0.1:8010'].includes(u.origin) || !['GET', 'HEAD', 'OPTIONS'].includes(req.method())) { report.blocked.push({ name, method: req.method(), url: req.url() }); return route.abort() } return route.continue() })
    await context.route('**/api/v2/live/status', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(oneDeal) }))
    await context.route('**/api/v2/data/market-assets', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(oneAsset) }))
    page.on('pageerror', error => report.errors.push({ name, error: String(error) }))
    try {
      await page.goto('http://127.0.0.1:5180/?' + new URLSearchParams({ workspace: 'tenant-a', view: section === 'market-data' ? 'market-data' : 'live', area: section === 'market-data' ? 'testing' : 'live', section }))
      await page.waitForLoadState('networkidle')
      if (section === 'calendar') {
        const count = await page.locator('.live-month-total').innerText()
        if (language === 'en') assert.match(count, /Filled deals: 1/)
        else { assert.match(count, /1.*deal/); assert.ok(!count.includes('Filled deals')) }
        const opener = page.getByRole('button', { name: language === 'en' ? 'Add trade' : 'Thêm giao dịch', exact: true })
        await opener.click(); const dialog = page.getByRole('dialog'); await dialog.waitFor()
        assert.equal(await page.locator('.live-dialog-footer button').innerText(), language === 'en' ? 'Close' : 'Đóng')
        assert.ok(await dialog.getByRole('button', { name: language === 'en' ? 'Close' : 'Đóng', exact: true }).count() >= 1)
        await page.screenshot({ path: out + name + '-dialog.png' })
        await page.keyboard.press('Escape'); assert.equal(await page.getByRole('dialog').count(), 0)
        assert.ok(await opener.evaluate(e => e === document.activeElement))
      } else {
        assert.equal(await page.locator('.market-sync-table tbody tr').count(), 1)
        assert.equal(await page.locator('.market-sync-heading>span').innerText(), language === 'en' ? 'Downloaded products: 1' : 'Đã tải 1 sản phẩm')
      }
      await page.screenshot({ path: out + name + '.png' }); report.cases.push({ name, pass: true })
    } catch (error) { report.failures.push({ name, error: String(error) }); await page.screenshot({ path: out + name + '-failure.png' }) }
    finally { await context.close() }
  }
  report.after = await pin(); report.sourceUnchanged = report.before === report.after
  assert.equal(report.failures.length, 0); assert.equal(report.errors.length, 0); assert.equal(report.blocked.length, 0); assert.ok(report.sourceUnchanged); report.pass = true
} catch (error) { report.failure = String(error); process.exitCode = 1 }
finally { await browser.close(); await writeFile(out + 'locale-delta-report.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify({ pass: report.pass, cases: report.cases.length, failures: report.failures, errors: report.errors, blocked: report.blocked, sourceUnchanged: report.sourceUnchanged })) }
