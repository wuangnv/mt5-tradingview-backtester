import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'

const ui = 'http://127.0.0.1:5180', api = 'http://127.0.0.1:8017'
const out = '../evidence/multi-asset-session-20261009/integration'
await mkdir(out, { recursive:true })
const browser = await chromium.launch({ headless:true })
const errors = [], results = []
const headers = { 'X-Workspace-Id':'tenant-a' }
let activePage
try {
  const page = await browser.newPage({ viewport:{ width:1710, height:987 } })
  activePage = page
  page.setDefaultTimeout(15000)
  page.on('pageerror', error => errors.push(error.message))
  // The UI is real. Every API call uses the separate, disposable PostgreSQL service.
  let createdRecord
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url())
    const response = await route.fetch({ url:api + url.pathname + url.search })
    if (url.pathname === '/api/v2/replay/sessions' && route.request().method() === 'POST' && response.status() === 201) createdRecord = await response.json()
    await route.fulfill({ response })
  })
  await page.goto(ui + '/?workspace=tenant-a&view=overview&area=testing&section=dashboard')
  await page.locator('.fx-dashboard-quick-action').first().click()
  await page.locator('.quick-session-fields > label input').first().fill('Disposable multi-asset UI QA')
  const trigger = page.locator('.dataset-asset-select .fx-select-trigger')
  await trigger.click()
  const options = page.locator('.dataset-asset-select [role=option]')
  await options.filter({ hasText:'EURUSD' }).click()
  await options.filter({ hasText:'GBPUSD' }).click()
  assert.equal(await page.locator('.fx-select-tag').count(), 2)
  await page.keyboard.press('Escape')
  const createdPromise = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/v2/replay/sessions')
  await page.locator('.quick-session-submit').click()
  const createdResponse = await createdPromise
  assert.equal(createdResponse.status(), 201)
  let record = createdRecord
  const id = record.record_id, path = '/api/v2/replay/sessions/' + id
  assert.equal(record.payload.dataset_ids.length, 2)
  await page.waitForURL(url => url.searchParams.get('session') === id)
  await page.getByTestId('step-1').waitFor()
  await page.screenshot({ path:out + '/created-1710.png' })
  const read = async () => (await page.request.get(api + path, { headers })).json()
  const marketFrame = () => page.frames().find(frame => frame.url().startsWith('about:srcdoc'))
  const mutate = async (suffix, click) => {
    const responsePromise = page.waitForResponse(response => new URL(response.url()).pathname === path + '/' + suffix && response.request().method() === 'POST')
    await click()
    const response = await responsePromise
    assert.equal(response.status(), 200, await response.text())
    return response.json()
  }
  const chooseAsset = async symbol => {
    await marketFrame().locator('.legacy-symbol').click()
    const button = page.locator('.replay-watchlist').getByRole('button', { name:new RegExp('^' + symbol) })
    const changed = await mutate('asset', () => button.click())
    await page.getByRole('button', { name:'Đóng bảng điều khiển', exact:true }).click()
    await marketFrame().locator('.legacy-symbol').filter({ hasText:symbol }).waitFor()
    return changed
  }
  const placeOrder = async (stop, target) => {
    await page.locator('.legacy-trading-bar .buy').click()
    const modal = page.locator('.legacy-order-modal')
    if (await modal.locator('.legacy-init-details').count()) {
      await modal.locator('summary').click()
      assert.equal(await modal.locator('.chart-order-panel input[type=number]').first().isDisabled(), true)
      const initialize = modal.getByRole('button', { name:'Khởi tạo mô phỏng', exact:true })
      await initialize.click({ trial:true })
      await mutate('execution', () => initialize.click())
    }
    await modal.getByRole('spinbutton', { name:'Khối lượng lệnh', exact:true }).fill('0.1')
    await modal.getByRole('spinbutton', { name:'Cắt lỗ', exact:true }).fill(stop)
    await modal.getByRole('spinbutton', { name:'Chốt lời', exact:true }).fill(target)
    await mutate('orders/market', () => modal.getByRole('button', { name:'Lưu', exact:true }).click())
    await modal.waitFor({ state:'hidden' })
  }
  await placeOrder('1.09','1.11')
  const initial = await read()
  record = await chooseAsset('GBPUSD')
  assert.equal(record.payload.replay_clock_utc, initial.payload.replay_clock_utc)
  assert.deepEqual(record.portfolio_account, initial.portfolio_account)
  await placeOrder('1.19','1.21')
  record = await mutate('step', () => page.getByTestId('step-1').click())
  assert.equal(record.portfolio_account.open_position_count, 2)
  await page.getByRole('button', { name:'Mở danh sách lệnh', exact:true }).click()
  assert.equal(await page.locator('.legacy-position-scroll tbody tr').count(), 2)
  assert.match(await page.locator('.legacy-position-scroll').innerText(), /EURUSD/)
  assert.match(await page.locator('.legacy-position-scroll').innerText(), /GBPUSD/)
  await page.screenshot({ path:out + '/two-positions-1710.png' })
  const opened = await read()
  await page.reload()
  await page.getByTestId('step-1').waitFor()
  record = await read()
  assert.deepEqual(record.portfolio_account, opened.portfolio_account)
  assert.equal(record.payload.dataset_id, opened.payload.dataset_id)
  const amendTarget = async value => {
    await page.getByRole('button', { name:'Lệnh mô phỏng', exact:true }).click()
    const modal = page.locator('.legacy-order-modal')
    await modal.getByRole('spinbutton', { name:'Chốt lời', exact:true }).fill(value)
    await mutate('orders/protection', () => modal.getByRole('button', { name:'Lưu', exact:true }).click())
    await modal.waitFor({ state:'hidden' })
  }
  await amendTarget('1.2017')
  record = await chooseAsset('EURUSD')
  await amendTarget('1.1017')
  record = await mutate('step', () => page.getByTestId('step-1').click())
  assert.equal(record.portfolio_account.open_position_count, 0)
  const expected = 100000 + Object.values(record.payload.asset_states).reduce((sum, state) => sum + Number(state.execution.balance) - 100000, 0)
  assert.equal(Number(record.portfolio_account.balance), expected)
  assert.ok(expected > 100000)
  const analytics = await (await page.request.get(api + path + '/analytics', { headers })).json()
  assert.equal(analytics.ledger.length, 2)
  assert.equal(analytics.scope.total_trade_count, 2)
  await page.getByRole('button', { name:'Mở danh sách lệnh', exact:true }).click()
  await page.getByRole('tab', { name:'Vị thế đã đóng', exact:true }).click()
  assert.equal(await page.locator('.legacy-position-scroll tbody tr').count(), 2)
  for (const [width, theme] of [[1710,'dark'],[1440,'light'],[768,'light'],[360,'dark']]) {
    await page.setViewportSize({ width, height:987 })
    await page.evaluate(theme => localStorage.setItem('tw-theme',theme), theme)
    await page.reload()
    await page.getByTestId('step-1').waitFor()
    assert.equal(await page.getByTestId('fxreplay-shell').getAttribute('data-theme'), theme)
    await page.getByRole('button', { name:'Mở danh sách lệnh', exact:true }).click()
    await page.getByRole('tab', { name:'Vị thế đã đóng', exact:true }).click()
    assert.equal(await page.locator('.legacy-position-scroll tbody tr').count(), 2)
    await page.screenshot({ path:`${out}/history-${width}-${theme}.png` })
  }
  results.push({ label:'Real UI + API + disposable PostgreSQL', created:id, dataset_ids:record.payload.dataset_ids,
    sharedBalance:record.portfolio_account.balance, closedTrades:analytics.ledger.length, pass:true })
  await page.unrouteAll({ behavior:'wait' })
  await page.close()
  assert.deepEqual(errors, [])
} catch (error) {
  if (activePage && !activePage.isClosed()) {
    await activePage.screenshot({ path:out + '/failure.png' })
    if (await activePage.locator('.legacy-order-modal').count()) console.log((await activePage.locator('.legacy-order-modal').innerText()).slice(0,1800))
  }
  throw error
} finally {
  if (activePage && !activePage.isClosed()) await activePage.unrouteAll({ behavior:'ignoreErrors' })
  await browser.close()
  await writeFile(out + '/report.json', JSON.stringify({ results, errors }, null, 2))
}
