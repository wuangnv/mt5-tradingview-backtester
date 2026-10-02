import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const here = path.dirname(fileURLToPath(import.meta.url))
const seedPath = process.env.TW_REPLAY_SEED || path.resolve(here, '../../../../.artifacts/wm-integration-20261001/seed.json')
const seed = JSON.parse(await readFile(seedPath, 'utf8'))
assert.equal(seed.database, 'trading_workspace_v2_ui_20261001', 'this test only writes to the explicitly disposable integration database')
assert.equal(seed.scope, 'synthetic-data-real-API-Postgres-local-UI-only')
const origin = seed.ui
const apiOrigin = seed.api
for (const value of [origin, apiOrigin]) assert.equal(new URL(value).hostname, '127.0.0.1')
const evidence = process.env.TW_REPLAY_EVIDENCE || path.join(path.dirname(seedPath), 'chart-real')
await mkdir(evidence, { recursive: true })
async function api(suffix, body) {
  const response = await fetch(apiOrigin + '/api/v2' + suffix, {
    method: body ? 'POST' : 'GET',
    headers: { 'X-Workspace-Id': 'tenant-a', 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  assert.ok(response.ok, `${suffix}: ${response.status} ${response.ok ? '' : await response.text()}`)
  return response.json()
}
const baseline = await api('/replay/sessions/' + seed.session_id)
const own = await api('/replay/sessions', { dataset_id: seed.dataset_id, start_index: 79 })
const ownId = own.record_id
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
const badResponses = []
const observedViews = []
page.on('pageerror', error => errors.push(String(error)))
page.on('response', async response => {
  if (!response.url().includes('/api/')) return
  if (response.status() >= 400 && response.status() !== 409) badResponses.push({ url: response.url(), status: response.status() })
  if (response.ok() && /\/replay\/sessions\/[^/?]+(?:\?(?:.*))?$/.test(response.url())) {
    const payload = await response.json().catch(() => null)
    if (payload?.visible_rows) observedViews.push(payload)
  }
})
const chart = page.getByTestId('replay-chart')
const count = value => page.waitForFunction(n => document.querySelector('[data-testid="replay-chart"]')?.dataset.visibleRowCount === String(n), value)
const route = id => `${origin}/?view=replay&surface=workspace&workspace=tenant-a&session=${id}`
const checks = []
try {
  await page.goto(route(ownId))
  await count(80)
  await chart.locator('canvas').first().evaluate(node => { node.dataset.instanceProbe = 'same' })
  const box = await chart.boundingBox()
  await page.mouse.move(box.x + box.width * .45, box.y + box.height * .45)
  await page.mouse.wheel(0, -400)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * .7, box.y + box.height * .45, { steps: 15 })
  await page.mouse.up()
  const beforeRange = Number(await chart.getAttribute('data-range-from'))
  await page.getByTestId('step-1').click()
  await count(81)
  assert.equal(await chart.locator('canvas').first().getAttribute('data-instance-probe'), 'same')
  assert.ok(Math.abs(Number(await chart.getAttribute('data-range-from')) - beforeRange) < 1)
  checks.push('real API step preserves chart canvas and historical pan/zoom')
  await chart.click()
  await page.keyboard.press('Shift+ArrowRight')
  await count(91)
  await page.getByRole('button', { name: 'Chi tiết & nhánh', exact: true }).click()
  await page.getByTestId('branch-cursor').focus()
  await page.getByTestId('branch-cursor').press('Home')
  await page.getByTestId('branch-cursor').press('ArrowRight')
  assert.equal((await api('/replay/sessions/' + ownId)).payload.cursor_index, 90)
  await page.getByRole('button', { name: 'Đóng chi tiết', exact: true }).click()
  checks.push('keyboard step works and native range keys do not step replay')
  let canonical = await api('/replay/sessions/' + ownId)
  canonical = await api('/replay/sessions/' + ownId + '/step', { expected_revision: canonical.revision, steps: 1 })
  await page.getByTestId('step-1').click()
  await page.getByTestId('revision-conflict').waitFor()
  assert.equal(await page.getByTestId('step-1').isDisabled(), true)
  assert.equal(await page.getByRole('button', { name: 'Trade draft trong simulator', exact: true }).isDisabled(), true)
  await page.getByRole('button', { name: 'Tải trạng thái mới', exact: true }).click()
  await count(92)
  await page.getByRole('button', { name: 'Lùi một nến', exact: true }).click()
  await count(91)
  await page.getByTestId('replay-history-view').waitFor()
  assert.equal(await page.getByTestId('step-1').isDisabled(), true)
  assert.equal(await page.getByRole('button', { name: 'Trade draft trong simulator', exact: true }).isDisabled(), true)
  await page.reload()
  await count(91)
  checks.push('real revision conflict reload and historical deep link locks mutations')
  await page.getByRole('button', { name: 'Chi tiết & nhánh', exact: true }).click()
  await page.getByTestId('branch-replay').click()
  await page.waitForURL(url => url.searchParams.get('session') !== ownId)
  const branchId = new URL(page.url()).searchParams.get('session')
  await count(91)
  let branch = await api('/replay/sessions/' + branchId)
  assert.equal(branch.payload.parent_session_id, ownId)
  assert.equal(branch.payload.cursor_index, 90)
  assert.equal((await api('/replay/sessions/' + ownId)).revision, canonical.revision)
  await page.reload()
  await count(91)
  checks.push('branch persists parent lineage and cursor while parent stays unchanged')
  const link = page.getByRole('link', { name: 'Trade draft trong simulator', exact: true })
  const href = new URL(await link.getAttribute('href'), origin)
  assert.equal(href.searchParams.get('intent'), 'order')
  assert.equal(href.searchParams.get('session'), branchId)
  assert.equal(href.searchParams.get('cursor'), '90')
  await link.click()
  await page.getByTestId('trade-workspace').waitFor()
  await page.getByRole('heading', { name: 'Trade draft', exact: true }).waitFor()
  checks.push('chart CTA opens simulator order draft with session and cursor scope')
  const screenshots = []
  for (const theme of ['dark', 'light']) {
    await page.evaluate(value => localStorage.setItem('tw-theme', value), theme)
    await page.goto(route(branchId))
    await count(91)
    for (const width of [1440, 768, 360]) {
      await page.setViewportSize({ width, height: 900 })
      await page.getByRole('button', { name: 'Vừa toàn bộ nến đã mở', exact: true }).click()
      const bounds = await chart.boundingBox()
      assert.ok(bounds.width >= width - 100 && bounds.height >= 300)
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 2)
      const filename = `chart-${theme}-${width}.png`
      await page.screenshot({ path: path.join(evidence, filename), fullPage: true })
      screenshots.push({ theme, width, bounds, filename })
    }
  }
  checks.push('real API chart renders both themes at 1440 768 and 360 without page overflow')
  assert.ok(observedViews.length >= 3)
  for (const view of observedViews) {
    assert.equal(view.visible_rows.length, view.view_cursor_index + 1)
    assert.equal(view.visible_rows.at(-1).timestamp, view.cutoff_timestamp)
    assert.ok(view.visible_rows.every((row, i, rows) => row.timestamp <= view.cutoff_timestamp && (!i || row.timestamp > rows[i - 1].timestamp)))
  }
  checks.push('each observed API view is a strictly ordered prefix ending at the advertised cutoff')
  assert.equal((await api('/replay/sessions/' + seed.session_id)).revision, baseline.revision)
  assert.deepEqual(errors, [])
  assert.deepEqual(badResponses, [])
  const receipt = { status: 'PASS', scope: seed.scope, baselineUnchanged: true, ownId, branchId, observedViewCount: observedViews.length, checks, screenshots, errors, badResponses }
  await writeFile(path.join(evidence, 'report.json'), JSON.stringify(receipt, null, 2))
  console.log(JSON.stringify(receipt))
} catch (error) {
  await page.screenshot({ path: path.join(evidence, 'failure.png'), fullPage: true })
  await writeFile(path.join(evidence, 'failure.json'), JSON.stringify({ status: 'FAIL', ownId, checks, errors, badResponses, error: String(error) }, null, 2))
  throw error
} finally { await browser.close() }
