import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const out = path.resolve(process.env.TW_GRID_QA_OUT || '../../.artifacts/fx-grid-viewport-20261005/primary')
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1710, height: 987 } })
const errors = [], writes = [], demoReads = [], checks = [], geometry = []
page.on('pageerror', error => errors.push(error.message))
await page.route('**/api/**', async route => {
  if (route.request().method() !== 'GET') { writes.push(route.request().method()); await route.abort(); return }
  if (new URL(page.url()).searchParams.get('demo') === '1') demoReads.push(route.request().url())
  await route.continue()
})
const base = 'http://127.0.0.1:5180/?workspace=tenant-a&area=testing'
const trades = base + '&view=trade&section=trades&sessions=all&demo=1'
const goto = async url => { await page.goto(url); await page.waitForLoadState('networkidle') }
const chooseSize = async size => {
  await page.getByRole('button', { name: 'Số dòng Trades', exact: true }).click()
  const menu = await page.locator('.fxa-pagination .fx-select-menu').boundingBox()
  assert.ok(menu.y >= 0 && menu.y + menu.height <= page.viewportSize().height, 'bottom popup fits viewport')
  await page.getByRole('option', { name: String(size), exact: true }).click()
}
const measure = () => page.evaluate(() => {
  const box = selector => { const el = document.querySelector(selector), r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: r.height, scroll: el.scrollTop, client: el.clientHeight, total: el.scrollHeight } }
  return { content: box('.fx-content'), filters: box('.fxa-filters'), header: box('.fxa-table-scroll th'), row: document.querySelector('tbody tr') ? box('tbody tr') : null, table: box('.fxa-table-scroll'), footer: box('.fxa-pagination'), height: innerHeight, documentOverflow: document.documentElement.scrollWidth > innerWidth }
})
const fixed = state => {
  assert.ok(Math.abs(state.footer.bottom - state.height) <= 1, 'pagination at viewport bottom')
  assert.ok(state.table.client > 45, 'row region remains usable')
  assert.equal(state.content.scroll, 0, 'outer content does not scroll')
  assert.equal(state.documentOverflow, false)
}
try {
  for (const theme of ['dark', 'light']) for (const [width, height] of [[1710, 987], [1440, 900], [360, 844], [360, 600]]) {
    await page.setViewportSize({ width, height })
    await goto(trades)
    await page.evaluate(theme => localStorage.setItem('tw-theme', theme), theme)
    await page.reload(); await page.waitForLoadState('networkidle')
    await chooseSize(100)
    const before = await measure(); fixed(before)
    await page.locator('.fxa-table-scroll').evaluate(el => { el.scrollTop = 350; el.scrollLeft = 150 })
    const after = await measure(); fixed(after)
    assert.ok(after.table.scroll > 0)
    assert.ok(Math.abs(before.header.top - after.header.top) < 1, 'table header stays fixed')
    assert.ok(Math.abs(before.filters.top - after.filters.top) < 1, 'filters stay fixed')
    assert.ok(before.row.top > after.row.top, 'rows move')
    await page.getByRole('button', { name: 'Basic', exact: true }).click()
    await page.getByRole('button', { name: 'Tags', exact: true }).click()
    const expanded = await measure(); fixed(expanded)
    geometry.push({ theme, width, height, before, after, expanded })
    await page.screenshot({ path: path.join(out, `trade-${theme}-${width}-${height}-expanded.png`) })
    await page.getByRole('button', { name: 'Basic', exact: true }).click()
    await page.getByRole('button', { name: 'Tags', exact: true }).click()
    await page.screenshot({ path: path.join(out, `trade-${theme}-${width}-${height}.png`) })
  }
  checks.push('8 viewport/theme cases: body rows scroll; sticky header, filter and footer; Basic+Tags; no horizontal page overflow')
  await page.setViewportSize({ width: 1440, height: 900 }); await goto(trades)
  await chooseSize(25)
  await page.locator('.fxa-table-scroll').evaluate(el => { el.scrollTop = 400 })
  const first = await page.locator('tbody tr').first().textContent()
  await page.getByRole('button', { name: 'Trang sau', exact: true }).click()
  assert.notEqual(await page.locator('tbody tr').first().textContent(), first)
  assert.equal((await measure()).table.scroll, 0)
  await page.locator('.fxa-table-scroll').evaluate(el => { el.scrollTop = 400 })
  await page.getByRole('button', { name: 'Trang trước', exact: true }).click()
  assert.equal((await measure()).table.scroll, 0)
  const detail = page.locator('.fxa-detail-button').first()
  await detail.click()
  await page.getByRole('dialog', { name: 'Chi tiết giao dịch' }).waitFor()
  fixed(await measure())
  for (const key of ['Tab', 'Tab', 'Shift+Tab']) {
    await page.keyboard.press(key)
    assert.equal(await page.locator('dialog').evaluate(el => el.contains(document.activeElement)), true)
  }
  await page.keyboard.press('Escape')
  assert.equal(await page.locator('dialog.fxa-trade-inspector').count(), 0)
  assert.equal(await detail.evaluate(el => el === document.activeElement), true)
  await detail.click(); await page.mouse.click(10, 10)
  assert.equal(await page.locator('dialog.fxa-trade-inspector').count(), 0)
  await page.getByRole('button', { name: 'Mở tìm giao dịch', exact: true }).click()
  await page.getByRole('searchbox', { name: 'Tìm giao dịch', exact: true }).fill('no-trade-match')
  await page.getByText('Không có giao dịch khớp bộ lọc.', { exact: true }).waitFor()
  fixed(await measure())
  checks.push('25-row pages change data/reset scroll; detail Escape/backdrop/focus; empty table keeps footer')
  for (const source of ['sessions', 'prop']) {
    await goto(base + '&view=analytics&section=analytics&demo=1&analytics_source=' + source)
    const border = await page.locator('.fxa-filters').evaluate(el => ({ actual: getComputedStyle(el).borderBottomColor, expected: getComputedStyle(document.querySelector('.fx-subnav')).borderBottomColor, width: getComputedStyle(el).borderBottomWidth }))
    assert.equal(border.width, '1px'); assert.equal(border.actual, border.expected)
  }
  checks.push('both Analytics sources have filter separator')
  await goto(base + '&view=market-data&section=market-data&demo=1')
  assert.equal(await page.locator('.market-sync-facts').count(), 0)
  assert.equal(await page.locator('.market-sync-heading p').count(), 0)
  assert.equal(await page.locator('.market-sync-filters').getByRole('button', { name: 'Cập nhật dữ liệu', exact: true }).isDisabled(), true)
  const update = await page.getByRole('button', { name: 'Cập nhật dữ liệu', exact: true }).boundingBox()
  const search = await page.getByRole('searchbox', { name: 'Tìm asset', exact: true }).boundingBox()
  assert.ok(Math.abs(update.y + update.height / 2 - search.y - search.height / 2) < 2)
  await page.getByRole('searchbox', { name: 'Tìm asset', exact: true }).fill('EURUSD')
  assert.equal(await page.locator('.market-sync-table tbody tr').count(), 1)
  checks.push('Market intro/count removed; update shares filters/search; demo update disabled; search works')
  await page.screenshot({ path: path.join(out, 'market-demo.png') })
  assert.deepEqual(writes, []); assert.deepEqual(demoReads, []); assert.deepEqual(errors, [])
  await writeFile(path.join(out, 'journey.json'), JSON.stringify({ pass: true, checks, geometry, writes, demoReads, errors }, null, 2))
  console.log(JSON.stringify({ pass: true, checks }))
} catch (error) {
  await page.screenshot({ path: path.join(out, 'failure.png') })
  await writeFile(path.join(out, 'failure.json'), JSON.stringify({ error: error.stack, geometry, current: await measure().catch(() => null), writes, errors }, null, 2))
  throw error
} finally { await browser.close() }
