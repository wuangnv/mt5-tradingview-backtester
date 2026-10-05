import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const ui = process.env.TW_UI_ORIGIN || 'http://127.0.0.1:5180'
const api = process.env.TW_API_ORIGIN || 'http://127.0.0.1:8010'
for (const origin of [ui, api]) assert.equal(new URL(origin).hostname, '127.0.0.1')
const out = path.resolve(process.env.TW_UI_EVIDENCE || '../../.artifacts/market-sync-20261005/root-browser')
await mkdir(out, { recursive: true })
const headers = { 'X-Workspace-Id': 'tenant-a' }
const read = async route => {
  const response = await fetch(api + route, { headers })
  assert.equal(response.status, 200)
  return response.json()
}
const catalog = await read('/api/v2/data/market-assets')
const live = await read('/api/v2/live/status')
const sessionId = '476f4b498e1a49ed9d48a75719f4d270'
const sessionBefore = await read(`/api/v2/replay/sessions/${sessionId}`)
assert.ok(catalog.items.some(item => item.enabled && item.dataset_id))
assert.equal(live.execution_capability, false)
assert.equal(live.mode, 'demo')
const axe = await readFile('../../../../.artifacts/wm-integration-quality-tools/node_modules/axe-core/axe.min.js', 'utf8')
const browser = await chromium.launch({ headless: true })
const report = { scope: 'actual owner read-only API/SDK snapshots; simulated failures labeled separately; no broker or API writes', checks: [], errors: [], blocked: [] }
const contexts = []
const make = async (width, theme, intercept) => {
  const context = await browser.newContext({ viewport: { width, height: 987 }, reducedMotion: 'reduce' })
  contexts.push(context)
  await context.addInitScript(theme => { localStorage.setItem('tw-theme', theme); localStorage.setItem('tw-language', 'vi') }, theme)
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin !== ui || !['GET', 'HEAD'].includes(request.method())) {
      report.blocked.push({ method: request.method(), path: url.pathname })
      return route.abort()
    }
    if (intercept && url.pathname === '/api/v2/live/status') return intercept(route)
    return route.continue()
  })
  const page = await context.newPage()
  page.on('pageerror', error => report.errors.push(String(error)))
  return page
}
const inspect = async (page, name) => {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${name} page overflow`)
  await page.addScriptTag({ content: axe })
  const violations = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })).violations.map(v => ({ id: v.id, nodes: v.nodes.length })))
  assert.deepEqual(violations, [], `${name} axe`)
  // Private screenshots retain account data locally; do not commit screenshots.
  await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: true })
  report.checks.push(name)
}
try {
  for (const theme of ['dark', 'light']) for (const width of [360, 768, 1440]) {
    const page = await make(width, theme)
    await page.goto(`${ui}/?workspace=tenant-a&view=data`)
    const assets = page.getByTestId('market-assets')
    await assets.locator('tbody tr').first().waitFor()
    assert.equal(await assets.locator('tbody tr').count(), catalog.items.filter(i => i.enabled).length)
    await page.getByLabel('Tìm asset', { exact: true }).fill('XAUUSDm')
    assert.equal(await assets.locator('tbody tr').count(), 1)
    assert.match(await assets.locator('tbody').textContent(), /Metals CFD/)
    const link = new URL(await assets.getByRole('link', { name: 'Luyện tập', exact: true }).getAttribute('href'), ui)
    const gold = catalog.items.find(i => i.symbol === 'XAUUSDm')
    assert.equal(link.searchParams.get('dataset'), gold.dataset_id)
    assert.equal(link.searchParams.has('session'), false)
    assert.equal(link.searchParams.get('fresh'), '1')
    await page.getByLabel('Tìm asset', { exact: true }).fill('')
    await page.getByLabel('Nhóm asset', { exact: true }).selectOption('Metals CFD')
    assert.ok(await assets.locator('tbody tr').count() > 0)
    await page.getByLabel('Nhóm asset', { exact: true }).selectOption('all')
    await page.getByLabel('Hiện toàn bộ danh mục broker', { exact: true }).check()
    assert.equal(await assets.locator('tbody tr').count(), catalog.items.length)
    await inspect(page, `catalog-${theme}-${width}`)
    if (width === 1440 && theme === 'dark') {
      await page.goto(link.href)
      await page.getByTestId('dataset-id').waitFor()
      assert.equal(await page.getByTestId('dataset-id').inputValue(), gold.dataset_id)
      report.checks.push('latest-dataset opens fresh replay form without creating session')
    }
    await page.goto(`${ui}/?workspace=tenant-a&view=live&area=live&section=trades`)
    const broker = page.getByTestId('live-broker-snapshot')
    await broker.waitFor()
    assert.equal(await broker.locator('tbody tr').count(), live.deal_count)
    assert.ok((await broker.textContent()).includes(`${live.cashflows.length} sự kiện khác BUY/SELL`))
    const expected = live.account.balance.toLocaleString('vi-VN', { maximumFractionDigits: 5 })
    assert.ok((await broker.locator('dl').textContent()).includes(expected))
    await page.getByLabel('Tìm deal broker', { exact: true }).fill('no-such-ticket')
    await page.getByTestId('live-deals-empty').waitFor()
    await page.getByLabel('Tìm deal broker', { exact: true }).fill('')
    await inspect(page, `live-trades-${theme}-${width}`)
    await page.goto(`${ui}/?workspace=tenant-a&view=live&area=live&section=trading-accounts`)
    await page.getByTestId('live-broker-snapshot').waitFor()
    await page.getByText(`Vị thế đang mở (${live.positions.length})`, { exact: true }).waitFor()
    await page.getByText(`Lệnh chờ (${live.orders.length})`, { exact: true }).waitFor()
    await inspect(page, `live-account-${theme}-${width}`)
    await page.context().close()
  }
  let mode = 'actual'
  const page = await make(360, 'dark', async route => {
    if (mode === 'network-error') return route.abort()
    if (mode === 'denied') return route.fulfill({ status: 403, json: { detail: 'fixture-denied' } })
    if (mode === 'unavailable') return route.fulfill({ json: { status: 'unavailable', execution_capability: false } })
    return route.continue()
  })
  await page.goto(`${ui}/?workspace=tenant-a&view=live&area=live&section=trades`)
  await page.getByTestId('live-broker-snapshot').waitFor()
  const firstTime = await page.locator('.live-snapshot-time').textContent()
  await page.waitForFunction(previous => document.querySelector('.live-snapshot-time')?.textContent !== previous, firstTime, { timeout: 15000 })
  report.checks.push('actual broker poll refreshes snapshot without user reload')
  mode = 'network-error'
  await page.getByTestId('live-status').filter({ hasText: 'Không đọc được live status' }).waitFor({ timeout: 12000 })
  await page.getByText('Dữ liệu cũ / mất kết nối', { exact: true }).waitFor()
  report.checks.push('simulated network failure retains visibly stale snapshot')
  mode = 'denied'
  await page.getByTestId('live-status').filter({ hasText: 'không có quyền' }).waitFor({ timeout: 12000 })
  assert.equal(await page.getByTestId('live-broker-snapshot').count(), 0)
  report.checks.push('simulated 403 clears account and deals')
  mode = 'unavailable'
  await page.getByTestId('live-status').filter({ hasText: 'chưa được cấu hình' }).waitFor({ timeout: 12000 })
  report.checks.push('simulated unavailable has no account values')
  const after = await read(`/api/v2/replay/sessions/${sessionId}`)
  assert.equal(after.payload.dataset_id, sessionBefore.payload.dataset_id)
  assert.equal(after.revision, sessionBefore.revision)
  assert.equal(after.canonical_cursor_index, 500)
  assert.equal(after.total_row_count, 93810)
  assert.equal(after.dataset_sha256, sessionBefore.dataset_sha256)
  assert.deepEqual(after.visible_rows, sessionBefore.visible_rows)
  report.checks.push('original replay dataset hash, 93810 rows, revision and 501 visible bars unchanged')
  assert.deepEqual(report.errors, [])
  assert.deepEqual(report.blocked, [])
  report.pass = true
} catch (error) {
  report.pass = false
  report.failure = String(error)
  process.exitCode = 1
} finally {
  await browser.close()
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
}
console.log(JSON.stringify({ pass: report.pass, checks: report.checks.length, errors: report.errors, failure: report.failure }))
