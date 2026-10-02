import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const origin = process.env.SESSION_QA_ORIGIN || 'http://127.0.0.1:5180'
const output = process.env.SESSION_QA_ARTIFACTS || path.resolve('../../../../.artifacts/wm-integration-20261001/sessions-real')
const seedPath = process.env.SESSION_QA_SEED || path.resolve('../../../../.artifacts/wm-integration-20261001/seed.json')
const seed = JSON.parse(await readFile(seedPath, 'utf8'))
assert.equal(seed.scope, 'synthetic-data-real-API-Postgres-local-UI-only')
assert.equal(new URL(origin).hostname, '127.0.0.1', 'isolated loopback QA only')
assert.equal(origin, seed.ui, 'test must use the exact isolated UI origin from its seed receipt')
const headers = { 'X-Workspace-Id': 'tenant-a', 'Content-Type': 'application/json' }
const api = async (route, body, method = body ? 'POST' : 'GET') => {
  const response = await fetch(`${origin}/api/v2${route}`, { method, headers, body: body ? JSON.stringify(body) : undefined })
  const payload = await response.json()
  assert.ok(response.ok, `${method} ${route}: ${response.status} ${JSON.stringify(payload)}`)
  return payload
}
const checks = [], errors = [], created = [], screenshots = []
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true, executablePath: process.env.TW_UI_QA_CHROMIUM || 'C:/Users/MIIKEY/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe' })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
const page = await context.newPage()
page.setDefaultTimeout(10000)
page.on('pageerror', error => errors.push(error.message))
await context.addInitScript(() => { if (!localStorage.getItem('tw-theme')) localStorage.setItem('tw-theme', 'dark'); localStorage.setItem('tw-language', 'vi') })
const open = async (view, id) => {
  await page.goto(`${origin}/?workspace=tenant-a&view=${view}&select=1&session=${id}`)
  await page.getByTestId('session-catalog-status').filter({ hasText: 'phiên đang hoạt động' }).waitFor()
}
const waitReport = async () => {
  await page.getByTestId('analytics-workspace').waitFor()
  await page.getByText('Đang tải kết quả…', { exact: true }).waitFor({ state: 'hidden' })
}
try {
  const baseline = await api(`/replay/sessions/${seed.session_id}`)
  assert.equal(baseline.revision, seed.revision, 'baseline must remain unchanged')
  const before = (await api('/overview')).performance
  const countBefore = before.metrics.closed_trade_count
  const duplicateBefore = before.scope.duplicate_trade_count
  const child = await api(`/replay/sessions/${seed.session_id}/branch`, { expected_revision: baseline.revision, cursor_index: baseline.payload.cursor_index })
  created.push(child.record_id)
  const afterBranch = (await api('/overview')).performance
  assert.equal(afterBranch.metrics.closed_trade_count, countBefore, 'branch copied closures must not increase workspace trade count')
  assert.equal(afterBranch.scope.duplicate_trade_count, duplicateBefore + seed.analytics.count)
  assert.equal(afterBranch.scope.session_count, before.scope.session_count + 1)
  checks.push('real branch keeps lineage and dashboard deduplicates 60 inherited closures')

  await open('replay', child.record_id)
  await waitReport()
  await page.getByRole('button', { name: 'Sửa tên và mô tả', exact: true }).click()
  const name = `QA Sessions ${child.record_id.slice(0, 8)}`
  await page.getByLabel('Tên phiên', { exact: true }).fill(name)
  await page.getByLabel('Mô tả', { exact: true }).fill('QA local: metadata persisted after revision conflict')
  const external = await api(`/replay/sessions/${child.record_id}`, { expected_revision: child.revision, description: 'Concurrent QA update' }, 'PATCH')
  await page.getByRole('button', { name: 'Lưu thay đổi', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'Phiên đã thay đổi ở nơi khác' }).waitFor()
  await page.getByTestId('session-catalog-status').filter({ hasText: 'phiên đang hoạt động' }).waitFor()
  assert.equal(await page.getByLabel('Tên phiên', { exact: true }).inputValue(), name)
  await page.getByRole('button', { name: 'Lưu thay đổi', exact: true }).click()
  await page.getByRole('heading', { name, exact: true }).waitFor()
  await page.reload()
  await page.getByText('QA local: metadata persisted after revision conflict', { exact: true }).waitFor()
  const saved = await api(`/replay/sessions/${child.record_id}`)
  assert.equal(saved.revision, external.revision + 1)
  assert.equal(saved.payload.name, name)
  assert.equal(saved.payload.parent_session_id, seed.session_id)
  checks.push('real 409 retains draft then explicit save persists across reload')

  const catalogBeforeArchive = (await api('/replay/sessions')).items
  const archivedBefore = catalogBeforeArchive.filter(item => item.archived).length
  await page.getByRole('button', { name: 'Lưu trữ phiên', exact: true }).click()
  await page.getByRole('button', { name: 'Khôi phục phiên', exact: true }).waitFor()
  assert.equal(await page.getByRole('link', { name: 'Tiếp tục trên chart →', exact: true }).count(), 0)
  assert.equal(await page.getByRole('button', { name: 'Tạo bản sao tại cutoff', exact: true }).isDisabled(), true)
  await waitReport()
  assert.equal((await api(`/replay/sessions/${child.record_id}/analytics`)).scope.total_trade_count, seed.analytics.count)
  const catalogArchived = (await api('/replay/sessions')).items
  assert.equal(catalogArchived.filter(item => item.archived).length, archivedBefore + 1)
  const archivedOverview = (await api('/overview')).performance
  assert.equal(archivedOverview.metrics.closed_trade_count, countBefore)
  assert.equal(archivedOverview.scope.includes_archived, true)
  await page.getByRole('button', { name: 'Khôi phục phiên', exact: true }).click()
  await page.getByRole('button', { name: 'Lưu trữ phiên', exact: true }).waitFor()
  assert.equal((await api('/replay/sessions')).items.filter(item => item.archived).length, archivedBefore)
  checks.push('archive and restore counts match API while historical dashboard and analytics remain available')

  await page.getByRole('button', { name: 'Tạo bản sao tại cutoff', exact: true }).click()
  await page.waitForURL(url => url.searchParams.get('session') && url.searchParams.get('session') !== child.record_id)
  const grandchildId = new URL(page.url()).searchParams.get('session')
  created.push(grandchildId)
  await waitReport()
  const grandchild = await api(`/replay/sessions/${grandchildId}`)
  assert.equal(grandchild.payload.parent_session_id, child.record_id)
  assert.equal(grandchild.payload.cursor_index, saved.payload.cursor_index)
  assert.equal((await api('/overview')).performance.metrics.closed_trade_count, countBefore)
  checks.push('UI duplicate branches at exact saved cutoff and navigates to persisted child')

  await open('trade', child.record_id)
  await page.getByRole('heading', { name: '60 trade đóng', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Trang sau', exact: true }).click()
  await page.getByRole('button', { name: 'Chọn trade replay-pos-151', exact: true }).click()
  await page.getByRole('region', { name: 'Trade detail' }).waitFor()
  await page.reload()
  await page.getByRole('region', { name: 'Trade detail' }).waitFor()
  assert.equal(new URL(page.url()).searchParams.get('trade'), 'replay-pos-151')
  checks.push('persisted child ledger has 60 trades and page two detail survives reload')

  for (const theme of ['dark', 'light']) {
    await page.evaluate(theme => localStorage.setItem('tw-theme', theme), theme)
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 })
      await open('replay', child.record_id)
      await waitReport()
      const dimensions = await page.evaluate(() => ({
        documentOverflow: document.documentElement.scrollWidth - innerWidth,
        contentWidth: document.querySelector('.fx-content').clientWidth,
        contentOverflow: document.querySelector('.fx-content').scrollWidth - document.querySelector('.fx-content').clientWidth,
      }))
      assert.ok(dimensions.documentOverflow <= 1 && dimensions.contentOverflow <= 1, JSON.stringify({ theme, width, ...dimensions }))
      if (width <= 600) assert.ok(dimensions.contentWidth >= width - 80, 'mobile sidebar leaves readable content')
      const filename = `sessions-real-${theme}-${width}.png`
      await page.screenshot({ path: path.join(output, filename), fullPage: true })
      screenshots.push({ theme, width, filename, ...dimensions })
    }
  }
  checks.push('real session metadata and report render at 1440 768 390 in dark and light without horizontal overflow')
  await open('replay', seed.empty_session_id)
  await page.getByTestId('analytics-blocked').waitFor()
  assert.equal(await page.getByText('0%', { exact: true }).count(), 0)
  checks.push('uninitialized real session has explicit unavailable analytics instead of fabricated zero')
  const after = await api(`/replay/sessions/${seed.session_id}`)
  assert.equal(after.revision, seed.revision)
  assert.equal((await api(`/replay/sessions/${seed.session_id}/analytics`)).metrics.net_pnl, seed.analytics.net_pnl)
  assert.deepEqual(errors, [])
  await writeFile(path.join(output, 'receipt.json'), JSON.stringify({ status: 'PASS', scope: seed.scope, productAcceptance: 'SCOPED_ONLY', broker: 'NOT_CONTACTED', baseline: seed.session_id, baselineRevision: after.revision, created, checks, screenshots, browserErrors: errors }, null, 2))
  console.log(JSON.stringify({ status: 'PASS', checks: checks.length, created, output }))
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {})
  await writeFile(path.join(output, 'failure.json'), JSON.stringify({ error: String(error), checks, created, browserErrors: errors }, null, 2))
  throw error
} finally {
  await browser.close()
}
