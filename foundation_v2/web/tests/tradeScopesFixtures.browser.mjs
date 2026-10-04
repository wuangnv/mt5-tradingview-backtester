import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'
const origin = 'http://127.0.0.1:5180', out = path.resolve('../evidence/ui-session-scopes-20261004/fixtures')
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Users/MIIKEY/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe' })
const report = { scope: 'LABELED browser fixtures only; no persisted data writes', cases: [], errors: [] }
const baseRow = { trade_id: 'same-position', symbol: 'EURUSD', side: 'BUY', net_pnl: 100, open_time_utc: '2024-01-01T00:00:00Z', close_time_utc: '2024-01-01T01:00:00Z', close_cursor_index: 60, close_event_sequence: 180 }
const ledger = [['a', 'USD', 10000], ['b', 'EUR', 20000]].map(([id, currency, capital]) => ({ ...baseRow, session_id: id, session_name: `Session ${id}`, starting_balance: capital, account_currency: currency, origin_session_id: id, source_provenance: { session_id: id, revision: 3, dataset_id: `dataset-${id}`, execution_event_sequence: 180 } }))
const payload = { schema_version: 'dashboard-replay-performance-v1', status: 'ready', metrics: { closed_trade_count: 2 }, scope: { session_ids: ['a', 'b'], session_count: 2, readable_session_count: 2, duplicate_trade_count: 0, aggregation: 'unique_closed_fills_within_root_lineage' }, ledger, sources: [], excluded: [] }
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 987 }, reducedMotion: 'reduce', acceptDownloads: true })
  await ctx.addInitScript(() => { localStorage.setItem('tw-language', 'vi'); localStorage.setItem('tw-theme', 'dark') })
  await ctx.route('**/*', route => new URL(route.request().url()).origin !== origin || !['GET', 'HEAD', 'OPTIONS'].includes(route.request().method()) ? route.abort() : route.continue())
  await ctx.routeWebSocket('**/*', socket => socket.close())
  await ctx.route('**/api/v2/replay/sessions', route => route.fulfill({ json: { items: ['a', 'b'].map(record_id => ({ record_id, revision: 3, name: `Session ${record_id}`, created_at_utc: '2024-01-01T00:00:00Z' })) } }))
  await ctx.route('**/api/v2/journal', route => route.fulfill({ json: { items: [{ payload: { source: { session_id: 'b', trade_id: 'same-position' }, tags: ['only-b'] } }] } }))
  let response = payload
  await ctx.route('**/api/v2/replay/trades?**', route => route.fulfill({ json: response }))
  const page = await ctx.newPage(); page.setDefaultTimeout(15000); page.on('pageerror', error => report.errors.push(error.message))
  await page.goto(`${origin}/?workspace=tenant-a&view=trade&select=1`); await page.getByTestId('fx-trade-ledger').waitFor()
  assert.equal(await page.locator('tbody tr').count(), 2)
  assert.match(await page.locator('tbody').innerText(), /100 USD/); assert.match(await page.locator('tbody').innerText(), /100 EUR/)
  await page.getByRole('button', { name: 'Cột hiển thị', exact: true }).click(); await page.getByRole('checkbox', { name: 'Return (%)', exact: true }).check()
  assert.match(await page.locator('tbody tr').nth(0).innerText(), /1%/); assert.match(await page.locator('tbody tr').nth(1).innerText(), /0,5%/)
  await page.locator('tbody tr').nth(1).getByRole('button').click(); await page.getByRole('link', { name: 'Mở Journal →' }).waitFor()
  const journal = new URL(await page.getByRole('link', { name: 'Mở Journal →' }).getAttribute('href'), origin)
  assert.equal(journal.searchParams.get('session'), 'b'); assert.equal(journal.searchParams.get('trade'), 'same-position')
  const replay = new URL(await page.getByRole('link', { name: 'Mở Replay →' }).getAttribute('href'), origin)
  assert.equal(replay.searchParams.get('session'), 'b'); assert.equal(replay.searchParams.get('event_sequence'), '180')
  await page.getByRole('button', { name: 'Đóng chi tiết', exact: true }).click()
  const downloadPromise = page.waitForEvent('download'); await page.getByRole('button', { name: 'Xuất CSV', exact: true }).click()
  const download = await downloadPromise, filename = path.join(out, 'mixed-currency.csv'); await download.saveAs(filename)
  const csv = await readFile(filename, 'utf8'); assert.match(csv, /USD/); assert.match(csv, /EUR/); assert.match(csv, /source_provenance/)
  await page.getByRole('button', { name: 'Tags', exact: true }).click(); await page.getByTestId('analytics-filters').getByLabel('Tags', { exact: true }).selectOption('only-b'); assert.equal(await page.locator('tbody tr').count(), 1); assert.match(await page.locator('tbody').innerText(), /Session b/)
  report.cases.push('mixed currency/per-source return denominator/same trade ID identities/scoped tags/detail links/CSV')
  await page.screenshot({ path: path.join(out, 'mixed-currency.png') })
  response = { ...payload, ledger: [null] }; await page.reload(); await page.getByRole('alert').filter({ hasText: 'trade_ledger_read_model_invalid' }).waitFor(); assert.equal(await page.getByTestId('fx-trade-ledger').count(), 0)
  report.cases.push('malformed payload blocks rows and export')
  await ctx.close()
  assert.deepEqual(report.errors, [])
} finally { await browser.close(); await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2)) }
console.log(JSON.stringify(report))
