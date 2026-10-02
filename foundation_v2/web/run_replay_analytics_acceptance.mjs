import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const web = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(web, '../../../..')
const seed = JSON.parse(await readFile(process.env.WM_UI_SEED || path.join(root, '.artifacts/wm-integration-20261001/seed.json'), 'utf8'))
const origin = process.env.WM_UI_ORIGIN || seed.ui
assert.equal(new URL(origin).hostname, '127.0.0.1')
const out = process.env.WM_UI_OUT || path.join(root, '.artifacts/wm-integration-20261001/analytics-validation')
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ headless: true })
const report = { scope: 'synthetic dataset through real API and PostgreSQL; read-only browser checks', cases: [], errors: [] }
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
  const page = await context.newPage()
  page.on('pageerror', (error) => report.errors.push(String(error)))
  const base = `${origin}/?workspace=tenant-a&view=analytics&select=1&session=${seed.session_id}`
  await page.goto(base)
  const ledger = page.locator('.as-ledger-section')
  await ledger.getByRole('heading', { name: '60 trade đóng', exact: true }).waitFor()
  assert.equal(await ledger.locator('tbody tr').count(), 50)
  assert.match(await page.locator('.as-metric-strip').innerText(), /75/)
  assert.match(await page.locator('.as-metric-strip').innerText(), /USD/)
  await page.getByRole('button', { name: 'Trang sau', exact: true }).click()
  assert.equal(await ledger.locator('tbody tr').count(), 10)
  const tradeButton = ledger.getByRole('button', { name: /^Chọn trade/ }).first()
  const tradeId = (await tradeButton.getAttribute('aria-label')).replace('Chọn trade ', '')
  await tradeButton.click()
  await page.waitForURL((url) => url.searchParams.get('trade') === tradeId)
  await page.reload()
  await page.locator('.as-inspector').getByRole('heading', { name: tradeId, exact: true }).waitFor()
  assert.match(await page.getByTestId('analytics-ledger-pagination').innerText(), /Trang 2\/2/)
  const replayLink = page.locator('.as-inspector').getByRole('link', { name: 'Mở Replay →' })
  assert.equal(new URL(await replayLink.getAttribute('href'), origin).searchParams.get('cursor'), '51')
  report.cases.push('real ledger pagination, keyboard action, trade deep link reload and candle cursor')

  await page.getByRole('combobox', { name: 'Analytics side', exact: true }).selectOption('sell')
  await page.getByTestId('analytics-empty').waitFor()
  assert.equal(await ledger.locator('tbody tr').count(), 0)
  await page.reload()
  await page.getByTestId('analytics-empty').waitFor()
  assert.equal(await page.getByRole('combobox', { name: 'Analytics side', exact: true }).inputValue(), 'sell')
  await page.getByRole('button', { name: 'Xóa lọc', exact: true }).click()
  await ledger.getByRole('heading', { name: '60 trade đóng', exact: true }).waitFor()
  report.cases.push('filter request, empty state, reload persistence and clear filters')
  const downloadEvent = page.waitForEvent('download')
  await page.getByRole('link', { name: 'Tải CSV', exact: true }).click()
  const download = await downloadEvent
  const csv = await readFile(await download.path(), 'utf8')
  assert.ok(csv.includes(seed.session_id) && csv.includes('replay-pos-178') && csv.includes('metrics,net_pnl,75'))
  report.cases.push('workspace-scoped CSV export carries actual metrics and full ledger')

  const sessionRoute = `${seed.api}/api/v2/replay/sessions/${seed.session_id}`
  const headers = { 'X-Workspace-Id': 'tenant-a' }
  const headBefore = await (await fetch(sessionRoute, { headers })).json()
  const historical = await (await fetch(`${sessionRoute}?cursor_index=20`, { headers })).json()
  await page.goto(`${base}&cursor=20&cutoff=${historical.cutoff_timestamp}`)
  await ledger.getByRole('heading', { name: '20 trade đóng', exact: true }).waitFor()
  assert.equal(await ledger.locator('tbody tr').count(), 20)
  assert.match(await page.locator('.as-metric-strip').innerText(), /25/)
  await page.getByTestId('analytics-historical-scope').waitFor()
  const historicalExport = new URL(await page.getByRole('link', { name: 'Tải CSV', exact: true }).getAttribute('href'), origin)
  assert.equal(historicalExport.searchParams.get('cursor_index'), '20')
  assert.equal(historicalExport.searchParams.get('cutoff_timestamp'), String(historical.cutoff_timestamp))
  await page.reload()
  await ledger.getByRole('heading', { name: '20 trade đóng', exact: true }).waitFor()
  const historicDownloadEvent = page.waitForEvent('download')
  await page.getByRole('link', { name: 'Tải CSV', exact: true }).click()
  const historicDownload = await historicDownloadEvent
  const historicCsv = await readFile(await historicDownload.path(), 'utf8')
  assert.ok(historicCsv.includes('metrics,net_pnl,25') && historicCsv.includes('provenance,cursor_index,20'))
  assert.ok(!historicCsv.includes('replay-pos-178'))
  await page.screenshot({ path: path.join(out, 'analytics-historical-20.png'), fullPage: true })
  await page.goto(`${base}&cursor_index=0`)
  await page.getByTestId('analytics-empty').waitFor()
  await page.getByTestId('analytics-historical-scope').waitFor()
  assert.equal(await ledger.locator('tbody tr').count(), 0)
  report.cases.push('historical cursor/cutoff survives reload and bounds metrics, ledger and CSV; initial cursor stays empty')
  await page.goto(`${base}&cursor=61`)
  await page.locator('.as-message[role="alert"]').waitFor()
  assert.equal(await page.locator('.as-metric-strip').count(), 0)
  const headAfter = await (await fetch(sessionRoute, { headers })).json()
  assert.deepEqual(headAfter.payload, headBefore.payload)
  assert.equal(headAfter.revision, headBefore.revision)
  report.cases.push('future cursor fails visibly without latest-data fallback or canonical session mutation')

  await page.goto(`${origin}/?workspace=tenant-a&view=analytics&select=1&session=${seed.empty_session_id}`)
  await page.getByTestId('analytics-blocked').waitFor()
  assert.equal(await page.locator('.as-metric-strip').count(), 0)
  report.cases.push('uninitialized execution does not fabricate zero metrics')
  for (const theme of ['dark', 'light']) {
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 })
      await page.goto(base)
      await ledger.getByRole('heading', { name: '60 trade đóng', exact: true }).waitFor()
      if (await page.getByTestId('fxreplay-shell').getAttribute('data-theme') !== theme) {
        await page.getByTestId('theme-toggle').click()
        await page.reload()
        await ledger.getByRole('heading', { name: '60 trade đóng', exact: true }).waitFor()
      }
      assert.equal(await page.getByTestId('fxreplay-shell').getAttribute('data-theme'), theme)
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
      assert.ok(overflow <= 1, `${theme} ${width}: overflow ${overflow}`)
      await page.screenshot({ path: path.join(out, `analytics-${theme}-${width}.png`), fullPage: true })
      report.cases.push(`${theme} ${width} real analytics rendered without page overflow`)
    }
  }
  assert.deepEqual(report.errors, [])
  report.status = 'PASS'
} catch (error) {
  report.status = 'FAIL'
  report.error = String(error.stack || error)
  process.exitCode = 1
} finally {
  await browser.close()
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length, error: report.error, out }))
}
