import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const origin = 'http://127.0.0.1:5180', session = '39b1d068edd64e75864f692f27237852'
const out = path.resolve(process.env.SCOPE_EVIDENCE || '../evidence/ui-session-scopes-20261004')
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Users/MIIKEY/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe' })
const report = { scope: 'GET-only actual local QA API, synthetic persisted sessions; labeled browser fixtures separate', cases: [], errors: [] }
const headers = { 'X-Workspace-Id': 'tenant-a' }
const json = async url => { const response = await fetch(origin + url, { headers }); assert.equal(response.status, 200); return response.json() }
const catalog = (await json('/api/v2/replay/sessions')).items
const newest = [...catalog.filter(item => !item.archived)].sort((a, b) => Date.parse(b.created_at_utc) - Date.parse(a.created_at_utc) || Date.parse(b.updated_at_utc) - Date.parse(a.updated_at_utc) || a.record_id.localeCompare(b.record_id))[0]
const second = catalog.find(item => item.record_id !== session && !item.archived)
const url = (view, suffix = '') => `${origin}/?workspace=tenant-a&view=${view}&select=1&area=testing${suffix}`
async function context(theme, width, remembered = '') {
  const context = await browser.newContext({ viewport: { width, height: 987 }, reducedMotion: 'reduce' })
  await context.addInitScript(({ theme, remembered }) => { localStorage.setItem('tw-theme', theme); localStorage.setItem('tw-language', 'vi'); if (remembered) localStorage.setItem('tw:replay:last:tenant-a', remembered) }, { theme, remembered })
  await context.route('**/*', route => new URL(route.request().url()).origin !== origin || !['GET', 'HEAD', 'OPTIONS'].includes(route.request().method()) ? route.abort() : route.continue())
  await context.routeWebSocket('**/*', socket => socket.close())
  const page = await context.newPage(); page.setDefaultTimeout(20000); page.on('pageerror', error => report.errors.push(error.message))
  return { context, page }
}
try {
  for (const theme of ['dark', 'light']) for (const width of [1440, 768, 360]) {
    const { context: ctx, page } = await context(theme, width)
    await page.goto(url('replay')); await page.getByTestId('session-catalog-status').filter({ hasText: 'phiên đang hoạt động' }).waitFor()
    assert.equal(await page.getByLabel('Chọn phiên replay', { exact: true }).inputValue(), newest.record_id)
    assert.equal(new URL(page.url()).searchParams.get('session'), newest.record_id)
    report.cases.push({ actual: true, theme, width, case: 'Sessions newest creation fallback' })
    await page.goto(url('analytics', `&session=${session}&cursor=20`)); await page.getByTestId('analytics-performance').waitFor()
    assert.equal(await page.locator('.fxr-session-toolbar').count(), 0)
    assert.equal(await page.getByTestId('analytics-filters').locator('.fxa-filter-grid .fxa-session-trigger').count(), 1)
    assert.match(await page.getByTestId('analytics-historical-scope').innerText(), /#20/)
    const rememberedBefore = await page.evaluate(() => localStorage.getItem('tw:replay:last:tenant-a'))
    await page.locator('.fxa-session-trigger').click(); await page.getByLabel('Tìm phiên', { exact: true }).fill(second.name || second.record_id)
    await page.getByRole('dialog', { name: 'Chọn session' }).getByRole('button').first().click()
    assert.equal(new URL(page.url()).searchParams.get('session'), second.record_id)
    assert.equal(new URL(page.url()).searchParams.has('cursor'), false)
    assert.equal(await page.evaluate(() => localStorage.getItem('tw:replay:last:tenant-a')), rememberedBefore)
    await page.reload(); await page.locator('.fxa-session-trigger').waitFor(); assert.equal(new URL(page.url()).searchParams.get('session'), second.record_id)
    await page.goto(url('analytics', `&session=${session}`)); await page.getByTestId('analytics-performance').waitFor(); await page.locator('.fxa-session-trigger:not(:disabled)').waitFor(); await page.screenshot({ path: path.join(out, `analytics-${theme}-${width}.png`) })
    report.cases.push({ actual: true, theme, width, case: 'Analytics filter selection, clears cutoff, preserves last-run, reload' })
    await page.locator('.fx-subnav-primary').getByRole('link', { name: 'Trades', exact: true }).click()
    await page.getByTestId('fx-trade-ledger').waitFor()
    assert.equal(new URL(page.url()).searchParams.get('sessions'), 'all')
    assert.equal(new URL(page.url()).searchParams.has('session'), false)
    await page.locator('.fxa-session-trigger').click()
    const dialog = page.getByRole('dialog', { name: 'Chọn session' })
    await dialog.getByRole('checkbox', { name: 'Tất cả phiên', exact: true }).uncheck()
    await dialog.getByLabel('Tìm phiên', { exact: true }).fill('QA — 60')
    await dialog.getByRole('checkbox').nth(1).check()
    assert.equal(await dialog.isVisible(), true)
    await dialog.getByLabel('Tìm phiên', { exact: true }).fill(second.name || second.record_id)
    await dialog.getByRole('checkbox').nth(1).check()
    await dialog.getByLabel('Tìm phiên', { exact: true }).press('Escape')
    assert.equal(await dialog.count(), 0)
    assert.deepEqual(new Set(new URL(page.url()).searchParams.getAll('sessions')), new Set([session, second.record_id]))
    await page.getByTestId('fx-trade-ledger').waitFor(); await page.reload(); await page.getByTestId('fx-trade-ledger').waitFor()
    assert.match(await page.locator('.fxa-session-trigger').innerText(), /2 phiên/)
    const expected = await json(`/api/v2/replay/trades?sessions=${session},${second.record_id}`)
    assert.match(await page.getByTestId('analytics-ledger-pagination').innerText(), new RegExp(`/ ${expected.ledger.length}\\b`))
    await page.screenshot({ path: path.join(out, `trades-${theme}-${width}.png`) })
    await page.locator('.fxa-session-trigger').click(); const menuBounds = await page.getByRole('dialog', { name: 'Chọn session' }).boundingBox(); assert.ok(menuBounds.x >= 0 && menuBounds.x + menuBounds.width <= width, JSON.stringify(menuBounds)); await page.screenshot({ path: path.join(out, `dropdown-${theme}-${width}.png`) }); await page.getByLabel('Tìm phiên', { exact: true }).press('Escape')
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
    assert.ok(overflow <= 1, `${width}: horizontal document overflow ${overflow}`)
    report.cases.push({ actual: true, theme, width, case: 'Trades nav all, searchable multi checkbox menu stays open, Escape/reload/source counts' })
    await page.goto(url('trade', `&session=${session}&cursor=20`)); await page.getByTestId('fx-trade-ledger').waitFor()
    assert.match(await page.getByTestId('analytics-ledger-pagination').innerText(), /\/ 20\b/)
    report.cases.push({ actual: true, theme, width, case: 'Historical Trades deep link retains exact 20 closures' })
    await ctx.close()
  }
  for (const remembered of [session, 'missing-id']) {
    const { context: ctx, page } = await context('dark', 1440, remembered)
    await page.goto(url('replay')); await page.getByTestId('session-catalog-status').filter({ hasText: 'phiên đang hoạt động' }).waitFor()
    assert.equal(await page.getByLabel('Chọn phiên replay', { exact: true }).inputValue(), remembered === session ? session : newest.record_id)
    report.cases.push({ actual: true, case: `Sessions remembered ${remembered}` }); await ctx.close()
  }
  const { context: ctx, page } = await context('dark', 1440)
  await page.goto(url('trade', '&sessions=none')); await page.getByTestId('fx-trade-ledger').waitFor(); assert.match(await page.getByTestId('analytics-ledger-pagination').innerText(), /\/ 0\b/)
  await page.goto(url('trade', '&sessions=missing')); await page.getByRole('alert').filter({ hasText: 'replay_not_found' }).waitFor(); assert.equal(await page.getByTestId('fx-trade-ledger').count(), 0)
  await page.goto(url('trade', '&session=' + session + '&analytics_timezone=broken&from_close_utc=2024-01-01T00:00:00Z')); await page.getByTestId('fx-trade-ledger').waitFor()
  await page.getByRole('button', { name: 'Xóa lọc', exact: true }).click(); assert.equal(new URL(page.url()).searchParams.has('from_close_utc'), false); await page.reload(); await page.getByTestId('fx-trade-ledger').waitFor()
  await page.goto(url('analytics', '&analytics_source=prop')); await page.getByTestId('prop-analytics').waitFor(); assert.equal(await page.locator('.fxa-session-trigger').count(), 0)
  report.cases.push({ actual: true, case: 'Empty selection, invalid session error without data fallback, invalid timezone, date alias clear/reload, separate Prop source' })
  await ctx.close()
  assert.deepEqual(report.errors, [])
} finally { await browser.close(); await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2)) }
console.log(JSON.stringify({ cases: report.cases.length, errors: report.errors, evidence: out }))
