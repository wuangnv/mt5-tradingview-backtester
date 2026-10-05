import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const args = Object.fromEntries(process.argv.slice(2).map(arg => arg.slice(2).split('=')))
assert.ok(args.out && args.csv && args.session)
const rows = (await readFile(args.csv, 'utf8')).trim().split(/\r?\n/).slice(1).map(line => {
  const [timestamp, open, high, low, close, volume] = line.split(',').map(Number)
  return { timestamp, open, high, low, close, volume }
})
const ui = 'http://127.0.0.1:5180', api = 'http://127.0.0.1:8010'
await mkdir(args.out, { recursive: true })
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const errors = [], writes = [], checks = []
await context.addInitScript(() => {
  document.addEventListener('load', event => {
    if (!event.target.src?.includes('charting_library.standalone.js')) return
    const Original = window.TradingView.widget
    window.TradingView.widget = function (...args) {
      const feed = args[0].datafeed, getBars = feed.getBars.bind(feed)
      window.__qaHistory = []
      feed.getBars = (info, resolution, period, callback, error) => getBars(info, resolution, period, (bars, meta) => { window.__qaHistory.push(...bars.map(bar => ({ ...bar }))); callback(bars, meta) }, error)
      const widget = new Original(...args); window.__qaWidget = widget; return widget
    }
  }, true)
})
await context.route('**/api/**', async route => {
  if (route.request().method() !== 'GET') { writes.push(route.request().url()); return route.abort() }
  const url = new URL(route.request().url())
  const response = await route.fetch({ url: api + url.pathname + url.search })
  await route.fulfill({ response })
})
const page = await context.newPage()
page.on('pageerror', error => errors.push(String(error)))
try {
  const response = await context.request.get(`${api}/api/v2/replay/sessions/${args.session}`, { headers: { 'X-Workspace-Id': 'tenant-a' } })
  assert.equal(response.status(), 200)
  const session = await response.json()
  assert.equal(session.visible_rows.length, 501)
  assert.deepEqual(session.visible_rows, rows.slice(0, 501))
  const catalog = await (await context.request.get(`${api}/api/v2/data/datasets`, { headers: { 'X-Workspace-Id': 'tenant-a' } })).json()
  assert.equal(catalog.items.length, 1)
  assert.equal(catalog.items[0].instrument_id, 'EURUSDm')
  assert.equal(catalog.items[0].row_count, rows.length)
  assert.ok(catalog.items[0].source.provider.includes('Exness-MT5Trial14'))
  checks.push('real local API contains only Exness dataset; 501 prefix rows equal exported broker CSV')
  await page.goto(`${ui}/?workspace=tenant-a&view=replay&surface=workspace&session=${args.session}`)
  await page.locator('[data-chart-status="ready"]').waitFor({ timeout: 25000 })
  assert.equal(await page.evaluate(() => window.__qaWidget.activeChart().symbol()), 'EURUSDm')
  const candles = await page.evaluate(() => window.__qaHistory)
  assert.ok(candles.length)
  for (const candle of candles) {
    const row = rows.find(row => row.timestamp * 1000 === candle.time)
    assert.ok(row && candle.time <= rows[500].timestamp * 1000)
    for (const key of ['open', 'high', 'low', 'close', 'volume']) assert.equal(candle[key], row[key])
  }
  await page.screenshot({ path: args.out + '/real-chart.png' })
  checks.push('native Advanced Charts EURUSDm receives exact broker OHLCV with no future candles')
  await page.getByRole('button', { name: 'Chi tiết replay', exact: true }).click()
  const details = page.locator('#replay-context-panel')
  await details.locator('summary').click()
  await details.getByText('review · 82 khoảng gián đoạn', { exact: true }).waitFor()
  await details.getByText('Exness-MT5Trial14 / MT5', { exact: true }).waitFor()
  await details.getByText('60s', { exact: true }).waitFor()
  checks.push('context preserves broker provenance, 60s timeframe and review disposition with 82 gaps')
  await page.frameLocator('.advanced-chart-host iframe').getByRole('link', { name: 'Trở về Sessions', exact: true }).click()
  await page.waitForURL(url => url.searchParams.get('select') === '1')
  await page.locator('.fx-subnav').getByRole('link', { name: 'Dashboard', exact: true }).click()
  await page.locator('.fx-dashboard').waitFor()
  assert.equal(await page.locator('.chart-utility-rail, .chart-floating-toolbar, .chart-trading-bar').count(), 0)
  await page.screenshot({ path: args.out + '/real-dashboard.png' })
  checks.push('real-data chart → Sessions → Dashboard clears chart chrome')
  assert.deepEqual(errors, []); assert.deepEqual(writes, [])
  await writeFile(args.out + '/report.json', JSON.stringify({ result: 'PASS', checks, rows: rows.length, errors, writes }, null, 2))
  console.log(JSON.stringify({ result: 'PASS', checks: checks.length, out: args.out }))
} catch (error) {
  await page.screenshot({ path: args.out + '/failure.png' }).catch(() => {})
  await writeFile(args.out + '/failure.json', JSON.stringify({ error: String(error), errors, writes }, null, 2))
  throw error
} finally { await context.unrouteAll({ behavior: 'ignoreErrors' }); await browser.close() }
