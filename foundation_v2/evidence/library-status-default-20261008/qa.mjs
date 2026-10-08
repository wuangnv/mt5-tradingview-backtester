import assert from 'node:assert/strict'
import { chromium } from '../../web/node_modules/playwright/index.mjs'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const out = new URL('./', import.meta.url), origin = 'http://127.0.0.1:5180'
const url = `${origin}/?workspace=tenant-a&view=market-data&area=testing&section=market-data`
await mkdir(out, { recursive: true })
const browser = await chromium.launch()
const report = { scope: 'UI fixtures with intercepted API, then actual local API GET-only; no source requests or download actions.', cases: [] }
try {
  for (const width of [1710, 768, 360]) {
    const context = await browser.newContext({ viewport: { width, height: 987 } })
    await context.addInitScript(() => { localStorage.setItem('tw-language', 'vi'); localStorage.setItem('tw-theme', 'dark') })
    let saved = [{ dataset_id: 'fixture-saved', instrument_id: 'AAA', timeframe: 'M1', source: { provider: 'Dukascopy' }, row_count: 10 }]
    const assets = ['AAA', 'BBB', 'CCC'].map(instrument_id => ({ instrument_id, provider: 'Dukascopy', provider_id: 'dukascopy', asset_class: 'fx' }))
    let writes = 0
    await context.route('**/api/**', route => {
      if (route.request().method() !== 'GET') { writes++; return route.abort() }
      const path = new URL(route.request().url()).pathname
      if (path === '/api/v2/data/datasets') return route.fulfill({ json: { items: saved, catalog_items: assets, catalog_state: { status: 'cached', configured: true }, download_state: { available: true } } })
      if (path === '/api/v2/data/downloads') return route.fulfill({ json: { available: true, items: [{ job_id: 'fixture-running', instrument_id: 'BBB', status: 'running', total_days: 100, completed_days: 16 }] } })
      return route.fulfill({ json: { items: [] } })
    })
    const page = await context.newPage(), errors = []
    page.setDefaultTimeout(10000)
    page.on('pageerror', error => errors.push(String(error)))
    await page.goto(url)
    const trigger = page.getByRole('button', { name: 'Trạng thái tải', exact: true })
    const table = page.getByTestId('data-desk-dataset-table')
    await table.waitFor()
    assert.equal(await trigger.innerText(), 'Đã tải')
    assert.deepEqual(await table.locator('tbody tr td:first-child strong').allTextContents(), ['AAA'])
    await trigger.click()
    const list = page.getByRole('listbox', { name: 'Trạng thái tải', exact: true })
    assert.deepEqual(await list.getByRole('option').allTextContents(), ['Đã tải✓', 'Đang tải', 'Chưa tải', 'Tất cả trạng thái'])
    const anchor = await trigger.boundingBox(), menu = await list.locator('..').boundingBox()
    if (width >= 768) assert(Math.abs(anchor.x - menu.x) < 1, 'menu must align with trigger left')
    else assert(menu.x <= anchor.x && menu.x + menu.width >= anchor.x + anchor.width, 'narrow popup must stay attached to trigger while fitting content')
    assert(menu.x >= 0 && menu.x + menu.width <= width, 'menu must fit viewport')
    await page.screenshot({ path: fileURLToPath(new URL(`fixture-menu-${width}.png`, out)) })
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await table.locator('tbody tr').filter({ hasText: 'BBB' }).waitFor()
    assert.equal(await trigger.innerText(), 'Đang tải')
    await trigger.click()
    await page.getByRole('option', { name: 'Chưa tải', exact: true }).click()
    assert.deepEqual(await table.locator('tbody tr td:first-child strong').allTextContents(), ['CCC'])
    await page.getByRole('button', { name: 'Xóa bộ lọc', exact: true }).click()
    assert.equal(await trigger.innerText(), 'Tất cả trạng thái')
    assert.equal(await table.locator('tbody tr').count(), 3)
    await page.reload()
    await table.waitFor()
    assert.equal(await trigger.innerText(), 'Đã tải')
    saved = []
    await page.reload()
    await table.waitFor()
    assert.equal(await table.locator('tbody tr').count(), 0)
    const empty = page.getByTestId('data-desk-empty')
    await empty.waitFor()
    const header = await table.locator('thead').boundingBox(), message = await empty.boundingBox()
    assert(message.y >= header.y + header.height - 1 && message.y <= header.y + header.height + 2, 'empty message must start directly below table header')
    const textAlignment = await empty.evaluate(element => {
      const headerCell = element.parentElement.querySelector('th')
      return { message: element.getBoundingClientRect().left + parseFloat(getComputedStyle(element).paddingLeft), header: headerCell.getBoundingClientRect().left + parseFloat(getComputedStyle(headerCell).paddingLeft) }
    })
    assert(Math.abs(textAlignment.message - textAlignment.header) < 1, 'empty text must share the first column inset')
    assert.equal(await empty.locator('..').getAttribute('class'), 'rd-table-wrap')
    await page.screenshot({ path: fileURLToPath(new URL(`fixture-empty-${width}.png`, out)) })
    await trigger.click()
    await page.getByRole('option', { name: 'Chưa tải', exact: true }).click()
    assert.deepEqual(await table.locator('tbody tr td:first-child strong').allTextContents(), ['AAA', 'CCC'])
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    assert.equal(writes, 0); assert.deepEqual(errors, [])
    report.cases.push({ width, pass: true, checks: ['downloaded-default', 'option-order', 'anchor-alignment', 'keyboard', 'status-filter', 'clear-all', 'reload', 'empty-below-header', 'empty-library', 'no-page-overflow'], writes })
    await context.close()
  }
  const context = await browser.newContext({ viewport: { width: 1710, height: 987 } })
  let writes = 0
  await context.addInitScript(() => { localStorage.setItem('tw-language', 'vi'); localStorage.setItem('tw-theme', 'dark') })
  await context.route('**/api/**', route => { if (route.request().method() !== 'GET') { writes++; return route.abort() } return route.continue() })
  const page = await context.newPage()
  await page.goto(url)
  await page.getByTestId('data-desk-dataset-table').waitFor()
  assert.equal(await page.getByRole('button', { name: 'Trạng thái tải', exact: true }).innerText(), 'Đã tải')
  await page.getByRole('button', { name: 'Trạng thái tải', exact: true }).click()
  await page.screenshot({ path: fileURLToPath(new URL('actual-menu.png', out)) })
  await page.keyboard.press('Escape')
  const sample = async () => {
    const response = await context.request.get(`${origin}/api/v2/data/downloads`, { headers: { 'X-Workspace-Id': 'tenant-a' } })
    assert.equal(response.status(), 200)
    const payload = await response.json()
    return { time: Date.now(), jobs: payload.items.map(({ job_id, status, stage, error, completed_days, total_days, transferred_bytes, network_days, retry_after_seconds }) => ({ job_id, status, stage, error, completed_days, total_days, transferred_bytes, network_days, retry_after_seconds })) }
  }
  const first = await sample()
  await new Promise(resolve => setTimeout(resolve, 12000))
  const second = await sample()
  assert.equal(writes, 0)
  report.actual = { pass: true, writes, first, second }
  report.pass = true
  await context.close()
} catch (error) { report.pass = false; report.error = String(error); process.exitCode = 1 }
finally { await writeFile(new URL('qa.json', out), JSON.stringify(report, null, 2)); await browser.close(); console.log(JSON.stringify(report)) }
