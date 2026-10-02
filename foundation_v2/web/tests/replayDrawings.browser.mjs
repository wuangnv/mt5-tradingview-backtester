import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
const here = path.dirname(fileURLToPath(import.meta.url))
const seedPath = process.env.TW_REPLAY_SEED || path.resolve(here, '../../../../../.artifacts/wm-integration-20261001/seed.json')
const seed = JSON.parse(await readFile(seedPath, 'utf8'))
assert.equal(seed.database, 'trading_workspace_v2_ui_20261001')
assert.equal(seed.scope, 'synthetic-data-real-API-Postgres-local-UI-only')
for (const origin of [seed.api, seed.ui]) assert.equal(new URL(origin).hostname, '127.0.0.1')
const out = process.env.TW_REPLAY_EVIDENCE || path.join(path.dirname(seedPath), 'chart-drawings')
await mkdir(out, { recursive: true })
async function api(route, body) {
  const response = await fetch(seed.api + '/api/v2' + route, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-Workspace-Id': 'tenant-a' }, ...(body ? { body: JSON.stringify(body) } : {}) })
  assert.ok(response.ok, `${route}: ${response.status} ${response.ok ? '' : await response.text()}`)
  return response.json()
}
const own = await api('/replay/sessions', { dataset_id: seed.dataset_id, start_index: 79 })
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', cause => errors.push(String(cause)))
const url = `${seed.ui}/?view=replay&surface=workspace&workspace=tenant-a&session=${own.record_id}`
const chart = page.getByTestId('replay-chart')
const tree = page.getByRole('region', { name: 'Đối tượng chart', exact: true })
const objects = page.getByTestId('replay-object')
async function count(n) { await page.waitForFunction(n => document.querySelectorAll('[data-testid="replay-object"]').length === n, n) }
async function paintCount(n) { await page.waitForFunction(n => Number(document.querySelector('[data-testid="replay-chart"]')?.dataset.visibleObjectCount) === n, n) }
const checks = []
const layouts = []
try {
  await page.goto(url)
  await chart.waitFor()
  await page.getByRole('button', { name: 'Vừa toàn bộ nến đã mở', exact: true }).click()
  await page.getByRole('button', { name: 'Mở danh sách đối tượng', exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('.replay-objects')?.textContent.includes('Đang tải đối tượng'))
  const draw = async (tool, pair) => {
    await page.getByRole('button', { name: tool, exact: true }).click()
    const box = await chart.boundingBox()
    for (const [x, y] of pair) await chart.click({ position: { x: Math.floor(box.width * x), y: Math.floor(box.height * y) } })
  }
  const tools = [
    ['horizontal-line', 'Chọn đường giá local', [[.3, .3]]],
    ['trendline', 'Vẽ đường xu hướng', [[.25, .65], [.65, .4]]],
    ['zone', 'Vẽ vùng giá', [[.3, .45], [.55, .6]]],
    ['text', 'Thêm ghi chú chart', [[.6, .25]]],
  ]
  let n = 0
  for (const [type, tool, pair] of tools) {
    if (type === 'text') {
      await page.getByRole('button', { name: tool, exact: true }).click()
      await page.getByRole('textbox', { name: 'Nội dung ghi chú chart', exact: true }).fill('Ghi chú QA tại cutoff')
    }
    await draw(tool, pair)
    await count(++n)
    const row = page.locator(`[data-testid="replay-object"][data-type="${type}"]`)
    await row.getByRole('button', { name: 'Lưu đối tượng', exact: true }).click()
    await page.waitForFunction(type => document.querySelector(`[data-testid="replay-object"][data-type="${type}"]`)?.textContent.includes('Đã lưu'), type)
  }
  checks.push('horizontal line trendline zone and text draw and persist through real API')
  await draw('Đo giá giữa hai mốc', [[.3, .4], [.7, .6]])
  await count(5)
  const measure = page.locator('[data-testid="replay-object"][data-type="measure"]')
  assert.equal(await measure.getByRole('button', { name: 'Lưu đối tượng', exact: true }).count(), 0)
  assert.match(await measure.getByRole('textbox').inputValue(), /nến/)
  await paintCount(5)
  checks.push('measurement shows price change and candle distance as explicitly local tool')
  const saved = (await api('/chart/annotations')).items.filter(record => record.payload.run_id === own.record_id)
  assert.equal(saved.length, 4)
  for (const record of saved) {
    assert.equal(record.payload.cutoff_timestamp, own.cutoff_timestamp)
    assert.ok(record.payload.anchors.every(anchor => anchor.timestamp <= own.cutoff_timestamp && own.visible_rows.some(row => row.timestamp === anchor.timestamp)))
  }
  const zone = page.locator('[data-testid="replay-object"][data-type="zone"]')
  await zone.getByRole('button', { name: 'Ẩn', exact: true }).click()
  await paintCount(4)
  await zone.getByRole('button', { name: 'Khóa', exact: true }).click()
  assert.equal(await zone.getByRole('button', { name: 'Xóa đối tượng', exact: true }).isDisabled(), true)
  assert.equal(await zone.getByRole('textbox').isDisabled(), true)
  await page.screenshot({ path: path.join(out, 'objects-desktop.png'), fullPage: true })
  await page.reload()
  await chart.waitFor()
  await count(4)
  await paintCount(3)
  await page.getByRole('button', { name: 'Mở danh sách đối tượng', exact: true }).click()
  await zone.getByRole('button', { name: 'Hiện', exact: true }).click()
  await zone.getByRole('button', { name: 'Mở khóa', exact: true }).click()
  await paintCount(4)
  checks.push('saved shapes survive reload while unsaved measure clears and visibility lock preferences persist')
  const line = page.locator('[data-testid="replay-object"][data-type="horizontal-line"]')
  await line.getByRole('textbox').fill('Đường giá đã đổi nhãn')
  await line.getByRole('button', { name: 'Đổi nhãn', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('[data-type="horizontal-line"]')?.textContent.includes('r2'))
  const record = (await api('/chart/annotations')).items.find(record => record.payload.run_id === own.record_id && record.payload.annotation_type === 'horizontal-line')
  const revised = await api(`/chart/annotations/${record.record_id}/revisions`, { expected_revision: record.revision, payload: { ...record.payload, label: 'Sửa từ client khác' } })
  await line.getByRole('button', { name: 'Xóa đối tượng', exact: true }).click()
  await tree.getByRole('alert').waitFor()
  assert.match(await tree.getByRole('alert').innerText(), /đã đổi ở nơi khác/)
  await tree.getByRole('button', { name: 'Tải lại đối tượng', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('[data-type="horizontal-line"] input')?.value === 'Sửa từ client khác')
  assert.equal(await tree.getByRole('alert').count(), 0, 'successful object reload clears the stale conflict warning')
  await line.getByRole('button', { name: 'Xóa đối tượng', exact: true }).click()
  await count(3)
  assert.ok(!(await api('/chart/annotations')).items.some(item => item.record_id === revised.record_id))
  checks.push('rename writes revision and stale delete returns conflict then reload permits tombstone deletion')
  const trend = page.locator('[data-testid="replay-object"][data-type="trendline"]')
  const missing = (await api('/chart/annotations')).items.find(record => record.payload.run_id === own.record_id && record.payload.annotation_type === 'trendline')
  await api(`/chart/annotations/${missing.record_id}/delete`, { expected_revision: missing.revision })
  await trend.getByRole('button', { name: 'Xóa đối tượng', exact: true }).click()
  await tree.getByRole('alert').waitFor()
  assert.match(await tree.getByRole('alert').innerText(), /đã bị xóa/)
  await count(3)
  await tree.getByRole('button', { name: 'Tải lại đối tượng', exact: true }).click()
  await count(2)
  assert.equal(await tree.getByRole('alert').count(), 0, 'successful object reload clears the missing-object warning')
  checks.push('external tombstone returns 404 without false success and reload reconciles objects')
  await page.goto(url + '&cursor=78')
  await page.getByTestId('replay-history-view').waitFor()
  await count(0)
  await paintCount(0)
  await page.getByRole('button', { name: 'Về cursor mới nhất', exact: true }).click()
  await count(2)
  await page.getByRole('button', { name: 'Mở danh sách đối tượng', exact: true }).click()
  const watch = page.getByRole('region', { name: 'Danh sách dữ liệu local', exact: true })
  const datasetLink = watch.getByRole('link').first()
  const target = new URL(await datasetLink.getAttribute('href'), seed.ui)
  assert.equal(target.searchParams.has('session'), false)
  assert.equal(target.searchParams.get('fresh'), '1')
  assert.ok((await api('/data/datasets')).items.some(item => item.dataset_id === target.searchParams.get('dataset')))
  checks.push('rewind hides annotations created after cutoff and local catalog selection clears session scope')
  for (const [width, height] of [[1440,900], [768,900], [360,900], [720,450]]) {
    await page.setViewportSize({ width, height })
    await page.locator('.fx-main').evaluate(node => { node.scrollTop = 0 })
    await page.getByRole('button', { name: 'Vừa toàn bộ nến đã mở', exact: true }).click()
    await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="replay-chart"] canvas')].every(node => node.getBoundingClientRect().right <= innerWidth + 1))
    const metrics = await page.evaluate(() => ({ page: document.documentElement.scrollWidth - innerWidth, content: document.querySelector('.fx-content').scrollWidth - document.querySelector('.fx-content').clientWidth, footerBottom: document.querySelector('.chart-bottom-bar').getBoundingClientRect().bottom, detailTop: document.querySelector('.replay-side').getBoundingClientRect().top, chartHeight: document.querySelector('[data-testid="replay-chart"]').getBoundingClientRect().height }))
    assert.ok(metrics.page <= 2 && metrics.content <= 2, JSON.stringify({ width, height, metrics }))
    if (width <= 900) {
      assert.ok(metrics.detailTop >= metrics.footerBottom - 1, `details overlap footer: ${JSON.stringify({ width, height, metrics })}`)
      assert.ok(metrics.chartHeight >= 320 && metrics.chartHeight <= 520, `chart height is unbounded: ${JSON.stringify({ width, height, metrics })}`)
    }
    layouts.push({ width, height, ...metrics })
    await page.locator('.replay-side').evaluate(node => { node.scrollTop = 0 })
    await page.screenshot({ path: path.join(out, `drawings-${width}-${height}.png`), fullPage: true })
    if (width <= 900) {
      await page.getByRole('button', { name: 'Đóng chi tiết', exact: true }).scrollIntoViewIfNeeded()
      await page.screenshot({ path: path.join(out, `details-${width}-${height}.png`), fullPage: true })
    }
  }
  checks.push('mobile and landscape details follow footer without overlap; chart height remains bounded and close control is reachable')
  assert.deepEqual(errors, [])
  await writeFile(path.join(out, 'report.json'), JSON.stringify({ status: 'PASS', scope: seed.scope, ownId: own.record_id, checks, layouts, errors }, null, 2))
  console.log(JSON.stringify({ status: 'PASS', ownId: own.record_id, checks, errors }))
} catch (cause) {
  await page.screenshot({ path: path.join(out, 'failure.png'), fullPage: true })
  await writeFile(path.join(out, 'failure.json'), JSON.stringify({ status: 'FAIL', ownId: own.record_id, checks, errors, error: String(cause) }, null, 2))
  throw cause
} finally { await browser.close() }
