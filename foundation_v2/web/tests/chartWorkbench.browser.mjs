import assert from 'node:assert/strict'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const workspaceRoot = path.resolve(root, '../..')
const args = Object.fromEntries(process.argv.slice(2).map(arg => { const split = arg.indexOf('='); return [arg.slice(2, split), arg.slice(split + 1)] }))
const ui = args.ui || 'http://127.0.0.1:5180'
const api = args.api || 'http://127.0.0.1:8020'
const writable = args.disposable === 'true'
assert.equal(new URL(ui).hostname, '127.0.0.1')
assert.equal(new URL(api).hostname, '127.0.0.1')
assert.ok(!writable || new URL(api).port !== '8020', 'Never write to the owner preview')
const session = args.session || 'a70ee596383445d29e650175d505639a'
const out = args.out || path.join(workspaceRoot, '.artifacts/chart-workbench-20261004', writable ? 'integration' : 'actual-readonly')
await mkdir(out, { recursive: true })
const errors = [], requests = [], checks = [], layouts = []
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
let injectStale = false
await context.route('**/api/**', async route => {
  const request = route.request()
  assert.equal(new URL(request.url()).origin, ui)
  if (!writable) assert.equal(request.method(), 'GET', 'Actual preview must remain read-only')
  const options = { url: api + new URL(request.url()).pathname + new URL(request.url()).search }
  if (injectStale && request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/orders/protection')) {
    injectStale = false
    const body = request.postDataJSON()
    options.postData = { ...body, expected_revision: body.expected_revision - 1 }
  }
  const response = await route.fetch(options)
  requests.push({ method: request.method(), path: new URL(request.url()).pathname, status: response.status() })
  await route.fulfill({ response })
})
const page = await context.newPage()
page.setDefaultTimeout(12000)
page.on('pageerror', error => errors.push(String(error)))
const url = cursor => `${ui}/?workspace=tenant-a&view=replay&surface=workspace&chart_engine=lightweight&session=${session}${cursor == null ? '' : '&cursor=' + cursor}`
const chart = page.getByTestId('replay-chart')
const panel = page.getByRole('region', { name: 'Lệnh mô phỏng', exact: true })
const replayToolbar = page.getByRole('group', { name: 'Replay', exact: true })
async function apiGet() {
  const response = await fetch(`${api}/api/v2/replay/sessions/${session}`, { headers: { 'X-Workspace-Id': 'tenant-a' } })
  assert.equal(response.status, 200)
  return response.json()
}
async function ready() { await chart.waitFor(); await page.waitForFunction(() => document.querySelector('.chart-command-row')); await page.evaluate(() => document.fonts.ready) }
async function settleRevision(revision) { await page.waitForFunction(revision => document.querySelector('.chart-order-notice')?.textContent.includes('TP/SL đã lưu') || document.querySelector('.chart-order-notice')?.textContent.includes('fill ở giá mở'), revision); assert.ok((await apiGet()).revision > revision) }
try {
  await page.goto(url()); await ready()
  const first = await chart.boundingBox()
  assert.equal(first.y, 46, 'No redundant context or toolbar rows above the chart')
  assert.ok(first.height > 700)
  checks.push('one-row header and dominant chart, no duplicate command strip')
  const handle = replayToolbar.getByRole('button', { name: 'Di chuyển Replay', exact: true })
  const before = await replayToolbar.boundingBox()
  await handle.focus(); await page.keyboard.press('ArrowDown')
  assert.ok((await replayToolbar.boundingBox()).y > before.y)
  const dragged = await replayToolbar.boundingBox()
  await replayToolbar.getByRole('button', { name: 'Ghim Replay', exact: true }).click()
  assert.equal(await handle.isDisabled(), true)
  await replayToolbar.getByRole('button', { name: 'Thu gọn Replay', exact: true }).click()
  assert.equal(await page.getByTestId('play-toggle').count(), 0)
  await page.reload(); await ready()
  assert.equal(await replayToolbar.getByRole('button', { name: 'Ghim Replay', exact: true }).getAttribute('aria-pressed'), 'true')
  await replayToolbar.getByRole('button', { name: 'Mở Replay', exact: true }).click()
  assert.ok(Math.abs((await replayToolbar.boundingBox()).y - dragged.y) < 2)
  await replayToolbar.getByRole('button', { name: 'Ghim Replay', exact: true }).click()
  checks.push('floating toolbar keyboard move, pin, collapse and reload persistence')
  await page.getByRole('button', { name: 'Indicators', exact: true }).click()
  await page.getByRole('checkbox', { name: 'SMA 20', exact: true }).check()
  await page.getByRole('checkbox', { name: 'Volume', exact: true }).uncheck()
  await page.keyboard.press('Escape')
  assert.equal(await page.getByRole('button', { name: 'Indicators', exact: true }).getAttribute('aria-expanded'), 'false')
  // Five renderer types share the same causal prefix.
  const rows = Number(await chart.getAttribute('data-visible-row-count'))
  for (const type of ['line', 'area', 'bars', 'baseline', 'candles']) {
    await page.getByRole('combobox', { name: 'Kiểu chart', exact: true }).selectOption(type)
    assert.equal(Number(await chart.getAttribute('data-visible-row-count')), rows)
    assert.ok(await chart.locator('canvas').count() > 0)
  }
  checks.push('indicators and five renderer types preserve candle cutoff')
  await page.getByRole('button', { name: 'Lệnh mô phỏng', exact: true }).click()
  if (writable) {
    await panel.getByRole('button', { name: 'Khởi tạo simulator', exact: true }).click()
    await panel.getByRole('button', { name: 'Queue lệnh mô phỏng', exact: true }).waitFor()
    await panel.getByRole('textbox').count() // All prices are native spinbuttons, no text fallbacks.
    await panel.getByRole('spinbutton', { name: 'Khối lượng lệnh', exact: true }).fill('0.1')
    await panel.getByRole('spinbutton', { name: 'Stop loss', exact: true }).fill('1.085')
    await panel.getByRole('spinbutton', { name: 'Take profit', exact: true }).fill('1.12')
    const preQueue = await apiGet()
    await panel.getByRole('button', { name: 'Queue lệnh mô phỏng', exact: true }).click()
    await settleRevision(preQueue.revision)
    assert.ok((await apiGet()).payload.execution.pending_market_order)
    await page.getByTestId('step-1').click()
    await panel.getByRole('heading', { name: 'Vị thế đang mở', exact: true }).waitFor()
    const beforeAmend = await apiGet()
    assert.ok(beforeAmend.payload.execution.position)
    const stopHandle = page.getByRole('button', { name: 'Kéo Stop loss', exact: true })
    await stopHandle.waitFor({ state: 'visible' })
    const stopBox = await stopHandle.boundingBox()
    await page.mouse.move(stopBox.x + stopBox.width / 2, stopBox.y + stopBox.height / 2)
    await page.mouse.down(); await page.mouse.move(stopBox.x + stopBox.width / 2, stopBox.y - 25, { steps: 6 }); await page.mouse.up()
    await settleRevision(beforeAmend.revision)
    const amended = await apiGet()
    assert.notEqual(amended.payload.execution.position.stop_loss, beforeAmend.payload.execution.position.stop_loss)
    assert.equal(amended.payload.execution.position.entry_fill, beforeAmend.payload.execution.position.entry_fill)
    assert.equal(amended.payload.execution.balance, beforeAmend.payload.execution.balance)
    assert.equal(amended.payload.execution.ledger.at(-1).kind, 'protection_change')
    await stopHandle.focus(); await page.keyboard.press('ArrowUp')
    await page.waitForFunction(() => !document.querySelector('.chart-order-panel button[type="submit"]')?.disabled)
    const afterKey = await apiGet()
    assert.equal(Number(afterKey.payload.execution.position.stop_loss), Number(amended.payload.execution.position.stop_loss) + .0001)
    injectStale = true
    await stopHandle.focus(); await page.keyboard.press('ArrowUp')
    await page.getByTestId('revision-conflict').waitFor()
    assert.equal(await page.getByTestId('step-1').isDisabled(), true)
    assert.equal(await stopHandle.isDisabled(), true)
    assert.deepEqual(await apiGet(), afterKey, 'Stale amendment did not mutate the canonical state')
    await page.getByRole('button', { name: 'Tải trạng thái mới', exact: true }).click()
    await page.getByTestId('revision-conflict').waitFor({ state: 'detached' })
    await page.waitForFunction(() => !document.querySelector('.chart-order-panel button[type="submit"]')?.disabled)
    checks.push('real API stale revision response locks controls; refresh reconciles without lost state')
    await page.screenshot({ path: path.join(out, 'position-desktop.png') })
    await page.getByTestId('step-1').click()
    await page.waitForFunction(() => document.querySelector('.chart-float-cutoff')?.textContent.trim() === '#62')
    await page.reload(); await ready()
    await page.getByRole('button', { name: 'Lệnh mô phỏng', exact: true }).click()
    assert.equal(await panel.getByRole('spinbutton', { name: 'Stop loss', exact: true }).inputValue(), afterKey.payload.execution.position.stop_loss)
    checks.push('real disposable API/Postgres: initialize, queue, next-bar fill, pointer and keyboard amend, ledger/money oracle, reload')
    await page.goto(url(61)); await ready(); await page.getByRole('button', { name: 'Lệnh mô phỏng', exact: true }).click()
    assert.equal(await page.getByTestId('step-1').isDisabled(), true)
    assert.equal(await page.getByRole('button', { name: 'Kéo Stop loss', exact: true }).isDisabled(), true)
    const readAt61 = await (await fetch(`${api}/api/v2/replay/sessions/${session}?cursor_index=61`, { headers: { 'X-Workspace-Id': 'tenant-a' } })).json()
    assert.equal(readAt61.payload.execution.position.stop_loss, afterKey.payload.execution.position.stop_loss)
    assert.equal(readAt61.payload.execution.cursor_index, 61)
    checks.push('historical checkpoint preserves amendment, locks trade/step controls, no future account state')
  } else {
    await page.goto(url(20)); await ready(); await page.getByRole('button', { name: 'Lệnh mô phỏng', exact: true }).click()
    assert.equal(await page.getByTestId('step-1').isDisabled(), true)
    assert.equal(await page.locator('.chart-order-level').count(), 0)
    assert.ok(!await panel.innerText().then(text => text.includes('100.075')))
    checks.push('actual older read-only API: mismatched historical execution suppressed, future money and position not displayed')
  }
  await page.goto(url()); await ready()
  for (const theme of ['dark', 'light']) {
    await page.evaluate(theme => { localStorage.setItem('tw-theme', theme) }, theme)
    await page.reload(); await ready()
    for (const width of [1910, 1440, 768, 360]) {
      await page.setViewportSize({ width, height: width === 768 ? 1024 : 912 })
      await page.waitForTimeout(180)
      const geometry = await page.evaluate(() => {
        const shape = node => { const rect = node.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height } }
        return { overflow: document.documentElement.scrollWidth > innerWidth, chart: shape(document.querySelector('[data-testid="replay-chart"]')), bars: [...document.querySelectorAll('.chart-floating-toolbar')].map(shape) }
      })
      assert.equal(geometry.overflow, false, `${theme} ${width}: horizontal overflow`)
      assert.ok(geometry.chart.width > 160 && geometry.chart.height > 300)
      const [drawingBar, replayBar] = geometry.bars
      assert.ok(drawingBar.x + drawingBar.width <= replayBar.x || replayBar.x + replayBar.width <= drawingBar.x || drawingBar.y + drawingBar.height <= replayBar.y || replayBar.y + replayBar.height <= drawingBar.y, 'default floating bars do not overlap')
      await page.screenshot({ path: path.join(out, `${theme}-${width}.png`) })
      await page.getByRole('button', { name: 'Lệnh mô phỏng', exact: true }).click()
      const dockBox = await page.locator('.replay-side').boundingBox()
      assert.ok(dockBox.x >= 0 && dockBox.x + dockBox.width <= width + 1)
      await page.screenshot({ path: path.join(out, `${theme}-${width}-dock.png`) })
      await page.getByRole('button', { name: 'Đóng panel', exact: true }).click()
      layouts.push({ theme, width, ...geometry })
    }
  }
  assert.deepEqual(errors, [])
  checks.push('eight light/dark viewport cases, rails/dock/canvas geometry, no overflow or console errors')
  await writeFile(path.join(out, 'receipt.json'), JSON.stringify({ scope: writable ? 'disposable database real local services, synthetic mixed OHLC' : 'actual GET-only owner preview', checks, layouts, requests, errors }, null, 2))
  console.log(JSON.stringify({ passed: checks.length, scope: writable ? 'real-disposable' : 'actual-readonly', out }))
} catch (error) {
  await writeFile(path.join(out, 'failure.txt'), String(error.stack || error))
  await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {})
  throw error
} finally { await context.unrouteAll({ behavior: 'ignoreErrors' }); await browser.close() }
