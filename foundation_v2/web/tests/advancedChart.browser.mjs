import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'

const args = Object.fromEntries(process.argv.slice(2).map(arg => { const index = arg.indexOf('='); return [arg.slice(2, index), arg.slice(index + 1)] }))
const ui = args.ui || 'http://127.0.0.1:5180', api = args.api || 'http://127.0.0.1:8020'
const writable = args.disposable === 'true', session = args.session || 'a70ee596383445d29e650175d505639a'
assert.equal(new URL(ui).hostname, '127.0.0.1'); assert.equal(new URL(api).hostname, '127.0.0.1')
assert.ok(!writable || new URL(api).port !== '8020')
const out = args.out || fileURLToPath(new URL('../../../.artifacts/advanced-chart-20261004/actual-readonly', import.meta.url))
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ headless: true }), checks = [], errors = [], requests = []
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
// Instrument only this isolated test browser; product has no debug API/global.
await context.addInitScript(() => {
  document.addEventListener('load', event => {
    if (!event.target.src?.includes('charting_library.standalone.js')) return
    const Original = window.TradingView.widget
    window.TradingView.widget = function (...args) {
      const feed = args[0].datafeed, originalBars = feed.getBars.bind(feed)
      window.__qaHistory = []
      feed.getBars = (info, resolution, period, callback, error) => originalBars(info, resolution, period, (bars, meta) => { window.__qaHistory.push(...bars.map(bar => ({ ...bar }))); callback(bars, meta) }, error)
      const widget = new Original(...args)
      window.__qaWidget = widget
      widget.onChartReady(() => {
        const chart = widget.activeChart(), original = chart.createOrderLine.bind(chart)
        window.__qaLines = []
        chart.createOrderLine = (...params) => { const line = original(...params); if (line) window.__qaLines.push(line); return line }
      })
      return widget
    }
  }, true)
})
let injectStale = false
await context.route('**/api/**', async route => {
  const request = route.request()
  if (!writable) assert.equal(request.method(), 'GET', 'Owner preview is read-only')
  const options = { url: api + new URL(request.url()).pathname + new URL(request.url()).search }
  if (injectStale && request.method() === 'POST' && request.url().endsWith('/orders/protection')) {
    injectStale = false; options.postData = { ...request.postDataJSON(), expected_revision: request.postDataJSON().expected_revision - 1 }
  }
  const response = await route.fetch(options)
  requests.push({ method: request.method(), path: new URL(request.url()).pathname, status: response.status() })
  await route.fulfill({ response })
})
const page = await context.newPage()
page.setDefaultTimeout(15000)
page.on('pageerror', error => errors.push(String(error)))
const url = cursor => `${ui}/?workspace=tenant-a&view=replay&surface=workspace&session=${session}${cursor == null ? '' : '&cursor=' + cursor}`
async function ready() {
  await page.locator('[data-chart-engine="advanced"][data-chart-status="ready"]').waitFor({ timeout: 25000 })
  const native = await (await page.locator('.advanced-chart-host iframe').elementHandle()).contentFrame()
  await native.locator('[data-name="header-toolbar-properties"]').waitFor({ state: 'visible' })
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
}
async function save() { await page.evaluate(() => window.__qaWidget.save(layout => { window.__qaSaved = layout })); await page.waitForFunction(() => window.__qaSaved); return page.evaluate(() => window.__qaSaved) }
try {
  await page.goto(url()); await ready()
  await page.screenshot({ path: out + '/initial.png', fullPage: true })
  const box = await page.getByTestId('replay-chart').boundingBox()
  assert.equal(box.y, 46); assert.ok(box.height > 650)
  const native = await (await page.locator('.advanced-chart-host iframe').elementHandle()).contentFrame()
  assert.ok(native, 'Real local Advanced Charts iframe loaded')
  await writeFile(out + '/native-dom.txt', (await native.locator('body').innerText()).slice(0, 15000))
  await writeFile(out + '/native-controls.json', JSON.stringify(await native.locator('[data-name], [title]').evaluateAll(nodes => nodes.map(node => ({ tag: node.tagName, name: node.getAttribute('data-name'), title: node.getAttribute('title'), text: node.textContent?.slice(0, 40) }))), null, 2))
  const metadata = await page.evaluate(() => ({ symbol: window.__qaWidget.activeChart().symbol(), resolution: window.__qaWidget.activeChart().resolution(), studies: window.__qaWidget.activeChart().getAllStudies() }))
  assert.equal(metadata.symbol, 'EURUSD'); assert.equal(metadata.resolution, '1')
  checks.push('local v23 native iframe, symbol/timeframe, dominant full-bleed chart')
  if (writable) await page.waitForFunction(() => window.__qaWidget.activeChart().getAllShapes().length === 8)
  if (writable) {
    await page.evaluate(() => window.__qaWidget.activeChart().removeAllShapes())
    await page.waitForFunction(() => window.__qaWidget.activeChart().getAllShapes().length === 8)
  }
  const initialShapes = await page.evaluate(() => window.__qaWidget.activeChart().getAllShapes().map(shape => shape.id))
  const plot = await native.locator('[data-name="pane-widget-chart-gui-wrapper"]').first().boundingBox()
  await native.locator('[data-name="linetool-group-trend-line"] [title="Đường Xu hướng"]').click()
  await page.waitForTimeout(200) // Native toolbar commits its selected tool on the next frame.
  await page.mouse.click(plot.x + plot.width * .3, plot.y + plot.height * .35)
  await page.waitForTimeout(500) // Distinct anchor gestures, outside the engine's double-click window.
  await page.mouse.click(plot.x + plot.width * .6, plot.y + plot.height * .6)
  await page.waitForFunction(count => window.__qaWidget.activeChart().getAllShapes().length === count + 1, initialShapes.length)
  await native.locator('[data-name="linetool-group-cursors"] [title="Con trỏ"]').click()
  await page.evaluate(ids => { const chart = window.__qaWidget.activeChart(); for (const shape of chart.getAllShapes()) if (!ids.includes(shape.id)) chart.removeEntity(shape.id) }, initialShapes)
  checks.push('native toolbar and two real pointer clicks create a trend line')
  const count = Number(await page.getByTestId('replay-chart').getAttribute('data-visible-row-count'))
  const cutoff = Number(await page.getByTestId('replay-chart').getAttribute('data-cutoff'))
  await page.evaluate(() => window.__qaWidget.activeChart().executeActionById('insertIndicator'))
  await page.screenshot({ path: out + '/indicators.png' })
  await native.getByRole('textbox').first().fill('RSI')
  await native.getByText('Chỉ số Sức mạnh Tương đối', { exact: false }).first().click()
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => window.__qaWidget.activeChart().getAllStudies().some(study => study.name.includes('Relative Strength') || study.name === 'RSI'))
  checks.push('native indicator dialog adds RSI')
  await page.evaluate(() => window.__qaWidget.activeChart().executeActionById('chartProperties'))
  await page.screenshot({ path: out + '/settings.png' })
  await page.keyboard.press('Escape')
  await page.evaluate(() => window.__qaWidget.activeChart().setChartType(2))
  await page.evaluate(() => window.__qaWidget.activeChart().setResolution('5'))
  await page.waitForFunction(() => window.__qaWidget.activeChart().resolution() === '5')
  assert.equal(Number(await page.getByTestId('replay-chart').getAttribute('data-visible-row-count')), count)
  await page.evaluate(cutoff => { window.__qaShape = window.__qaWidget.activeChart().createMultipointShape([{ time: cutoff - 600, price: 1.1 }, { time: cutoff, price: 1.101 }], { shape: 'trend_line' }) }, cutoff)
  await page.waitForFunction(() => window.__qaWidget.activeChart().getAllShapes().some(shape => shape.id === window.__qaShape))
  await native.getByRole('button', { name: 'Lưu chart', exact: true }).press('Enter')
  await page.getByText('Đã lưu chart trên trình duyệt này.', { exact: true }).waitFor()
  const layout = await save()
  await writeFile(out + '/saved-layout.json', JSON.stringify(layout, null, 2))
  assert.ok(layout.charts.length)
  if (writable) {
    const imported = layout.charts.flatMap(chart => chart.panes).flatMap(pane => pane.sources).filter(source => JSON.stringify(source).includes('QA API'))
    assert.equal(imported.length, 0, 'API annotations never duplicate into native local layouts')
    checks.push('all eight API annotation types preserved as readonly native imports, excluded from native serialization')
  }
  await page.reload(); await ready()
  assert.ok((await page.evaluate(() => window.__qaWidget.activeChart().getAllShapes())).length)
  assert.equal(await page.evaluate(() => window.__qaWidget.activeChart().resolution()), '5')
  checks.push('native drawing, chart type, causal resampling and local save/reload')
  await page.goto(url(20)); await ready()
  assert.equal(Number(await page.getByTestId('replay-chart').getAttribute('data-visible-row-count')), 21)
  assert.equal(await page.evaluate(() => window.__qaWidget.activeChart().getAllShapes().length), 0)
  assert.ok(await page.getByTestId('replay-history-view').count())
  await page.screenshot({ path: out + '/historical.png' })
  checks.push('history rewind rebuilds native cache; later drawings not restored')
  const historicalCutoff = Number(await page.getByTestId('replay-chart').getAttribute('data-cutoff'))
  assert.ok((await page.evaluate(() => window.__qaHistory)).every(bar => bar.time <= historicalCutoff * 1000))
  await page.goto(url()); await ready()
  for (const theme of ['dark', 'light']) {
    await page.evaluate(theme => localStorage.setItem('tw-theme', theme), theme)
    await page.reload(); await ready()
    const currentLayout = await page.evaluate(() => new Promise(resolve => window.__qaWidget.save(resolve)))
    assert.equal(currentLayout.charts[0].chartProperties.paneProperties.background, theme === 'light' ? '#ffffff' : '#0b0d10', 'Restored layout follows shell theme')
    for (const [width, height] of [[1440, 900], [768, 1024], [390, 844]]) {
    await page.setViewportSize({ width, height })
    await page.evaluate(() => document.fonts.ready)
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await page.screenshot({ path: `${out}/${theme}-${width}.png`, fullPage: true })
    }
  }
  checks.push('desktop/tablet/mobile shell has no horizontal overflow')
  if (writable) {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.getByRole('button', { name: 'Lệnh mô phỏng', exact: true }).click()
    const panel = page.getByRole('region', { name: 'Lệnh mô phỏng', exact: true })
    await panel.getByRole('button', { name: 'Khởi tạo simulator', exact: true }).click()
    await panel.getByRole('button', { name: 'Queue lệnh mô phỏng', exact: true }).waitFor()
    await panel.getByLabel('Stop loss', { exact: true }).fill('1.09')
    await panel.getByLabel('Take profit', { exact: true }).fill('1.12')
    await panel.getByRole('button', { name: 'Queue lệnh mô phỏng', exact: true }).click()
    await panel.getByRole('heading', { name: 'Lệnh chờ nến kế tiếp', exact: true }).waitFor()
    await page.getByTestId('step-1').click()
    await panel.getByRole('heading', { name: 'Vị thế đang mở', exact: true }).waitFor()
    await page.waitForFunction(() => window.__qaLines.filter(line => { try { return line.getEditable() } catch { return false } }).length >= 2)
    const getSession = async () => (await (await fetch(`${api}/api/v2/replay/sessions/${session}`, { headers: { 'X-Workspace-Id': 'tenant-a' } })).json())
    const positionFrame = await (await page.locator('.advanced-chart-host iframe').elementHandle()).contentFrame()
    await positionFrame.getByRole('button', { name: 'Vừa lệnh', exact: true }).press('Space')
    const fitted = await page.evaluate(() => window.__qaWidget.activeChart().getVisiblePriceRange())
    const position = (await getSession()).payload.execution.position
    assert.ok(fitted.from < Number(position.stop_loss) && fitted.to > Number(position.take_profit))
    await page.evaluate(() => window.__qaWidget.activeChart().getPanes()[0].getMainSourcePriceScale().setVisiblePriceRange({ from: 1.08, to: 1.13 }))
    const pricePlot = await (await (await page.locator('.advanced-chart-host iframe').elementHandle()).contentFrame()).locator('[data-name="pane-widget-chart-gui-wrapper"]').first().boundingBox()
    const priceRange = await page.evaluate(() => window.__qaWidget.activeChart().getVisiblePriceRange())
    const beforeAmend = await getSession()
    const stop = Number(beforeAmend.payload.execution.position.stop_loss)
    const stopY = pricePlot.y + pricePlot.height * (priceRange.to - stop) / (priceRange.to - priceRange.from)
    await page.screenshot({ path: out + '/position-before-drag.png' })
    await page.mouse.move(pricePlot.x + pricePlot.width - 130, stopY)
    await page.mouse.down(); await page.mouse.move(pricePlot.x + pricePlot.width - 130, stopY - 15, { steps: 8 }); await page.mouse.up()
    await page.waitForFunction(() => document.querySelector('.chart-order-notice')?.textContent.includes('TP/SL đã lưu'))
    const amended = await getSession()
    assert.notEqual(amended.payload.execution.position.stop_loss, beforeAmend.payload.execution.position.stop_loss)
    assert.equal(amended.payload.execution.position.entry_fill, beforeAmend.payload.execution.position.entry_fill)
    assert.equal(amended.payload.execution.balance, beforeAmend.payload.execution.balance)
    assert.equal(amended.payload.execution.ledger.at(-1).kind, 'protection_change')
    await page.screenshot({ path: out + '/position-after-drag.png' })
    checks.push('native SL pointer drag reaches real protection API; entry, balance and ledger oracle verified')
    injectStale = true
    const rangeAfter = await page.evaluate(() => window.__qaWidget.activeChart().getVisiblePriceRange())
    const newStopY = pricePlot.y + pricePlot.height * (rangeAfter.to - Number(amended.payload.execution.position.stop_loss)) / (rangeAfter.to - rangeAfter.from)
    await page.mouse.move(pricePlot.x + pricePlot.width - 130, newStopY)
    await page.mouse.down(); await page.mouse.move(pricePlot.x + pricePlot.width - 130, newStopY - 10, { steps: 8 }); await page.mouse.up()
    await page.getByTestId('revision-conflict').waitFor()
    assert.equal(await page.getByTestId('step-1').isDisabled(), true)
    assert.deepEqual(await getSession(), amended, 'Stale native drag did not change canonical state')
    await page.getByRole('button', { name: 'Tải trạng thái mới', exact: true }).click()
    await page.getByTestId('revision-conflict').waitFor({ state: 'detached' })
    await page.getByTestId('step-1').click()
    await page.waitForFunction(() => document.querySelector('.chart-float-cutoff')?.textContent.trim() === '#62')
    await page.reload(); await ready()
    const restored = await getSession()
    assert.equal(restored.payload.execution.position.stop_loss, amended.payload.execution.position.stop_loss)
    await page.goto(url(61)); await ready()
    assert.equal(await page.getByTestId('step-1').isDisabled(), true)
    const editable = await page.evaluate(() => window.__qaLines.filter(line => { try { return line.getEditable() } catch { return false } }).length)
    assert.equal(editable, 0)
    await page.goto(url()); await ready()
    checks.push('native stale amendment fails closed; reload retains protection; historical lines cannot edit')
    checks.push('real simulator queue and next-bar fill with native entry/TP/SL')
  }
  await context.route('**/charting_library/charting_library.standalone.js', route => route.abort())
  await page.goto(url() + '&chart_engine=advanced')
  await page.getByRole('alert').filter({ hasText: 'Thiếu bộ Advanced Charts local' }).waitFor()
  const fallback = page.getByRole('link', { name: 'Mở chart dự phòng', exact: true })
  assert.equal(new URL(await fallback.getAttribute('href')).searchParams.getAll('chart_engine').join(','), 'lightweight')
  await fallback.click()
  await page.getByTestId('replay-chart').waitFor()
  assert.equal(await page.getByTestId('replay-chart').getAttribute('data-chart-engine'), null)
  checks.push('missing licensed assets produce explicit error and working reversible rollback')
  assert.deepEqual(errors, [])
  await writeFile(out + '/report.json', JSON.stringify({ result: 'PASS', checks, errors, requests }, null, 2))
  console.log(JSON.stringify({ result: 'PASS', checks: checks.length, out }))
} catch (error) {
  for (const [index, frame] of page.frames().entries()) await writeFile(`${out}/failure-frame-${index}.txt`, await frame.locator('body').innerText().catch(() => 'unavailable'))
  await page.screenshot({ path: out + '/failure.png', fullPage: true }).catch(() => {})
  await writeFile(out + '/report.json', JSON.stringify({ result: 'FAIL', error: String(error), checks, errors, requests }, null, 2))
  throw error
} finally { await context.unrouteAll({ behavior: 'ignoreErrors' }); await browser.close() }
