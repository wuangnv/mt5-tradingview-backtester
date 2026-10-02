import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { chromium } from 'playwright'
const here = path.dirname(fileURLToPath(import.meta.url))
const evidence = process.env.TW_REPLAY_EVIDENCE_DIR || path.resolve(here, '../../../../.artifacts/wmreplay-chart-integration-20261001')
const origin = process.env.TW_REPLAY_UI_ORIGIN || 'http://127.0.0.1:5180'
await mkdir(evidence, { recursive: true })
const rows = Array.from({ length: 200 }, (_, i) => ({ timestamp: 1710000000 + i * 60, open: 1.08 + i * .0001, high: 1.0806 + i * .0001, low: 1.0797 + i * .0001, close: 1.0803 + i * .0001, volume: 100 + i }))
const sessions = new Map([['replay-integration', { cursor: 79, revision: 1, parent: null }]])
let forceConflict = false
let failedRead = false
let empty = false
const reads = []
const payload = (id, at = null) => {
  const state = sessions.get(id)
  const cursor = at ?? state.cursor
  return { record_id: id, revision: state.revision, payload: { dataset_id: 'synthetic-chart-qa', instrument_id: 'EURUSD', timeframe: 'M1', cursor_index: state.cursor, branch_id: 'branch-' + id, parent_session_id: state.parent, status: state.cursor === 199 ? 'completed' : 'paused' }, visible_rows: rows.slice(0, cursor + 1), view_cursor_index: cursor, canonical_cursor_index: state.cursor, historical_view: cursor !== state.cursor, visible_row_count: cursor + 1, total_row_count: 200, cutoff_timestamp: rows[cursor].timestamp, has_future_rows: cursor < 199, dataset_sha256: 'synthetic-chart-qa-sha' }
}
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', error => errors.push(String(error)))
await page.route('**/api/**', async route => {
  const url = new URL(route.request().url())
  const parts = url.pathname.split('/').filter(Boolean)
  const reply = (status, value) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) })
  if (url.pathname === '/api/v2/chart/annotations') return reply(200, { items: [] })
  if (url.pathname === '/api/v2/data/datasets') return reply(200, { items: empty ? [] : [{ dataset_id: 'synthetic-chart-qa', instrument_id: 'EURUSD', timeframe: 'M1', quality_status: 'synthetic', row_count: rows.length }] })
  if (url.pathname === '/api/v2/replay/sessions' && route.request().method() === 'POST') {
    sessions.set('created-integration', { cursor: 0, revision: 1, parent: null })
    return reply(201, payload('created-integration'))
  }
  if (parts[2] === 'replay' && parts[3] === 'sessions') {
    const id = parts[4]
    if (!sessions.has(id)) return reply(404, { detail: 'not_found' })
    if (route.request().method() === 'GET') {
      reads.push(url.search)
      if (failedRead) return reply(503, { detail: 'qa_unavailable' })
      return reply(200, payload(id, url.searchParams.has('cursor_index') ? Number(url.searchParams.get('cursor_index')) : null))
    }
    const state = sessions.get(id)
    const body = route.request().postDataJSON()
    if (forceConflict) { forceConflict = false; state.revision += 1; return reply(409, { detail: 'revision_conflict' }) }
    assert.equal(body.expected_revision, state.revision)
    if (parts[5] === 'step') { state.cursor = Math.min(199, state.cursor + body.steps); state.revision += 1; return reply(200, payload(id)) }
    if (parts[5] === 'branch') { sessions.set('branched-integration', { cursor: body.cursor_index, revision: 1, parent: id }); return reply(201, payload('branched-integration')) }
  }
  errors.push('Unexpected API: ' + route.request().method() + ' ' + url.pathname)
  return reply(404, { detail: 'unowned_test_request' })
})
const url = `${origin}/?view=replay&surface=workspace&workspace=tenant-ui&session=replay-integration`
const visibleCount = async n => page.waitForFunction(value => document.querySelector('[data-testid="replay-chart"]')?.dataset.visibleRowCount === String(value), n)
try {
  await page.goto(url)
  await visibleCount(80)
  assert.equal(new URL(await page.getByRole('link', { name: 'Trade draft trong simulator', exact: true }).getAttribute('href'), origin).searchParams.get('intent'), 'order')
  assert.ok((await page.getByTestId('fxreplay-shell').getAttribute('class')).includes('is-chart-workspace'))
  await page.locator('[data-testid="replay-chart"] canvas').first().evaluate(el => { el.dataset.instanceProbe = 'kept' })
  const chart = page.getByTestId('replay-chart')
  const box = await chart.boundingBox()
  await page.mouse.move(box.x + box.width * .55, box.y + box.height * .5)
  await page.mouse.wheel(0, -350)
  await page.mouse.down(); await page.mouse.move(box.x + box.width * .7, box.y + box.height * .5, { steps: 10 }); await page.mouse.up()
  const range = await chart.getAttribute('data-range-from')
  await page.getByTestId('step-1').click()
  await visibleCount(81)
  assert.equal(await page.locator('[data-testid="replay-chart"] canvas').first().getAttribute('data-instance-probe'), 'kept', 'step recreated chart canvas')
  assert.ok(Math.abs(Number(await chart.getAttribute('data-range-from')) - Number(range)) < 1, 'step reset pan/zoom')
  await page.getByRole('button', { name: 'Vừa toàn bộ nến đã mở' }).click()
  await page.getByRole('button', { name: 'Chi tiết & nhánh' }).click()
  await chart.click({ position: { x: Math.round(box.width * .35), y: Math.round(box.height * .4) } })
  await page.waitForFunction(() => document.querySelector('[data-testid="annotation-draft"]')?.classList.contains('is-ready'))
  const anchor = await page.getByTestId('annotation-draft').innerText()
  await page.getByRole('combobox', { name: 'Kiểu chart' }).selectOption('line')
  assert.equal(await page.getByTestId('annotation-draft').innerText(), anchor, 'chart type lost anchor')
  await page.getByRole('checkbox', { name: 'SMA 20' }).check()
  await page.getByRole('checkbox', { name: 'Volume', exact: true }).uncheck()
  await page.getByRole('button', { name: 'Lùi một nến', exact: true }).click()
  await visibleCount(80)
  assert.equal(await page.getByTestId('step-1').isDisabled(), true)
  assert.equal(await page.getByRole('button', { name: 'Trade draft trong simulator', exact: true }).isDisabled(), true, 'historical cursor must not offer a canonical order draft')
  await page.getByRole('button', { name: 'Về cursor mới nhất' }).click()
  await visibleCount(81)
  forceConflict = true
  await page.getByTestId('step-1').click()
  await page.getByTestId('revision-conflict').waitFor()
  assert.equal(await page.getByTestId('step-1').isDisabled(), true)
  await page.getByRole('button', { name: 'Tải trạng thái mới' }).click()
  await page.getByTestId('revision-conflict').waitFor({ state: 'detached' })
  await page.getByTestId('branch-cursor').fill('20')
  await page.getByTestId('branch-replay').click()
  await page.waitForURL(/session=branched-integration/)
  await visibleCount(21)
  await page.reload()
  await visibleCount(21)
  assert.equal(new URL(page.url()).searchParams.get('surface'), 'workspace')
  const screenshots = []
  for (const theme of ['dark', 'light']) {
    await page.evaluate(value => localStorage.setItem('tw-theme', value), theme)
    await page.goto(url)
    await visibleCount(81)
    for (const width of [1440, 768, 390, 360]) {
      await page.setViewportSize({ width, height: 900 })
      await page.getByRole('button', { name: 'Vừa toàn bộ nến đã mở' }).click()
      await page.screenshot({ path: path.join(evidence, `replay-${theme}-${width}.png`), fullPage: true })
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
      assert.ok(overflow <= 2, 'horizontal overflow ' + theme + ' ' + width + ': ' + overflow)
      const bounds = await chart.boundingBox()
      assert.ok(bounds.height >= 300 && bounds.width >= width - 100, 'chart geometry too small')
      screenshots.push({ theme, width, bounds, overflow })
    }
  }
  await page.getByRole('button', { name: 'Chi tiết & nhánh' }).click()
  await page.getByRole('textbox', { name: 'Thời điểm replay UTC' }).fill('2024-03-09T16:20')
  await page.getByRole('button', { name: 'Mở cutoff theo thời điểm' }).click()
  await visibleCount(21)
  await page.getByTestId('replay-history-view').waitFor()
  failedRead = true
  await page.goto(url)
  await page.getByRole('alert').waitFor()
  failedRead = false
  await page.getByRole('button', { name: 'Thử lại', exact: true }).click()
  await visibleCount(81)
  empty = true
  await page.goto(`${origin}/?view=replay&surface=workspace&fresh=1&workspace=tenant-ui`)
  await page.getByTestId('replay-empty-actions').waitFor()
  empty = false
  await page.reload()
  await page.getByRole('button', { name: 'Bắt đầu replay', exact: true }).click()
  await visibleCount(1)
  assert.equal(new URL(page.url()).searchParams.has('fresh'), false)
  assert.deepEqual(errors, [])
  const report = { status: 'PASS', scope: 'product-fixture-not-real-backend', screenshots, errors, checks: ['stable chart canvas', 'pan zoom survives step', 'anchor survives chart type', 'volume and SMA toggles', 'historical back and latest', 'conflict reload', 'branch and reload resume', 'date cutoff', 'empty and error retry', 'fresh create route', '8 responsive theme screenshots'] }
  await writeFile(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
} catch (error) {
  await page.screenshot({ path: path.join(evidence, 'failure.png'), fullPage: true })
  console.error(error)
  process.exitCode = 1
} finally { await browser.close() }
